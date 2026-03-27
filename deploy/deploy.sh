#!/usr/bin/env bash
# Deploy OpenShift Pulse (UI + Agent) to an OpenShift cluster.
#
# Usage:
#   ./deploy/deploy.sh --agent-repo /path/to/pulse-agent
#   ANTHROPIC_VERTEX_PROJECT_ID=proj CLOUD_ML_REGION=us-east5 ./deploy/deploy.sh --agent-repo ../open
#
# Prerequisites: oc (logged in), helm, npm

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_REPO=""
NAMESPACE="openshiftpulse"
WS_TOKEN="${PULSE_AGENT_WS_TOKEN:-$(openssl rand -hex 16 2>/dev/null || echo pulse-agent-internal-token)}"
AGENT_RELEASE="pulse-agent"

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-repo) AGENT_REPO="$2"; shift 2 ;;
    --namespace)  NAMESPACE="$2"; shift 2 ;;
    --ws-token)   WS_TOKEN="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --agent-repo /path/to/pulse-agent [--namespace openshiftpulse]"
      echo ""
      echo "Environment variables:"
      echo "  ANTHROPIC_VERTEX_PROJECT_ID  GCP project for Vertex AI"
      echo "  CLOUD_ML_REGION             GCP region (e.g., us-east5)"
      echo "  PULSE_AGENT_WS_TOKEN        WebSocket auth token (auto-generated if unset)"
      exit 0 ;;
    *) echo "ERROR: Unknown argument: $1. Use --help for usage."; exit 1 ;;
  esac
done

# ─── Helper Functions ────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo ""; echo -e "═══ $1 ═══"; }

wait_for_rollout() {
  local deploy="$1" ns="$2" timeout="${3:-120}"
  info "Waiting for $deploy to be ready (timeout: ${timeout}s)..."
  if ! oc rollout status "deployment/$deploy" -n "$ns" --timeout="${timeout}s" 2>/dev/null; then
    warn "Rollout not complete within ${timeout}s — continuing anyway"
  fi
}

wait_for_route() {
  local name="$1" ns="$2"
  local host=""
  for i in $(seq 1 10); do
    host=$(oc get route "$name" -n "$ns" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
    [[ -n "$host" ]] && echo "$host" && return 0
    sleep 2
  done
  echo ""
}

# Cross-platform hash (works on macOS and Linux)
file_hash() {
  if command -v shasum &>/dev/null; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum &>/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    # Fallback to md5
    md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1
  fi
}

# ─── Prerequisite Checks ────────────────────────────────────────────────────

step "Checking prerequisites"

# Required tools
for cmd in oc helm npm; do
  if ! command -v "$cmd" &>/dev/null; then
    error "'$cmd' not found. Install it and try again."
    exit 1
  fi
done
info "Tools: oc, helm, npm — OK"

# Cluster connectivity
if ! oc whoami &>/dev/null; then
  error "Not logged in to OpenShift. Run 'oc login' first."
  exit 1
fi
CLUSTER_API=$(oc whoami --show-server)
info "Cluster: $CLUSTER_API"

# Agent repo
if [[ -z "$AGENT_REPO" ]]; then
  error "--agent-repo is required. Usage: $0 --agent-repo /path/to/pulse-agent"
  exit 1
fi
if [[ ! -d "$AGENT_REPO" ]]; then
  error "Agent repo not found: $AGENT_REPO"
  exit 1
fi
if [[ ! -f "$AGENT_REPO/chart/Chart.yaml" ]]; then
  error "Agent repo missing chart/Chart.yaml: $AGENT_REPO"
  exit 1
fi
AGENT_REPO="$(cd "$AGENT_REPO" && pwd)"
info "Agent repo: $AGENT_REPO"

# ─── Detect Cluster Configuration ───────────────────────────────────────────

step "Detecting cluster configuration"

# OAuth proxy image — use the cluster's own oauth-proxy ImageStream
OAUTH_TAG=$(oc get imagestream oauth-proxy -n openshift -o jsonpath='{.status.tags[0].tag}' 2>/dev/null || echo "")
if [[ -z "$OAUTH_TAG" ]]; then
  warn "oauth-proxy ImageStream not found — using registry.redhat.io fallback"
  OAUTH_IMAGE="registry.redhat.io/openshift4/ose-oauth-proxy:v4.17"
else
  OAUTH_IMAGE="image-registry.openshift-image-registry.svc:5000/openshift/oauth-proxy:${OAUTH_TAG}"
fi
info "OAuth proxy: $OAUTH_IMAGE"

# Cluster apps domain (for OAuth redirect URI)
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null || echo "")
if [[ -z "$CLUSTER_DOMAIN" ]]; then
  error "Could not detect cluster apps domain. Set manually:"
  error "  $0 ... # then: oc patch oauthclient openshiftpulse --type merge -p '{\"redirectURIs\":[\"https://<route>/oauth/callback\"]}'"
  exit 1
