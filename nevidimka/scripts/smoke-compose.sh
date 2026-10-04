#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
# This script only owns a new disposable Compose project, never deployment volumes.
export COMPOSE_PROJECT_NAME="nevidimka-smoke-$(date +%s)-$RANDOM"
export ENV_FILE
ENV_FILE="$(mktemp "$PWD/.smoke-env.XXXXXX")"
export POSTGRES_PORT=55444 WEB_PORT=3948 BOT_PORT=3949
export POSTGRES_PASSWORD=smoke_system_password APP_DB_PASSWORD=smoke_app_password
cat > "$ENV_FILE" <<'EOF'
TELEGRAM_BOT_TOKEN=123456:smoke-only-token
OWNER_TELEGRAM_ID=700111222
ANTHROPIC_API_KEY=smoke-only-key
JWT_SECRET=smoke-secret-0123456789abcdef0123456789abcdef
APP_BASE_URL=https://smoke.test
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
ASR_API_KEY=
EOF
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker compose logs --no-color --tail=100; fi
  docker compose down --volumes --remove-orphans
  rm -f "$ENV_FILE"
  exit "$status"
}
trap cleanup EXIT
docker compose config --quiet
docker compose build bot worker web
docker compose up -d postgres
docker compose run --rm db-bootstrap
docker compose run --rm migrate
# Re-run both: bootstrap/migrations must also work on an existing database.
docker compose run --rm db-bootstrap
docker compose run --rm migrate
docker compose run --rm --no-deps -T bot node --input-type=module < scripts/smoke-seed.mjs
docker compose run --rm --no-deps -T worker node --input-type=module < scripts/smoke-worker.mjs
docker compose up -d web
docker compose run --rm --no-deps -T bot node --input-type=module < scripts/smoke-delete.mjs
echo "Compose smoke passed: production web, DB roles, shared storage, account deletion, runtime imports and ffmpeg."
