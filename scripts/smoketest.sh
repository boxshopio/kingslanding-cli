#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# kl CLI Smoke Test
# Interactive script — pauses after each step for verification.
# Usage:
#   ./scripts/smoketest.sh local    # against km up local
#   ./scripts/smoketest.sh dev      # against dev environment
# ============================================================================

ENV="${1:-}"
if [[ -z "$ENV" || ( "$ENV" != "local" && "$ENV" != "dev" ) ]]; then
  echo "Usage: $0 <local|dev>"
  exit 1
fi

SMOKE_DIR=$(mktemp -d)
SMOKE_PROJECT="smoke-$(date +%s | tail -c 7)"
trap 'rm -rf "$SMOKE_DIR"' EXIT

# --- Helpers ----------------------------------------------------------------

step() {
  echo ""
  echo "================================================================"
  echo "  $1"
  echo "================================================================"
  echo ""
}

explain() {
  echo "  -> $1"
}

pause() {
  echo ""
  read -rp "  Press Enter to continue (or Ctrl+C to stop)... "
  echo ""
}

pass() {
  echo "  PASS"
}

# --- Setup ------------------------------------------------------------------

step "Setup: Build and link CLI"
explain "Builds TypeScript and creates the 'kl' binary link."

cd "$(dirname "$0")/.."
npm run build
npm link 2>/dev/null || true

echo "  kl version: $(kl --version)"
pass
pause

# --- Environment config -----------------------------------------------------

step "Environment: $ENV"

if [[ "$ENV" == "local" ]]; then
  export KL_API_URL=https://api.kl.test
  export NODE_TLS_REJECT_UNAUTHORIZED=0
  SITE_DOMAIN="kl.test"

  explain "Using local stack at $KL_API_URL"
  explain "TLS verification disabled (self-signed certs)."
  explain "Auth bypass is active — kl login is not needed."

  echo ""
  echo "  Checking local stack health..."
  if curl -sk "$KL_API_URL/health" | grep -q "healthy"; then
    echo "  Local stack is healthy."
  else
    echo "  ERROR: Local stack not reachable. Run 'km up local' first."
    exit 1
  fi
else
  export KL_API_URL=https://api.dev.kingslanding.io
  SITE_DOMAIN="dev.kingslanding.io"

  explain "Using dev environment at $KL_API_URL"
  explain "Real Cognito auth — you will need to log in."

  echo ""
  echo "  Checking dev API health..."
  if curl -s "$KL_API_URL/health" | grep -q "healthy"; then
    echo "  Dev API is healthy."
  else
    echo "  ERROR: Dev API not reachable. Check VPN/network."
    exit 1
  fi
fi

pause

# --- Auth -------------------------------------------------------------------

if [[ "$ENV" == "dev" ]]; then
  step "1/8: kl login (device flow)"
  explain "Opens browser for Cognito login. Enter the device code shown."
  explain "This tests the full OAuth device flow against real Cognito."
  pause

  kl login
  pass
  pause
else
  step "1/8: kl login (skipped — local auth bypass)"
  explain "Local stack uses LOCAL_AUTH_BYPASS=true. No login needed."
  pass
  pause
fi

# --- Whoami -----------------------------------------------------------------

step "2/8: kl whoami"
explain "Fetches account info from GET /api/v1/account."
explain "Should show your email and plan tier."
pause

kl whoami
pass
pause

# --- Projects (before deploy) ----------------------------------------------

step "3/8: kl projects"
explain "Lists your existing projects via GET /api/v1/projects."
explain "May be empty if this is a fresh account."
pause

kl projects
pass
pause

# --- Deploy -----------------------------------------------------------------

step "4/8: kl deploy (new project with --create)"
explain "Deploying a test site to project: $SMOKE_PROJECT"
explain "Uses the two-phase protocol: manifest -> presigned S3 uploads -> finalize."
explain "The --create flag auto-creates the project."

echo "<h1>Smoke test: $SMOKE_PROJECT</h1>" > "$SMOKE_DIR/index.html"
echo "body { font-family: sans-serif; padding: 2rem; }" > "$SMOKE_DIR/style.css"
echo ""
echo "  Files:"
echo "    $SMOKE_DIR/index.html"
echo "    $SMOKE_DIR/style.css"
pause

kl deploy "$SMOKE_DIR" --project "$SMOKE_PROJECT" --create --verbose
pass

SITE_URL="https://$SMOKE_PROJECT.$SITE_DOMAIN"
echo ""
echo "  Site should be live at: $SITE_URL"
echo "  Verify in your browser."
pause

# --- Deploy update ----------------------------------------------------------

step "5/8: kl deploy (update existing project)"
explain "Deploying updated content to the same project."
explain "This time without --create (project already exists)."

echo "<h1>Updated: $SMOKE_PROJECT</h1><p>Deploy #2</p>" > "$SMOKE_DIR/index.html"
pause

kl deploy "$SMOKE_DIR" --project "$SMOKE_PROJECT" --verbose
pass

echo ""
echo "  Refresh $SITE_URL — should show 'Deploy #2'."
pause

# --- Deploy key flow --------------------------------------------------------

step "6/8: kl deploy-key create + status"
explain "Generates a deploy key for CI/CD usage."
explain "The key is shown once and can't be retrieved again."
pause

kl deploy-key create --project "$SMOKE_PROJECT"

echo ""
explain "Checking deploy key status..."
kl deploy-key status --project "$SMOKE_PROJECT"
pass
pause

# --- Deploy key revoke ------------------------------------------------------

step "7/8: kl deploy-key revoke"
explain "Revokes the deploy key. Will prompt for confirmation."
pause

kl deploy-key revoke --project "$SMOKE_PROJECT"
pass

echo ""
explain "Verifying key is gone..."
kl deploy-key status --project "$SMOKE_PROJECT"
pass
pause

# --- Logout -----------------------------------------------------------------

if [[ "$ENV" == "dev" ]]; then
  step "8/8: kl logout"
  explain "Revokes refresh token in Cognito and clears local credentials."
  pause

  kl logout
  pass

  echo ""
  explain "Verify: kl whoami should now fail with auth error."
  kl whoami 2>&1 || true
  pause
else
  step "8/8: kl logout (skipped — local mode)"
  explain "No credentials stored in local mode. Nothing to log out."
  pass
  pause
fi

# --- Cleanup ----------------------------------------------------------------

step "Cleanup"
explain "Deleting test project: $SMOKE_PROJECT"
curl -sk -X DELETE "$KL_API_URL/api/v1/projects/$SMOKE_PROJECT" \
  -H "Authorization: Bearer local-bypass" > /dev/null 2>&1 || true
echo "  Done."

echo ""
echo "================================================================"
echo "  Smoke test complete!"
echo "  Environment: $ENV"
echo "  Project: $SMOKE_PROJECT"
echo "================================================================"
