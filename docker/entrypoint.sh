#!/bin/sh
# Container entrypoint: ensure auth secrets exist, apply DB migrations, start the
# server. Runs from /app/backend (WORKDIR).
set -e

# Auto-provision the two auth secrets when they aren't supplied via the
# environment (backend/.env). They're persisted under ./run — a named volume
# (msp_secrets) in docker-compose.yml — so a restart does NOT invalidate existing
# sessions or encrypted Spotify tokens. To rotate them, delete that volume.
#
# If backend/.env already sets JWT_SECRET / TOKEN_ENC_KEY, those are used as-is
# and nothing is generated. (Want a fresh secret on every launch instead? Remove
# the `[ -s "$file" ] ||` guard below so it regenerates each start — note that
# logs everyone out and forces a Spotify reconnect on each restart.)
SECRET_DIR="./run"
mkdir -p "$SECRET_DIR"

ensure_secret() {
  name="$1"                 # environment variable name
  file="$SECRET_DIR/$2"     # where the generated value is persisted
  # printenv instead of `eval "value=\${$name:-}"`: same result without handing
  # a variable name to the shell parser. Only ever called with the two literals
  # below, but eval on a constructed string is not a habit worth keeping.
  value="$(printenv "$name" || true)"
  if [ -z "$value" ]; then
    [ -s "$file" ] || {
      openssl rand -hex 32 > "$file"
      echo "[entrypoint] generated a new $name"
    }
    export "$name=$(cat "$file")"
  fi
}

ensure_secret JWT_SECRET    jwt_secret
ensure_secret TOKEN_ENC_KEY token_enc_key

echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting server..."
exec node app.js