fi
info "Apps domain: $CLUSTER_DOMAIN"

# Check if monitoring stack is available
PROM_AVAILABLE=$(oc get service thanos-querier -n openshift-monitoring -o name 2>/dev/null || echo "")
if [[ -z "$PROM_AVAILABLE" ]]; then
  warn "Prometheus (thanos-querier) not found in openshift-monitoring — metrics will be disabled"
  MONITORING_ENABLED="false"
else
  MONITORING_ENABLED="true"
fi

# Agent deployment name (derived from helm release name + chart name)
AGENT_DEPLOY="${AGENT_RELEASE}-openshift-sre-agent"

info "Namespace: $NAMESPACE"
info "Agent deploy: $AGENT_DEPLOY"

# ─── Deploy Pulse UI ────────────────────────────────────────────────────────

step "Building Pulse UI"
cd "$PROJECT_DIR"
npm run build --silent
info "Build complete"

step "Helm install/upgrade Pulse UI"
HELM_CMD="upgrade --install"
helm $HELM_CMD openshiftpulse deploy/helm/openshiftpulse/ \
  -n "$NAMESPACE" --create-namespace \
  --set oauthProxy.image="$OAUTH_IMAGE" \
  --set route.clusterDomain="$CLUSTER_DOMAIN" \
  --set agent.serviceName="$AGENT_DEPLOY" \
  --set agent.wsToken="$WS_TOKEN" \
  --set monitoring.prometheus.enabled="$MONITORING_ENABLED" \
  --set monitoring.alertmanager.enabled="$MONITORING_ENABLED" \
  --wait --timeout 60s
info "Helm release: openshiftpulse"

# Fix OAuth redirect URI using actual route host
ROUTE=$(wait_for_route "openshiftpulse" "$NAMESPACE")
if [[ -n "$ROUTE" ]]; then
  oc patch oauthclient openshiftpulse --type merge \
    -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}" 2>/dev/null || true
  info "OAuth redirect: https://$ROUTE/oauth/callback"
else
  warn "Route not ready — OAuth redirect URI may need manual fix"
fi

# S2I build
step "Building Pulse UI image"
oc start-build openshiftpulse --from-dir=dist --follow -n "$NAMESPACE"
info "UI image built"

# ─── Deploy Pulse Agent ─────────────────────────────────────────────────────

step "Helm install/upgrade Agent"
cd "$AGENT_REPO"
helm upgrade --install "$AGENT_RELEASE" chart/ \
  -n "$NAMESPACE" \
  --set rbac.allowWriteOperations=true \
  --set rbac.allowSecretAccess=true \
  --wait --timeout 60s
info "Helm release: $AGENT_RELEASE"

# Build agent image (two-stage: deps base + code overlay)
step "Building Agent image"

INTERNAL_REGISTRY="image-registry.openshift-image-registry.svc:5000"
BASE_IMAGE="${INTERNAL_REGISTRY}/${NAMESPACE}/pulse-agent-deps:latest"

# Ensure deps base image exists and is up-to-date
DEPS_HASH=$(file_hash "$AGENT_REPO/pyproject.toml")
CURRENT_HASH=$(oc get istag pulse-agent-deps:latest -n "$NAMESPACE" \
  -o jsonpath='{.image.dockerImageMetadata.Config.Labels.deps-hash}' 2>/dev/null || echo "none")

if [[ "$DEPS_HASH" != "$CURRENT_HASH" ]]; then
  info "Deps image needs rebuild (pyproject.toml changed)..."
  oc create imagestream pulse-agent-deps -n "$NAMESPACE" 2>/dev/null || true
  if ! oc get bc pulse-agent-deps -n "$NAMESPACE" &>/dev/null; then
    cat <<EOF | oc apply -f - -n "$NAMESPACE"
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata:
  name: pulse-agent-deps
  namespace: $NAMESPACE
spec:
  output:
    to:
      kind: ImageStreamTag
      name: "pulse-agent-deps:latest"
  source:
    type: Binary
  strategy:
    type: Docker
    dockerStrategy:
      dockerfilePath: Dockerfile.deps
EOF
  fi
  oc start-build pulse-agent-deps --from-dir=. --build-arg="DEPS_HASH=$DEPS_HASH" --follow -n "$NAMESPACE"
  info "Deps image rebuilt"
else
  info "Deps image up-to-date (hash: ${DEPS_HASH:0:12}...)"
fi

# Ensure code BC exists and uses deps as base
oc get bc pulse-agent -n "$NAMESPACE" &>/dev/null || \
  oc new-build --binary --name=pulse-agent --to=pulse-agent:latest -n "$NAMESPACE"
