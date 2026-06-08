#!/bin/bash
# Wrapper for the daily local-cron patrol. Invoked by launchd
# (com.compliance-grid.patrol.plist) on the operator's laptop because
# Indian government portals IP-block US-based GitHub Actions runners.
#
# What it does:
#   1. cd to the repo root
#   2. source .env so DATABASE_URL + ANTHROPIC_API_KEY are loaded
#   3. resolve npm/node from the active nvm install
#   4. run `npm run patrol`
#   5. log a timestamped record under logs/patrol/
#
# Exit code is patrol's own — non-zero on fetch or pipeline error so
# launchd can be configured to retry or alert on it.

set -uo pipefail

REPO_ROOT="${COMPLIANCE_GRID_REPO:-$HOME/Documents/compliance-grid}"
cd "$REPO_ROOT" || {
  echo "[run-patrol] repo not found at $REPO_ROOT" >&2
  exit 2
}

if [[ ! -f .env ]]; then
  echo "[run-patrol] .env not found in $REPO_ROOT" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
# Optional overlay for patrol-specific overrides (e.g. point DATABASE_URL
# at the production Supabase pooler while .env keeps the local-dev URL
# for tests + the dev server). Gitignored.
if [[ -f .env.patrol ]]; then
  # shellcheck disable=SC1091
  source .env.patrol
fi
set +a

# Resolve node + npm from the active nvm or system install. nvm only
# touches PATH inside an interactive shell, so launchd needs explicit help.
if [[ -d "$HOME/.nvm" ]]; then
  # Pick the highest-numbered installed version (lexically); covers the
  # common case of one active node version. Falls through to system
  # PATH if no nvm install is found.
  NVM_NODE="$(find "$HOME/.nvm/versions/node" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$NVM_NODE" ]]; then
    PATH="$NVM_NODE/bin:$PATH"
  fi
fi
export PATH

LOG_DIR="$REPO_ROOT/logs/patrol"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date -u +%Y%m%dT%H%M%SZ).log"

{
  echo "[run-patrol] started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) cwd=$REPO_ROOT node=$(command -v node) npm=$(command -v npm)"
  npm run patrol
  PATROL_EXIT=$?
  echo "[run-patrol] finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) patrol_exit=$PATROL_EXIT"
  exit "$PATROL_EXIT"
} 2>&1 | tee "$LOG_FILE"
