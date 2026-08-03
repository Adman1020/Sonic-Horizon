#!/bin/sh
set -e

mkdir -p /config

echo "Starting server..."
exec node server.js
