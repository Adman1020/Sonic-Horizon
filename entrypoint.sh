#!/bin/sh
set -e

# Fail fast with a clear message when required configuration is missing.
# Spotify login/callback and the in-process scheduler all depend on these.
for var in \
  JWT_SECRET \
  ENCRYPTION_SECRET \
  SPOTIFY_CLIENT_ID \
  SPOTIFY_CLIENT_SECRET \
  APP_BASE_URL; do
  if [ -z "$(eval echo \"\$$var\")" ]; then
    echo "ERROR: required environment variable $var is not set." >&2
    echo "Example .env for docker compose:" >&2
    echo "  JWT_SECRET=..." >&2
    echo "  ENCRYPTION_SECRET=..." >&2
    echo "  SPOTIFY_CLIENT_ID=..." >&2
    echo "  SPOTIFY_CLIENT_SECRET=..." >&2
    echo "  APP_BASE_URL=https://your-hostname" >&2
    exit 1
  fi
done

# Bind-mounted appdata folders (Unraid) arrive owned by the host's root user.
# Ensure the container's nextjs user can write them before the server starts.
mkdir -p /config /data/db
chown -R nextjs:nodejs /config /data/db

echo "Starting server..."
exec setpriv --reuid=nextjs --regid=nodejs --init-groups node server.js