oc patch bc pulse-agent -n "$NAMESPACE" --type=json \
  -p="[{\"op\":\"replace\",\"path\":\"/spec/strategy/dockerStrategy\",\"value\":{\"from\":{\"kind\":\"ImageStreamTag\",\"name\":\"pulse-agent-deps:latest\"},\"buildArgs\":[{\"name\":\"BASE_IMAGE\",\"value\":\"$BASE_IMAGE\"}]}}]" \
  2>/dev/null || true

# Code-only build
info "Building code image..."
if ! oc start-build pulse-agent --from-dir=. --follow -n "$NAMESPACE"; then
  if ! oc get istag pulse-agent-deps:latest -n "$NAMESPACE" &>/dev/null; then
    warn "Deps image missing — falling back to full single-stage build..."
    oc patch bc pulse-agent -n "$NAMESPACE" --type=json \
      -p='[{"op":"replace","path":"/spec/strategy/dockerStrategy","value":{"dockerfilePath":"Dockerfile.full"}}]'
    oc start-build pulse-agent --from-dir=. --follow -n "$NAMESPACE"
    # Restore for next time
    oc patch bc pulse-agent -n "$NAMESPACE" --type=json \
      -p="[{\"op\":\"replace\",\"path\":\"/spec/strategy/dockerStrategy\",\"value\":{\"from\":{\"kind\":\"ImageStreamTag\",\"name\":\"pulse-agent-deps:latest\"}}}]"
  else
    error "Code build failed but deps image exists. Check build logs:"
    error "  oc logs bc/pulse-agent -n $NAMESPACE"
    exit 1
  fi
fi
info "Agent image built"

# Configure agent deployment
step "Configuring Agent"
AGENT_DIGEST=$(oc get istag pulse-agent:latest -n "$NAMESPACE" -o jsonpath='{.image.dockerImageReference}')
oc set image "deployment/$AGENT_DEPLOY" "sre-agent=$AGENT_DIGEST" -n "$NAMESPACE"
oc set env "deployment/$AGENT_DEPLOY" \
  PULSE_AGENT_WS_TOKEN="$WS_TOKEN" \
  ANTHROPIC_VERTEX_PROJECT_ID="${ANTHROPIC_VERTEX_PROJECT_ID:-}" \
  CLOUD_ML_REGION="${CLOUD_ML_REGION:-}" \
  -n "$NAMESPACE"

# Mount GCP credentials if available locally
if [[ -f "$HOME/.config/gcloud/application_default_credentials.json" ]]; then
  info "Mounting GCP credentials..."
  oc get secret gcp-sa-key -n "$NAMESPACE" &>/dev/null || \
    oc create secret generic gcp-sa-key \
      --from-file=key.json="$HOME/.config/gcloud/application_default_credentials.json" \
      -n "$NAMESPACE"
  oc set volume "deployment/$AGENT_DEPLOY" --add --name=gcp-sa-key \
    --secret-name=gcp-sa-key --mount-path=/var/secrets/google --read-only \
    -n "$NAMESPACE" 2>/dev/null || true
  oc set env "deployment/$AGENT_DEPLOY" \
    GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google/key.json \
    -n "$NAMESPACE"
fi

# ─── Restart & Verify ───────────────────────────────────────────────────────

step "Restarting deployments"
oc rollout restart "deployment/openshiftpulse" -n "$NAMESPACE"
oc rollout restart "deployment/$AGENT_DEPLOY" -n "$NAMESPACE"

wait_for_rollout "openshiftpulse" "$NAMESPACE" 120
wait_for_rollout "$AGENT_DEPLOY" "$NAMESPACE" 120

# Health check with retry
info "Verifying agent health..."
HEALTHY=false
for i in 1 2 3 4 5; do
  sleep 5
  HEALTH=$(oc exec "deployment/$AGENT_DEPLOY" -n "$NAMESPACE" -- curl -sf http://localhost:8080/healthz 2>/dev/null || echo "")
  if [[ "$HEALTH" == *"ok"* ]]; then
    HEALTHY=true
    break
  fi
done

echo ""
echo "════════════════════════════════════════════"
if [[ "$HEALTHY" == "true" ]]; then
  info "Deploy complete!"
else
  warn "Agent health check did not pass — it may still be starting"
fi
echo ""
echo "  URL:     https://$ROUTE"
echo "  Cluster: $CLUSTER_API"
echo "  NS:      $NAMESPACE"
VERSION=$(oc exec "deployment/$AGENT_DEPLOY" -n "$NAMESPACE" -- curl -sf http://localhost:8080/version 2>/dev/null || echo "")
if [[ -n "$VERSION" ]]; then
  echo "  Agent:   $VERSION"
fi
echo ""
echo "  Run integration tests: ./deploy/integration-test.sh --namespace $NAMESPACE"
echo "════════════════════════════════════════════"
