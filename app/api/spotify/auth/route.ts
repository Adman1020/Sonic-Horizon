import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';

import { resolveSpotifyRedirectUri } from '@/lib/spotify';

const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'user-follow-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'ugc-image-upload',
].join(' ');

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const userClientId = await getDecryptedKey(userId, 'spotify_client_id');
  const clientId = userClientId || process.env.SPOTIFY_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(new URL('/?spotify_error=missing_client_id', request.url));
  }

  const userBaseUrl = await getDecryptedKey(userId, 'spotify_redirect_base_url');
  const redirectUri = resolveSpotifyRedirectUri(request, userBaseUrl);

  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  const response = NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`);
  response.cookies.set('spotify_oauth_state', state, { httpOnly: true, maxAge: 600, sameSite: 'lax' });
  response.cookies.set('spotify_code_verifier', codeVerifier, { httpOnly: true, maxAge: 600, sameSite: 'lax' });

  return response;
}
