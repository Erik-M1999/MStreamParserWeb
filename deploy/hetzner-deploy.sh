#!/usr/bin/env bash
# Runs ON the Hetzner server, streamed in over SSH by .github/workflows/deploy.yml.
#
# Build-on-server model: native modules (bcrypt) and the Prisma query engine are
# platform-specific, so node_modules is NEVER shipped from CI — everything is
# installed and compiled here, where the app actually runs.
#
# DATABASE_URL for `prisma migrate deploy` is read from backend/.env (Prisma CLI
# auto-loads it). That file lives only on the server and is gitignored, so the DB
# credentials never touch GitHub. The konsoleH Node.js config still provides the
# runtime env for the app itself.
set -euo pipefail

APP_DIR="$HOME/MStreamParserWeb"
cd "$APP_DIR"

echo "==> Sync to origin/main"
git fetch --prune origin
git reset --hard origin/main   # only touches tracked files; leaves .env / node_modules / build output

cd backend

echo "==> Install backend dependencies (npm ci)"
npm ci

echo "==> Install frontend dependencies (npm ci)"
npm --prefix ../frontend ci

echo "==> Generate Prisma client"
npx prisma generate

echo "==> Build frontend (static export -> backend/public)"
npm run build:web

echo "==> Build backend (tsc -> backend/dist)"
npm run build

echo "==> Apply database migrations"
npx prisma migrate deploy   # DATABASE_URL comes from backend/.env

echo "==> Restart Passenger"
mkdir -p tmp
touch tmp/restart.txt

echo "==> Deploy complete"
