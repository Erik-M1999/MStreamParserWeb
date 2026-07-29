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
WORKDIR /app/frontend
RUN npm ci
WORKDIR /app/backend
RUN npm ci

# Copy sources and build. Prisma client MUST be generated before `tsc` — the
# backend's types depend on it, so generating it after `npm run build` breaks
# the type-check with spurious "implicitly any" errors.
WORKDIR /app
COPY frontend/ frontend/
COPY backend/ backend/
WORKDIR /app/backend
RUN npx prisma generate \
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
# `node` (uid 1000) ships with the official image. Owning the copied files means
# the app can still write ./run (the generated-secrets volume) without root.
COPY --from=build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --from=build --chown=node:node /app/backend/public ./public
COPY --from=build --chown=node:node /app/backend/prisma ./prisma
# The read-only demo templates served at /api/sample-templates. Not optional:
# library.routes.ts reads this directory from disk at request time, so without
# it the "Demo Templates" folder silently lists as empty in the container.
COPY --from=build --chown=node:node /app/backend/sample-templates ./sample-templates
COPY --from=build --chown=node:node /app/backend/app.js ./app.js
COPY --from=build --chown=node:node /app/backend/package.json ./package.json
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

# Pre-create the secrets dir with the right owner. Docker seeds a named volume
# from the image path on first mount, so the volume inherits this ownership —
# without it the mount lands as root-owned and the entrypoint can't write.
RUN mkdir -p /app/backend/run && chown -R node:node /app/backend

# Drop root: a container escape from a root process is far more damaging, and
# nothing here needs privilege (port 3000 is unprivileged).
USER node

EXPOSE 3000

# Lets `depends_on: condition: service_healthy` and orchestrators see real
# readiness rather than just "process started". Hits the existing /health route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Applies pending migrations, then starts the server.
CMD ["/entrypoint.sh"]
