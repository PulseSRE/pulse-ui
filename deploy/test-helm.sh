#!/usr/bin/env bash
# Test Helm chart rendering without a cluster.
# Validates templates, checks for leaked secrets, and verifies config.
#
# Usage: ./deploy/test-helm.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }
# grep -q on large piped input causes SIGPIPE under set -o pipefail; use grep -c instead
has() { [[ $(echo "$1" | grep -c "$2" || true) -gt 0 ]]; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHART_DIR="$SCRIPT_DIR/helm/pulse"
FAILURES=0

echo "=== Helm Chart Tests ==="
echo ""

# Rebuild dependencies (skip if charts already exist — CI may not have file:// sources)
if [ ! -d "$CHART_DIR/charts" ] || [ -z "$(ls -A "$CHART_DIR/charts/" 2>/dev/null)" ]; then
  helm dependency build "$CHART_DIR" 2>/dev/null || true
fi

# Common values for all tests
COMMON=(
  --set openshiftpulse.image.repository=quay.io/test/pulse
  --set openshiftpulse.image.tag=test
  --set openshiftpulse.route.clusterDomain=apps.example.com
  --set openshiftpulse.oauthProxy.image=registry.redhat.io/openshift4/ose-oauth-proxy:v4.17
)

AGENT_VALUES=(
  --set openshiftpulse.agent.enabled=true
  --set openshiftpulse.agent.serviceName=pulse-agent
  --set openshiftpulse.agent.wsToken=test-token-value
  --set openshiftpulse.agent.wsTokenSecret=pulse-ws-token
  --set agent.enabled=true
  --set agent.image.repository=quay.io/test/agent
  --set agent.image.tag=test
  --set agent.wsAuth.existingSecret=pulse-ws-token
  --set agent.anthropicApiKey.existingSecret=test-secret
  # Compatibility for stale packaged dependencies before helm dependency update.
  --set openshift-sre-agent.enabled=true
  --set openshift-sre-agent.image.repository=quay.io/test/agent
  --set openshift-sre-agent.image.tag=test
  --set openshift-sre-agent.wsAuth.existingSecret=pulse-ws-token
  --set openshift-sre-agent.anthropicApiKey.existingSecret=test-secret
)

# 1. Helm lint
echo "--- Lint ---"
if helm lint "$CHART_DIR" "${COMMON[@]}" "${AGENT_VALUES[@]}" &>/dev/null; then
  pass "helm lint (agent enabled)"
else
  fail "helm lint (agent enabled)"
fi

# 2. Template renders without errors
echo "--- Template rendering ---"
if RENDERED=$(helm template pulse "$CHART_DIR" "${COMMON[@]}" "${AGENT_VALUES[@]}" 2>&1); then
  pass "Template renders (agent enabled)"
else
  fail "Template renders (agent enabled)"
fi

# 3. WS token NOT in ConfigMap
echo "--- Security: token not in ConfigMap ---"
TOKEN_COUNT=$(echo "$RENDERED" | grep -c "test-token-value" || true)
if [[ "$TOKEN_COUNT" -eq 0 ]]; then
  pass "WS token not leaked in rendered output"
else
  fail "WS token appears in rendered output ($TOKEN_COUNT occurrences)"
fi

# 4. __AGENT_TOKEN__ placeholder present
if has "$RENDERED" "__AGENT_TOKEN__"; then
  pass "__AGENT_TOKEN__ placeholder in nginx config"
else
  fail "__AGENT_TOKEN__ placeholder missing from nginx config"
fi

# 5. Entrypoint reads token from file
if has "$RENDERED" "cat /etc/nginx/agent-token/token"; then
  pass "Entrypoint reads token from mounted secret"
else
  fail "Entrypoint doesn't read token from file"
fi

# 6. Agent token volume mount
if has "$RENDERED" "agent-token"; then
  pass "Agent token volume mount exists"
else
  fail "Agent token volume mount missing"
fi

# 7. OAuth secrets have resource-policy keep
if has "$RENDERED" "resource-policy.*keep"; then
  pass "Secrets have helm.sh/resource-policy: keep"
else
  fail "Secrets missing resource-policy annotation"
fi

# 8. PDB exists for UI
if has "$RENDERED" "PodDisruptionBudget"; then
  pass "PodDisruptionBudget exists"
else
  fail "PodDisruptionBudget missing"
fi

# 9. Security contexts
if has "$RENDERED" "readOnlyRootFilesystem: true"; then
  pass "readOnlyRootFilesystem set"
else
  fail "readOnlyRootFilesystem missing"
fi

if has "$RENDERED" "runAsNonRoot: true"; then
  pass "runAsNonRoot set"
else
  fail "runAsNonRoot missing"
fi

# 10. Agent disabled renders without errors
if RENDERED_NO_AGENT=$(helm template pulse "$CHART_DIR" "${COMMON[@]}" \
  --set openshiftpulse.agent.enabled=false \
  --set agent.enabled=false \
  --set openshift-sre-agent.enabled=false 2>&1); then
  pass "Template renders (agent disabled)"
else
  fail "Template renders (agent disabled)"
fi

# 11. No agent location block when disabled
if has "$RENDERED_NO_AGENT" "Agent not deployed"; then
  pass "Agent 503 fallback when disabled"
else
  fail "Agent 503 fallback missing when disabled"
fi

# 12. Startup probes present
STARTUP_COUNT=$(echo "$RENDERED" | grep -c "startupProbe" || true)
if [[ "$STARTUP_COUNT" -ge 2 ]]; then
  pass "startupProbe present ($STARTUP_COUNT instances)"
else
  fail "startupProbe missing or insufficient ($STARTUP_COUNT found, expected 2+)"
fi

# 13. --atomic flag (verify values file renders cleanly for atomic deploys)
if has "$RENDERED" "RollingUpdate"; then
  pass "RollingUpdate strategy configured"
else
  fail "RollingUpdate strategy missing"
fi

# 14. User token proxy must fail closed instead of falling back to service-account token
if has "$RENDERED" "__SA_TOKEN__"; then
  fail "nginx config still contains service-account token fallback"
else
  pass "nginx config has no service-account token fallback"
fi

if has "$RENDERED" "X-Forwarded-Access-Token header is required"; then
  pass "nginx returns 401 when forwarded access token is missing"
else
  fail "nginx missing-token 401 guard not rendered"
fi

if has "$RENDERED" "sed -i \"s|__SA_TOKEN__"; then
  fail "deployment still injects service-account token into nginx"
else
  pass "deployment does not inject service-account token into nginx"
fi

# 15. MCP server must not render by default
if has "$RENDERED" "app.kubernetes.io/component: mcp-server"; then
  fail "MCP server renders by default"
else
  pass "MCP server disabled by default"
fi

# Summary
echo ""
echo "==========================="
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}All tests passed${NC}"
else
  echo -e "${RED}${FAILURES} test(s) failed${NC}"
  exit 1
fi
