import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';

import { resolveSpotifyRedirectUri, getSpotifyClientCredentials } from '@/lib/spotify';

// user-read-email is required for identity login (the callback maps the
// Spotify account to an app user). The rest cover fetching explicit-likes and
// syncing output playlists + covers. Removed: user-top-read and
// user-read-recently-played (no longer used since listening signals are gone).
const SCOPES = [
  'user-read-email',
  'user-library-read',
  'user-follow-read',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'ugc-image-upload',
].join(' ');

export async function GET(request: NextRequest) {
  let clientId: string;
  try {
    ({ clientId } = getSpotifyClientCredentials());
  } catch {
    return NextResponse.redirect(new URL('/?spotify_error=missing_client_id', request.url));
  }

  const redirectUri = resolveSpotifyRedirectUri(request);

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
