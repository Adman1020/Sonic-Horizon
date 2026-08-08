import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signToken, SESSION_MAX_AGE_SECONDS } from '@/lib/auth';
import { resolveSpotifyRedirectUri, safeRedirectUrl, getSpotifyClientCredentials } from '@/lib/spotify';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const storedState = request.cookies.get('spotify_oauth_state')?.value;
  const codeVerifier = request.cookies.get('spotify_code_verifier')?.value;

  if (error) {
    return NextResponse.redirect(safeRedirectUrl(request, `/?spotify_error=${error}`));
  }

  if (!code || !state || state !== storedState || !codeVerifier) {
    return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=state_mismatch'));
  }

  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = getSpotifyClientCredentials());
  } catch {
    return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=missing_client_id'));
  }

  const redirectUri = resolveSpotifyRedirectUri(request);

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Spotify token exchange failed:', errText);
      return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=token_exchange_failed'));
    }

    const tokens = await tokenRes.json();

    // The Spotify profile IS the identity — the callback doubles as the login.
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) {
      console.error('Spotify profile fetch failed:', await profileRes.text());
      return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=profile_fetch_failed'));
    }
    const profile = await profileRes.json();
    const spotifyId = String(profile.id ?? '');
    if (!spotifyId) {
      return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=profile_fetch_failed'));
    }

    const now = new Date();

    // Resolve the app user. First-ever admin bootstrap: if no approved admin
    // exists yet (covers the pre-rethink DB where password users have no
    // spotifyId), the first Spotify identity becomes the admin. Unknown
    // Spotify IDs afterwards land in a Pending state until an admin approves.
    let user = await prisma.user.findUnique({ where: { spotifyId } });
    let isNewUser = false;
    if (!user) {
      const hasActiveAdmin = await prisma.user.count({ where: { isAdmin: true, approved: true } });
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          spotifyId,
          spotifyUsername: profile.display_name ?? null,
          spotifyEmail: profile.email ?? null,
          isAdmin: !hasActiveAdmin,
          approved: !hasActiveAdmin,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          spotifyUsername: profile.display_name ?? user.spotifyUsername,
          spotifyEmail: profile.email ?? user.spotifyEmail,
          updatedAt: now,
        },
      });
    }

    // Store tokens for this user's settings.
    await prisma.settings.upsert({
      where: { userId: user.id },
      update: {
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token ?? null,
        updatedAt: now,
      },
      create: {
        userId: user.id,
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Create the session cookie.
    const token = await signToken({ userId: user.id, tokenVersion: user.tokenVersion });
    const pending = !user.approved;
    const response = NextResponse.redirect(
      safeRedirectUrl(request, pending ? '/?pending=1' : '/?spotify_connected=true')
    );
    response.cookies.set('sonic_horizon_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });
    response.cookies.delete('spotify_oauth_state');
    response.cookies.delete('spotify_code_verifier');

    if (isNewUser) {
      console.log(`[auth] New Spotify identity ${spotifyId} → ${user.approved ? 'admin bootstrap' : 'pending approval'}`);
    }
    return response;
  } catch (err) {
    console.error('Spotify callback error:', err);
    return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=server_error'));
  }
}
