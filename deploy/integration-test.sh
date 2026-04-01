#!/usr/bin/env bash
# Integration test — verifies Pulse UI + Agent are deployed and connected.
# Run after deploy.sh. Exits 0 if all checks pass, 1 on failure.
#
# Usage: ./deploy/integration-test.sh [--namespace openshiftpulse]

set -euo pipefail

NAMESPACE="openshiftpulse"
AGENT_RELEASE="pulse-agent"
FAILURES=0
MAX_RETRIES=3

while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --agent-release) AGENT_RELEASE="$2"; shift 2 ;;
    *) NAMESPACE="$1"; shift ;;
  esac
done

# Derive agent deployment name from helm release
AGENT_DEPLOY="${AGENT_RELEASE}-openshift-sre-agent"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo "  - $1"; }

# Execute a command on the agent pod with timeout
agent_exec() {
  timeout 10 oc exec "deployment/$AGENT_DEPLOY" -n "$NAMESPACE" -- "$@" 2>/dev/null || echo ""
}

echo "=== Pulse Integration Test ==="
echo "Namespace:  $NAMESPACE"
echo "Agent:      $AGENT_DEPLOY"
echo ""

# 1. Pods running
echo "[Pods]"
UI_PODS=$(oc get pods -n "$NAMESPACE" -l app=openshiftpulse --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')
AGENT_PODS=$(oc get pods -n "$NAMESPACE" -l app.kubernetes.io/instance="$AGENT_RELEASE" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')
[[ "$UI_PODS" -ge 1 ]] && pass "Pulse UI: $UI_PODS pod(s) running" || fail "Pulse UI: no pods running"
[[ "$AGENT_PODS" -ge 1 ]] && pass "Agent: $AGENT_PODS pod(s) running" || fail "Agent: no pods running"

# 2. Agent health endpoint (with retry)
echo ""
echo "[Agent Health]"
HEALTH=""
for i in $(seq 1 $MAX_RETRIES); do
  HEALTH=$(agent_exec curl -sf http://localhost:8080/healthz)
  [[ "$HEALTH" == *'"ok"'* ]] && break
  [[ $i -lt $MAX_RETRIES ]] && sleep 5
done
[[ "$HEALTH" == *'"ok"'* ]] && pass "GET /healthz → ok" || fail "GET /healthz failed"

# 3. Agent version endpoint
VERSION=$(agent_exec curl -sf http://localhost:8080/version)
if [[ "$VERSION" == *'"protocol"'* ]]; then
  # Extract protocol and tools count using grep/sed (no python3 dependency)
  PROTO=$(echo "$VERSION" | grep -o '"protocol":"[^"]*"' | cut -d'"' -f4)
  TOOLS=$(echo "$VERSION" | grep -o '"tools":[0-9]*' | cut -d: -f2)
  pass "GET /version → protocol=$PROTO, tools=$TOOLS"
else
  fail "GET /version failed"
fi

# 4. Agent tools endpoint
TOOLS_RESP=$(agent_exec curl -sf http://localhost:8080/tools)
[[ "$TOOLS_RESP" == *'"sre"'* ]] && pass "GET /tools → SRE tools available" || fail "GET /tools failed"

# 5. WebSocket token
echo ""
echo "[WebSocket Auth]"
WS_TOKEN=$(oc get "deployment/$AGENT_DEPLOY" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="PULSE_AGENT_WS_TOKEN")].value}' 2>/dev/null || echo "")
[[ -n "$WS_TOKEN" ]] && pass "PULSE_AGENT_WS_TOKEN is set" || fail "PULSE_AGENT_WS_TOKEN not set — WS auth will fail"

# 6. Nginx proxy config
echo ""
echo "[Nginx Proxy]"
NGINX_CONF=$(timeout 10 oc exec deployment/openshiftpulse -c openshiftpulse -n "$NAMESPACE" -- cat /etc/nginx/nginx.conf 2>/dev/null || echo "")
if [[ -n "$NGINX_CONF" ]]; then
  [[ "$NGINX_CONF" == *"/api/agent/"* ]] && pass "nginx proxies /api/agent/" || fail "nginx missing /api/agent/ proxy"
  [[ "$NGINX_CONF" == *"ws/sre"* ]] && pass "nginx has /ws/sre location" || fail "nginx missing /ws/sre location"
  [[ "$NGINX_CONF" == *"token="* ]] && pass "nginx injects WS token" || fail "nginx not injecting WS token"
else
  fail "Could not read nginx config"
fi

# 7. OAuth redirect
echo ""
echo "[OAuth]"
ROUTE=$(oc get route openshiftpulse -n "$NAMESPACE" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
REDIRECT=$(oc get oauthclient openshiftpulse -o jsonpath='{.redirectURIs[0]}' 2>/dev/null || echo "")
if [[ -n "$ROUTE" && "$REDIRECT" == *"$ROUTE"* ]]; then
  pass "OAuth redirectURI matches route"
else
  fail "OAuth redirectURI ($REDIRECT) does not match route ($ROUTE)"
fi

# 8. Vertex AI / API config
echo ""
echo "[AI Backend]"
PROJECT=$(oc get "deployment/$AGENT_DEPLOY" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="ANTHROPIC_VERTEX_PROJECT_ID")].value}' 2>/dev/null || echo "")
if [[ -n "$PROJECT" ]]; then
  pass "Vertex AI project: $PROJECT"
  GCP_CREDS=$(oc get "deployment/$AGENT_DEPLOY" -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="GOOGLE_APPLICATION_CREDENTIALS")].value}' 2>/dev/null || echo "")
  [[ -n "$GCP_CREDS" ]] && pass "GCP credentials: $GCP_CREDS" || warn "GCP credentials not mounted"
