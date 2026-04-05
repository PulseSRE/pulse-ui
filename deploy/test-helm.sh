#!/usr/bin/env bash
# Test Helm chart rendering without a cluster.
# Validates templates, checks for leaked secrets, and verifies config.
#
# Usage: ./deploy/test-helm.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }

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
  --set agent.anthropicApiKey.existingSecret=test-secret
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
RENDERED=$(helm template pulse "$CHART_DIR" "${COMMON[@]}" "${AGENT_VALUES[@]}" 2>&1)
if [[ $? -eq 0 ]]; then
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
if echo "$RENDERED" | grep -q "__AGENT_TOKEN__"; then
  pass "__AGENT_TOKEN__ placeholder in nginx config"
else
  fail "__AGENT_TOKEN__ placeholder missing from nginx config"
fi

# 5. Entrypoint reads token from file
if echo "$RENDERED" | grep -q "cat /etc/nginx/agent-token/token"; then
  pass "Entrypoint reads token from mounted secret"
else
  fail "Entrypoint doesn't read token from file"
fi

# 6. Agent token volume mount
if echo "$RENDERED" | grep -q "agent-token"; then
  pass "Agent token volume mount exists"
else
  fail "Agent token volume mount missing"
fi

# 7. OAuth secrets have resource-policy keep
if echo "$RENDERED" | grep -q 'resource-policy.*keep\|resource-policy: keep'; then
  pass "Secrets have helm.sh/resource-policy: keep"
else
  fail "Secrets missing resource-policy annotation"
fi

# 8. PDB exists for UI
if echo "$RENDERED" | grep -q "PodDisruptionBudget"; then
  pass "PodDisruptionBudget exists"
else
  fail "PodDisruptionBudget missing"
fi

# 9. Security contexts
if echo "$RENDERED" | grep -q "readOnlyRootFilesystem: true"; then
  pass "readOnlyRootFilesystem set"
else
  fail "readOnlyRootFilesystem missing"
fi

if echo "$RENDERED" | grep -q "runAsNonRoot: true"; then
  pass "runAsNonRoot set"
else
  fail "runAsNonRoot missing"
fi

# 10. Agent disabled renders without errors
RENDERED_NO_AGENT=$(helm template pulse "$CHART_DIR" "${COMMON[@]}" \
  --set openshiftpulse.agent.enabled=false \
  --set agent.enabled=false 2>&1)
if [[ $? -eq 0 ]]; then
  pass "Template renders (agent disabled)"
else
  fail "Template renders (agent disabled)"
fi

# 11. No agent location block when disabled
if echo "$RENDERED_NO_AGENT" | grep -q "Agent not deployed"; then
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
if echo "$RENDERED" | grep -q "RollingUpdate\|maxSurge"; then
  pass "RollingUpdate strategy configured"
else
  fail "RollingUpdate strategy missing"
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
