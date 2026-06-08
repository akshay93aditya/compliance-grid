#!/usr/bin/env bash
#
# bootstrap.sh — Compliance Grid
# Single command to set up the repo locally and make the first commit.
#
# Usage:
#   bash scripts/bootstrap.sh
#
# This script is intentionally conservative: it only does local git setup and a
# first commit. It does NOT touch any remote unless you explicitly run the
# optional push step it prints at the end. It is safe to re-run.

set -euo pipefail

# --- locate repo root (the parent of this script's directory) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> Compliance Grid bootstrap"
echo "    Repo root: ${ROOT_DIR}"

# --- sanity: required scaffold present ---
REQUIRED_FILES=(
  "CLAUDE.md"
  "PRODUCT-DEVELOPMENT-STATUS.md"
  "README.md"
  ".gitignore"
  ".env.example"
  "docs/specs/01-vision.md"
  "docs/specs/02-prd.md"
  "docs/specs/03-architecture.md"
  "docs/specs/04-product-design-guidelines.md"
  "docs/specs/05-copy-guidelines.md"
  "docs/specs/06-tech-stack.md"
  "docs/specs/07-agents.md"
  ".claude/agents/gatekeeper.md"
  ".claude/agents/ruthless-optimizer.md"
  ".claude/agents/readme-writer.md"
  ".claude/agents/discovery-agent.md"
  ".claude/agents/extraction-agent.md"
  ".claude/agents/projection-agent.md"
  "docs/diagrams/architecture.md"
)
MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "    MISSING: $f"
    MISSING=1
  fi
done
if [[ "$MISSING" -ne 0 ]]; then
  echo "==> Scaffold incomplete. Fix the missing files above before bootstrapping."
  exit 1
fi
echo "    Scaffold check: all required files present."

# --- git init (idempotent) ---
if [[ -d .git ]]; then
  echo "==> git already initialized; skipping init."
else
  echo "==> Initializing git repository."
  git init -q
  git symbolic-ref HEAD refs/heads/main 2>/dev/null || git checkout -q -b main 2>/dev/null || true
fi

# --- stamp the status spec with the bootstrap date (only if still unstamped) ---
if grep -q "_(set on first edit)_" PRODUCT-DEVELOPMENT-STATUS.md 2>/dev/null; then
  TODAY="$(date +%Y-%m-%d)"
  # portable in-place edit (works on GNU and BSD sed)
  if sed --version >/dev/null 2>&1; then
    sed -i "s/_(set on first edit)_/${TODAY}/" PRODUCT-DEVELOPMENT-STATUS.md
    sed -i "s/_(agent\/human)_/bootstrap script/" PRODUCT-DEVELOPMENT-STATUS.md
  else
    sed -i '' "s/_(set on first edit)_/${TODAY}/" PRODUCT-DEVELOPMENT-STATUS.md
    sed -i '' "s/_(agent\/human)_/bootstrap script/" PRODUCT-DEVELOPMENT-STATUS.md
  fi
  echo "==> Stamped status spec with date ${TODAY}."
fi

# --- first commit (only if there is something to commit) ---
git add -A
if git diff --cached --quiet; then
  echo "==> Nothing new to commit; working tree already committed."
else
  echo "==> Creating commit."
  git commit -q -m "chore: bootstrap Compliance Grid scaffold (specs, agents, status, meta prompt)"
  echo "    Commit created."
fi

# --- summary + next steps ---
echo ""
echo "==================================================================="
echo " Bootstrap complete."
echo "==================================================================="
echo ""
echo " Local repo is initialized and committed on branch: main"
echo ""
echo " OPTIONAL — push to GitHub (requires the gh CLI, authenticated):"
echo ""
echo "   gh repo create compliance-grid --private --source=. --remote=origin --push"
echo ""
echo " Or with plain git against a remote you created manually:"
echo ""
echo "   git remote add origin <your-repo-url>"
echo "   git push -u origin main"
echo ""
echo " NEXT IN CLAUDE CODE:"
echo "   1. Read CLAUDE.md."
echo "   2. Read PRODUCT-DEVELOPMENT-STATUS.md (resolve Open Questions Q1-Q7"
echo "      or accept the proposed defaults)."
echo "   3. Read docs/specs/01..07."
echo "   4. Begin Phase 1: implement the canonical schemas (one source of truth)"
echo "      and the Postgres layer for the CKG skeleton + Coverage Ledger,"
echo "      per docs/specs/03-architecture.md and 06-tech-stack.md."
echo "   5. Engage the Gatekeeper before declaring anything done."
echo ""
