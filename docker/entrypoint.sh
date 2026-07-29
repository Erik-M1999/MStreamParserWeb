#!/bin/sh
# Container entrypoint: apply DB migrations, then start the server.
# Runs from /app/backend (WORKDIR). DATABASE_URL comes from the environment.
set -e

echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting server..."
exec node app.js
