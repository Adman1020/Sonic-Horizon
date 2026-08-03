import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';
import { resolveSpotifyRedirectUri, safeRedirectUrl } from '@/lib/spotify';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const storedState = request.cookies.get('spotify_oauth_state')?.value;
  const codeVerifier = request.cookies.get('spotify_code_verifier')?.value;

  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(safeRedirectUrl(request, '/login'));
  }

  const userClientId = await getDecryptedKey(userId, 'spotify_client_id');
  const userClientSecret = await getDecryptedKey(userId, 'spotify_client_secret');
  const userBaseUrl = await getDecryptedKey(userId, 'spotify_redirect_base_url');

  if (error) {
    return NextResponse.redirect(safeRedirectUrl(request, `/?spotify_error=${error}`, userBaseUrl));
  }

  if (!code || !state || state !== storedState || !codeVerifier) {
    return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=state_mismatch', userBaseUrl));
  }

  const clientId = userClientId || process.env.SPOTIFY_CLIENT_ID || '';
  const clientSecret = userClientSecret || process.env.SPOTIFY_CLIENT_SECRET || '';
  const redirectUri = resolveSpotifyRedirectUri(request, userBaseUrl);

  try {
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const tokenHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (clientId && clientSecret) {
      tokenHeaders['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    }

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: tokenHeaders,
      body: bodyParams,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Spotify token exchange failed:', errText);
      return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=token_exchange_failed', userBaseUrl));
    }

    const tokens = await tokenRes.json();
    const now = new Date();

    await prisma.settings.upsert({
      where: { userId },
      update: {
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token ?? null,
        updatedAt: now,
      },
      create: {
        userId,
        spotifyAccessToken: tokens.access_token,
        spotifyRefreshToken: tokens.refresh_token ?? null,
        obscurityLevel: 3,
        outputFormat: 'tracks',
        recommendationLimit: 20,
        scheduleMode: 'manual',
        createdAt: now,
        updatedAt: now,
      },
    });

    const response = NextResponse.redirect(safeRedirectUrl(request, '/?spotify_connected=true', userBaseUrl));
    response.cookies.delete('spotify_oauth_state');
    response.cookies.delete('spotify_code_verifier');
    return response;
  } catch (err) {
    console.error('Spotify callback error:', err);
    return NextResponse.redirect(safeRedirectUrl(request, '/?spotify_error=server_error', userBaseUrl));
  }
}