else
  echo "  - Vertex AI not configured (using Anthropic API key?)"
fi

# 9. Monitoring
echo ""
echo "[Monitoring]"
if [[ -n "$NGINX_CONF" && "$NGINX_CONF" == *"thanos-querier"* ]]; then
  pass "Prometheus proxy configured"
elif [[ -n "$NGINX_CONF" && "$NGINX_CONF" == *"Prometheus not configured"* ]]; then
  echo "  - Prometheus disabled (no monitoring stack)"
else
  fail "Prometheus proxy not found in nginx config"
fi

# 10. View API CRUD
echo ""
echo "[View API]"
VIEW_ID=""
# Create
CREATE_RESP=$(agent_exec curl -sf -X POST http://localhost:8080/views \
  -H "Content-Type: application/json" \
  -d '{"title":"Integration Test View","description":"auto-test","layout":[{"kind":"key_value","pairs":[{"key":"test","value":"ok"}]}]}')
if echo "$CREATE_RESP" | grep -q '"id"'; then
  VIEW_ID=$(echo "$CREATE_RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  pass "POST /views → created $VIEW_ID"
else
  fail "POST /views failed: $CREATE_RESP"
fi

# List
if [[ -n "$VIEW_ID" ]]; then
  LIST_RESP=$(agent_exec curl -sf http://localhost:8080/views)
  echo "$LIST_RESP" | grep -q "$VIEW_ID" && pass "GET /views → lists created view" || fail "GET /views missing created view"
fi

# Get
if [[ -n "$VIEW_ID" ]]; then
  GET_RESP=$(agent_exec curl -sf "http://localhost:8080/views/$VIEW_ID")
  echo "$GET_RESP" | grep -q "Integration Test View" && pass "GET /views/$VIEW_ID → correct title" || fail "GET /views/$VIEW_ID wrong content"
fi

# Update
if [[ -n "$VIEW_ID" ]]; then
  UPDATE_RESP=$(agent_exec curl -sf -X PUT "http://localhost:8080/views/$VIEW_ID" \
    -H "Content-Type: application/json" \
    -d '{"title":"Updated Title"}')
  echo "$UPDATE_RESP" | grep -q '"updated":true' && pass "PUT /views/$VIEW_ID → updated" || fail "PUT /views/$VIEW_ID failed"
fi

# Share
if [[ -n "$VIEW_ID" ]]; then
  SHARE_RESP=$(agent_exec curl -sf -X POST "http://localhost:8080/views/$VIEW_ID/share")
  echo "$SHARE_RESP" | grep -q '"share_token"' && pass "POST /views/$VIEW_ID/share → token generated" || fail "POST /views/$VIEW_ID/share failed"
fi

# Delete
if [[ -n "$VIEW_ID" ]]; then
  DEL_RESP=$(agent_exec curl -sf -X DELETE "http://localhost:8080/views/$VIEW_ID")
  echo "$DEL_RESP" | grep -q '"deleted":true' && pass "DELETE /views/$VIEW_ID → deleted" || fail "DELETE /views/$VIEW_ID failed"

  # Verify gone
  GONE_CODE=$(agent_exec curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080/views/$VIEW_ID")
  [[ "$GONE_CODE" == "404" ]] && pass "GET deleted view → 404" || fail "GET deleted view returned $GONE_CODE (expected 404)"
fi

# Results
echo ""
echo "════════════════════════════════"
if [[ $FAILURES -eq 0 ]]; then
  echo "ALL CHECKS PASSED"
  echo "URL: https://$ROUTE"
  exit 0
else
  echo "$FAILURES CHECK(S) FAILED"
  exit 1
fi
