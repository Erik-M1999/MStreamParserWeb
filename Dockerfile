# syntax=docker/dockerfile:1

# ===========================================================================
# Full-app image: builds the Next.js static frontend + the Express/TS backend
# and runs the single Node process that serves both (API + static site).
# Paired with the MariaDB service in docker-compose.yml.
# ===========================================================================

# ---------- build stage ----------
# Full (non-slim) Node image: includes the toolchain bcrypt/node-gyp may need.
FROM node:24-bookworm AS build
WORKDIR /app

# Install deps first so this layer caches until a manifest changes.
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
RUN cd backend && npm ci

# Copy sources and build. Prisma client MUST be generated before `tsc` — the
# backend's types depend on it, so generating it after `npm run build` breaks
# the type-check with spurious "implicitly any" errors.
COPY frontend/ frontend/
COPY backend/ backend/
RUN cd backend \
 && npx prisma generate \
 && npm run build:web \
 && npm run build

# ---------- runtime stage ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend

# Prisma's query engine needs libssl; ca-certificates for outbound HTTPS
# (Spotify/Last.fm/Resend). Slim images ship neither by default.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy the built app + its already-compiled node_modules from the build stage.
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/public ./public
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/app.js ./app.js
COPY --from=build /app/backend/package.json ./package.json
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
# Applies pending migrations, then starts the server.
CMD ["/entrypoint.sh"]
