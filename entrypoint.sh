#!/bin/sh
set -e

# Bind-mounted appdata folders (Unraid) arrive owned by the host's root user.
# Ensure the container's nextjs user can write them before the server starts.
mkdir -p /config /data/db
chown -R nextjs:nodejs /config /data/db

echo "Starting server..."
exec setpriv --reuid=nextjs --regid=nodejs --init-groups node server.js
