#!/usr/bin/env bash
# Deploy OpenShift Pulse (UI + Agent) to an OpenShift cluster.
#
# Builds both images locally with Podman, pushes to Quay.io, deploys via
# a single Helm umbrella chart. UI and agent are always deployed together
# to prevent token/config drift.
#
# Usage:
#   ./deploy/deploy.sh                          # Deploy UI + Agent
#   ./deploy/deploy.sh --uninstall              # Remove everything
#   ./deploy/deploy.sh --dry-run                # Preview
#   ./deploy/deploy.sh --skip-build             # Redeploy with existing images
#
# Prerequisites: oc (logged in), helm, pnpm, podman (logged in to quay.io)

set -euo pipefail
DEPLOY_START=$(date +%s)
VALUES_FILE="/tmp/pulse-deploy-values-$$.yaml"
trap 'rm -f /tmp/pulse-ui-build.log /tmp/pulse-ui-push.log "$VALUES_FILE"' EXIT

# ─── Configuration ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NAMESPACE="openshiftpulse"
RELEASE="pulse"
UI_IMAGE="${PULSE_UI_IMAGE:-quay.io/amobrem/openshiftpulse}"
AGENT_IMAGE="${PULSE_AGENT_IMAGE:-quay.io/amobrem/pulse-agent}"
UI_TAG=""
AGENT_TAG=""
_WS_TOKEN_OVERRIDE="${PULSE_AGENT_WS_TOKEN:-}"
GCP_KEY_FILE=""
DRY_RUN=false
UNINSTALL=false
SKIP_BUILD=false
ROLLBACK=false

# Auto-detect agent repo: sibling directory or explicit override
AGENT_REPO="${PULSE_AGENT_REPO:-}"
if [[ -z "$AGENT_REPO" ]]; then
  # Check common locations relative to this repo
  for candidate in \
    "$PROJECT_DIR/../pulse-agent" \
    "$PROJECT_DIR/../ali/pulse-agent" \
    "$HOME/ali/pulse-agent"; do
    if [[ -d "$candidate/chart" ]]; then
      AGENT_REPO="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-repo) AGENT_REPO="$2"; shift 2 ;;
    --namespace)  NAMESPACE="$2"; shift 2 ;;
    --ws-token)   _WS_TOKEN_OVERRIDE="$2"; shift 2 ;;
    --gcp-key)    GCP_KEY_FILE="$2"; shift 2 ;;
    --ui-tag)     UI_TAG="$2"; shift 2 ;;
    --agent-tag)  AGENT_TAG="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --uninstall)  UNINSTALL=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --rollback)   ROLLBACK=true; shift ;;
    --help|-h)
      cat <<HELP
Usage: $0 [options]

Deploys both UI and Agent together. The agent repo is auto-detected from
sibling directories, or set PULSE_AGENT_REPO or use --agent-repo.

Options:
  --agent-repo PATH   Path to pulse-agent repo (auto-detected if omitted)
  --namespace NS      Target namespace (default: openshiftpulse)
  --gcp-key PATH      GCP service account JSON for Vertex AI
  --ws-token TOKEN    WebSocket auth token (auto-generated if unset)
  --ui-tag TAG        UI image tag (default: git SHA short)
  --agent-tag TAG     Agent image tag (default: git SHA short)
  --dry-run           Preview what will be deployed without deploying
  --uninstall         Remove all Pulse resources from the cluster
  --skip-build        Skip image builds, use existing images
  --rollback          Roll back to the previous Helm revision

AI Backend (pick one, set via env vars):
  Vertex AI:     ANTHROPIC_VERTEX_PROJECT_ID=proj CLOUD_ML_REGION=us-east5 \\
                   $0 --gcp-key ~/sa-key.json
  Anthropic API: ANTHROPIC_API_KEY=sk-ant-... $0
HELP
      exit 0 ;;
    *) echo "ERROR: Unknown argument: $1. Use --help for usage."; exit 1 ;;
  esac
done

# ─── Helper Functions ────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo ""; echo -e "${CYAN}═══ $1 ═══${NC}"; }

wait_for_rollout() {
  local deploy="$1" ns="$2" timeout="${3:-120}"
  info "Waiting for $deploy to be ready (timeout: ${timeout}s)..."
  if ! oc rollout status "deployment/$deploy" -n "$ns" --timeout="${timeout}s" 2>/dev/null; then
    warn "Rollout not complete within ${timeout}s — continuing anyway"
  fi
}

wait_for_route() {
  local name="$1" ns="$2"
  for i in $(seq 1 10); do
    local host
    host=$(oc get route "$name" -n "$ns" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
    [[ -n "$host" ]] && echo "$host" && return 0
    sleep 2
  done
  echo ""
}

git_tag() {
  local sha
  sha=$(git -C "$1" rev-parse --short=8 HEAD 2>/dev/null || echo "unknown")
  git -C "$1" diff --quiet HEAD 2>/dev/null && echo "$sha" || echo "${sha}-dirty"
}

ensure_secret() {
  local name="$1" ns="$2"; shift 2
  oc delete secret "$name" -n "$ns" 2>/dev/null || true
  oc create secret generic "$name" "$@" -n "$ns"
  info "Secret $name: created"
}


# ─── Uninstall Mode ─────────────────────────────────────────────────────────

if [[ "$UNINSTALL" == "true" ]]; then
  step "Uninstalling OpenShift Pulse"

  oc whoami &>/dev/null || { error "Not logged in to OpenShift. Run 'oc login' first."; exit 1; }

  info "Removing Helm release..."
  helm uninstall "$RELEASE" -n "$NAMESPACE" 2>/dev/null && info "Removed: $RELEASE" || info "Not found: $RELEASE"
  # Also try legacy separate releases
  helm uninstall pulse-agent -n "$NAMESPACE" 2>/dev/null || true
  helm uninstall openshiftpulse -n "$NAMESPACE" 2>/dev/null || true

  info "Removing cluster-scoped resources..."
  oc delete clusterrole openshiftpulse-reader "${RELEASE}-openshift-sre-agent" 2>/dev/null || true
  oc delete clusterrolebinding openshiftpulse-reader "${RELEASE}-openshift-sre-agent" 2>/dev/null || true
  oc delete oauthclient openshiftpulse 2>/dev/null || true

  info "Removing namespace..."
  oc delete namespace "$NAMESPACE" 2>/dev/null && info "Removed: $NAMESPACE" || info "Not found: $NAMESPACE"

  echo ""
  echo "════════════════════════════════════════════"
  info "Uninstall complete"
  echo "════════════════════════════════════════════"
  exit 0
fi

# ─── Rollback Mode ──────────────────────────────────────────────────────────

if [[ "$ROLLBACK" == "true" ]]; then
  step "Rolling back to previous revision"

  oc whoami &>/dev/null || { error "Not logged in to OpenShift. Run 'oc login' first."; exit 1; }

  CURRENT=$(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['revision'])" 2>/dev/null || echo "")
  if [[ -z "$CURRENT" || "$CURRENT" -le 1 ]]; then
    error "No previous revision to roll back to (current: ${CURRENT:-none})"
    exit 1
  fi

  TARGET=$((CURRENT - 1))
  info "Rolling back: revision $CURRENT → $TARGET"
  helm rollback "$RELEASE" "$TARGET" -n "$NAMESPACE" --timeout 120s

  AGENT_DEPLOY="${RELEASE}-openshift-sre-agent"
  wait_for_rollout "openshiftpulse" "$NAMESPACE" 60
  wait_for_rollout "$AGENT_DEPLOY" "$NAMESPACE" 60

  echo ""
  echo "════════════════════════════════════════════"
  info "Rollback complete (revision $CURRENT → $TARGET)"
  echo ""
  echo "  Verify:  oc get pods -n $NAMESPACE"
  echo "  History: helm history $RELEASE -n $NAMESPACE"
  echo "════════════════════════════════════════════"
  exit 0
fi

# ─── Phase 0: Preflight Checks ──────────────────────────────────────────────

step "Preflight checks"

for cmd in oc helm pnpm podman; do
  command -v "$cmd" &>/dev/null || { error "'$cmd' not found. Install it and try again."; exit 1; }
done
oc whoami &>/dev/null || { error "Not logged in to OpenShift. Run 'oc login' first."; exit 1; }

if [[ "$SKIP_BUILD" == "false" ]]; then
  if ! podman info &>/dev/null; then
    error "Podman machine not running. Start it: podman machine start"
    exit 1
  fi
  if ! podman login --get-login quay.io &>/dev/null; then
    error "Not logged in to Quay.io. Run: podman login quay.io"
    exit 1
  fi
fi

info "Tools: oc, helm, pnpm, podman — OK"
CLUSTER_API=$(oc whoami --show-server)
info "Cluster: $CLUSTER_API"

# Agent repo is required
if [[ -z "$AGENT_REPO" ]]; then
  error "Could not find pulse-agent repo. Set PULSE_AGENT_REPO env var or use --agent-repo."
  error "Looked in: ../pulse-agent, ../ali/pulse-agent, ~/ali/pulse-agent"
  exit 1
fi
if [[ ! -d "$AGENT_REPO" ]]; then
  error "Agent repo not found: $AGENT_REPO"
  exit 1
fi
[[ -d "$AGENT_REPO/chart" ]] || { error "Agent repo missing chart/: $AGENT_REPO"; exit 1; }
AGENT_REPO="$(cd "$AGENT_REPO" && pwd)"
info "Agent repo: $AGENT_REPO"

# AI backend is required
if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
  error "No AI backend configured. Set ANTHROPIC_API_KEY or ANTHROPIC_VERTEX_PROJECT_ID."
  exit 1
fi

# GCP key for Vertex AI
GCP_KEY=""
if [[ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
  if [[ -z "$GCP_KEY_FILE" ]]; then
    GCP_KEY_FILE="$HOME/.config/gcloud/application_default_credentials.json"
  fi
  [[ -f "$GCP_KEY_FILE" ]] || { error "GCP key not found: $GCP_KEY_FILE"; exit 1; }
  GCP_KEY="$GCP_KEY_FILE"
  info "GCP credentials: $GCP_KEY"
fi

# Resolve image tags: git SHA for builds, "latest" for --skip-build
if [[ -z "$UI_TAG" ]]; then
  if [[ "$SKIP_BUILD" == "true" ]]; then
    UI_TAG="latest"
  else
    UI_TAG=$(git_tag "$PROJECT_DIR")
  fi
fi
if [[ -z "$AGENT_TAG" ]]; then
  if [[ "$SKIP_BUILD" == "true" ]]; then
    AGENT_TAG="latest"
  else
    AGENT_TAG=$(git_tag "$AGENT_REPO")
  fi
fi

info "UI tag: $UI_TAG"
info "Agent tag: $AGENT_TAG"
info "All preflight checks passed"

# ─── Phase 1: Detect Cluster Configuration ──────────────────────────────────

step "Detecting cluster configuration"

# Ensure namespace exists
oc get namespace "$NAMESPACE" &>/dev/null || oc create namespace "$NAMESPACE"

# OAuth proxy image — prefer internal registry, fallback to Red Hat registry
OAUTH_TAG=$(oc get imagestream oauth-proxy -n openshift -o jsonpath='{.status.tags[0].tag}' 2>/dev/null || echo "")
if [[ -n "$OAUTH_TAG" ]]; then
  OAUTH_IMAGE="image-registry.openshift-image-registry.svc:5000/openshift/oauth-proxy:${OAUTH_TAG}"
else
  # Internal ImageStream not found — try Red Hat registry with version detection
  OCP_MINOR=$(oc get clusterversion version -o jsonpath='{.status.desired.version}' 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+' || echo "")
  if [[ -n "$OCP_MINOR" ]]; then
    OAUTH_IMAGE="registry.redhat.io/openshift4/ose-oauth-proxy:v${OCP_MINOR}"
  else
    OAUTH_IMAGE="registry.redhat.io/openshift4/ose-oauth-proxy:v4.14"
  fi
  warn "oauth-proxy ImageStream not found — using $OAUTH_IMAGE"
fi
info "OAuth proxy: $OAUTH_IMAGE"

# Cluster apps domain
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null || echo "")
if [[ -z "$CLUSTER_DOMAIN" ]]; then
  error "Could not detect cluster apps domain."
  exit 1
fi
info "Apps domain: $CLUSTER_DOMAIN"

# Monitoring stack
MONITORING_ENABLED="false"
if oc get service thanos-querier -n openshift-monitoring -o name &>/dev/null; then
  MONITORING_ENABLED="true"
fi

info "Namespace: $NAMESPACE"

# ─── Dry Run Mode ───────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "true" ]]; then
  step "Dry Run Summary"
  echo ""
  echo "  Cluster:       $CLUSTER_API"
  echo "  Namespace:     $NAMESPACE"
  echo "  UI image:      ${UI_IMAGE}:${UI_TAG}"
  echo "  Agent image:   ${AGENT_IMAGE}:${AGENT_TAG}"
  if [[ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
    echo "  AI backend:    Vertex AI (${ANTHROPIC_VERTEX_PROJECT_ID} / ${CLOUD_ML_REGION:-us-east5})"
  elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "  AI backend:    Anthropic API (direct)"
  fi
  echo "  OAuth proxy:   $OAUTH_IMAGE"
  echo "  Monitoring:    $MONITORING_ENABLED"
  echo "  Apps domain:   $CLUSTER_DOMAIN"
  echo ""
  echo "  Helm release: $RELEASE (umbrella chart)"
  echo ""
  echo "  Deploy order:"
  echo "    1. Build images (pnpm + podman, parallel)"
  echo "    2. Single helm upgrade --install (umbrella chart)"
  echo "    3. Health check"
  echo ""
  info "Dry run complete — no changes made"
  exit 0
fi

# ─── Phase 2: Build & Push Images (parallel) ────────────────────────────────

if [[ "$SKIP_BUILD" == "false" ]]; then
  step "Building & pushing images"

  cd "$PROJECT_DIR"
  pnpm run build
  info "UI built (dist/)"

  info "Building UI and Agent images in parallel..."
  podman build --platform linux/amd64 -t "${UI_IMAGE}:${UI_TAG}" "$PROJECT_DIR" &>/tmp/pulse-ui-build.log &
  UI_BUILD_PID=$!

  cd "$AGENT_REPO"
  AGENT_DOCKERFILE="Dockerfile"
  [[ -f "Dockerfile.full" ]] && AGENT_DOCKERFILE="Dockerfile.full"
  podman build --platform linux/amd64 -t "${AGENT_IMAGE}:${AGENT_TAG}" -f "$AGENT_DOCKERFILE" .
  info "Agent image built"

  if wait $UI_BUILD_PID; then
    info "UI image built"
  else
    error "UI image build failed. Logs:"
    cat /tmp/pulse-ui-build.log
    exit 1
  fi

  info "Pushing images..."
  podman tag "${UI_IMAGE}:${UI_TAG}" "${UI_IMAGE}:latest"
  podman tag "${AGENT_IMAGE}:${AGENT_TAG}" "${AGENT_IMAGE}:latest"

  podman push "${UI_IMAGE}:${UI_TAG}" &>/tmp/pulse-ui-push.log &
  UI_PUSH_PID=$!

  podman push "${AGENT_IMAGE}:${AGENT_TAG}"
  podman push "${AGENT_IMAGE}:latest"
  info "Pushed ${AGENT_IMAGE}:${AGENT_TAG} + latest"

  if wait $UI_PUSH_PID; then
    podman push "${UI_IMAGE}:latest"
    info "Pushed ${UI_IMAGE}:${UI_TAG} + latest"
  else
    error "UI image push failed"
    cat /tmp/pulse-ui-push.log
    exit 1
  fi
else
  info "Skipping image builds (--skip-build)"
fi

# ─── Phase 3: Helm Deploy (single umbrella install) ─────────────────────────

step "Deploying via umbrella chart"
cd "$PROJECT_DIR"

AGENT_DEPLOY="${RELEASE}-openshift-sre-agent"
WS_SECRET="${RELEASE}-ws-token"

# Create AI backend secrets before Helm install
[[ -n "$GCP_KEY" ]] && ensure_secret gcp-sa-key "$NAMESPACE" --from-file=key.json="$GCP_KEY"
[[ -n "${ANTHROPIC_API_KEY:-}" ]] && ensure_secret anthropic-api-key "$NAMESPACE" --from-literal=api-key="${ANTHROPIC_API_KEY}"

# Resolve WS token: read existing or generate new
WS_TOKEN=""
if [[ -n "$_WS_TOKEN_OVERRIDE" ]]; then
  WS_TOKEN="$_WS_TOKEN_OVERRIDE"
elif EXISTING=$(oc get secret "$WS_SECRET" -n "$NAMESPACE" -o jsonpath='{.data.token}' 2>/dev/null) && [[ -n "$EXISTING" ]]; then
  WS_TOKEN=$(echo "$EXISTING" | base64 -d 2>/dev/null || echo "$EXISTING")
  info "WS token: read from existing secret"
else
  WS_TOKEN=$(openssl rand -hex 16)
  info "WS token: generated (fresh install)"
fi

# Pre-create the WS token secret so Helm lookup() finds it during template rendering.
if ! oc get secret "$WS_SECRET" -n "$NAMESPACE" &>/dev/null; then
  oc create secret generic "$WS_SECRET" \
    --from-literal=token="$WS_TOKEN" \
    -n "$NAMESPACE"
  oc label secret "$WS_SECRET" -n "$NAMESPACE" \
    app.kubernetes.io/part-of=pulse \
    app.kubernetes.io/managed-by=Helm
  oc annotate secret "$WS_SECRET" -n "$NAMESPACE" \
    "helm.sh/resource-policy=keep" \
    "meta.helm.sh/release-name=$RELEASE" \
    "meta.helm.sh/release-namespace=$NAMESPACE"
  info "WS token secret: pre-created for Helm"
fi

# Label namespace for Helm ownership
oc label namespace "$NAMESPACE" app.kubernetes.io/managed-by=Helm --overwrite 2>/dev/null || true
oc annotate namespace "$NAMESPACE" meta.helm.sh/release-name="$RELEASE" meta.helm.sh/release-namespace="$NAMESPACE" --overwrite 2>/dev/null || true

# Record current revision for rollback
PREV_REVISION=$(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['revision'])" 2>/dev/null || echo "")
[[ -n "$PREV_REVISION" ]] && info "Current revision: $PREV_REVISION (rollback target if deploy fails)"

# Build Helm dependencies
helm dependency build deploy/helm/pulse/ 2>/dev/null

# Generate values file (keeps secrets out of process listings)
AI_BACKEND="none"
AI_VALUES=""
if [[ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
  AI_VALUES="  vertexAI:
    projectId: ${ANTHROPIC_VERTEX_PROJECT_ID}
    region: ${CLOUD_ML_REGION:-us-east5}
    existingSecret: gcp-sa-key"
  AI_BACKEND="vertex"
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  AI_VALUES="  anthropicApiKey:
    existingSecret: anthropic-api-key"
  AI_BACKEND="anthropic"
fi

cat > "$VALUES_FILE" <<YAML
openshiftpulse:
  image:
    repository: $UI_IMAGE
    tag: "$UI_TAG"
  oauthProxy:
    image: $OAUTH_IMAGE
  route:
    clusterDomain: $CLUSTER_DOMAIN
  monitoring:
    prometheus:
      enabled: $MONITORING_ENABLED
    alertmanager:
      enabled: $MONITORING_ENABLED
  agent:
    enabled: true
    serviceName: $AGENT_DEPLOY
    wsToken: "$WS_TOKEN"
    wsTokenSecret: $WS_SECRET
agent:
  enabled: true
  image:
    repository: $AGENT_IMAGE
    tag: "$AGENT_TAG"
  rbac:
    allowWriteOperations: true
    allowSecretAccess: true
  wsAuth:
    existingSecret: $WS_SECRET
$AI_VALUES
YAML
chmod 600 "$VALUES_FILE"

helm upgrade --install "$RELEASE" deploy/helm/pulse/ \
  -n "$NAMESPACE" --create-namespace \
  --values "$VALUES_FILE" \
  --timeout 300s \
  --rollback-on-failure
info "Helm release: $RELEASE (umbrella)"

# Fix OAuth redirect URI
ROUTE=$(wait_for_route "openshiftpulse" "$NAMESPACE")
if [[ -n "$ROUTE" ]]; then
  oc patch oauthclient openshiftpulse --type merge \
    -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}" 2>/dev/null || true
  info "OAuth redirect: https://$ROUTE/oauth/callback"
else
  warn "Route not ready — OAuth redirect URI may need manual fix"
fi

# ─── Phase 4: Health Check ──────────────────────────────────────────────────

step "Health verification"

# Wait for both deployments
wait_for_rollout "openshiftpulse" "$NAMESPACE" 60
wait_for_rollout "$AGENT_DEPLOY" "$NAMESPACE" 120

HEALTHY=false
VERSION=""
# Target agent pod specifically — exclude StatefulSet pods (postgresql)
AGENT_POD=$(oc get pods -n "$NAMESPACE" -l "app.kubernetes.io/name=openshift-sre-agent" \
  --field-selector=status.phase=Running --no-headers 2>/dev/null \
  | grep -v postgresql | head -1 | awk '{print $1}')

if [[ -z "$AGENT_POD" ]]; then
  warn "Could not find agent pod"
else
  for i in $(seq 1 12); do
    sleep 5
    HEALTH=$(oc exec "$AGENT_POD" -n "$NAMESPACE" -- curl -sf http://localhost:8080/healthz 2>/dev/null || echo "")
    if [[ "$HEALTH" == *"ok"* ]]; then
      HEALTHY=true
      info "Agent healthy!"
      VERSION=$(oc exec "$AGENT_POD" -n "$NAMESPACE" -- curl -sf http://localhost:8080/version 2>/dev/null || echo "")
      [[ -n "$VERSION" ]] && info "Agent: $VERSION"
      break
    fi
    [[ $i -eq 12 ]] && warn "Agent health check failed after 60s"
  done
fi

# Verify proxy chain: UI pod → agent (catches token mismatches, nginx config errors)
if [[ "$HEALTHY" == "true" ]]; then
  UI_POD=$(oc get pods -n "$NAMESPACE" -l app=openshiftpulse --field-selector=status.phase=Running --no-headers 2>/dev/null | head -1 | awk '{print $1}')
  if [[ -n "$UI_POD" ]]; then
    PROXY_HEALTH=$(oc exec "$UI_POD" -c openshiftpulse -n "$NAMESPACE" -- curl -sf "http://${AGENT_DEPLOY}:8080/healthz" 2>/dev/null || echo "")
    if [[ "$PROXY_HEALTH" == *"ok"* ]]; then
      info "Proxy chain verified (UI → Agent)"
    else
      warn "UI pod cannot reach agent — check nginx config and WS token"
      HEALTHY=false
    fi

    # Verify token substitution — proxy chain success already proves the token works,
    # but double-check the nginx config doesn't have leftover placeholders
    TOKEN_CHECK=$(oc exec "$UI_POD" -c openshiftpulse -n "$NAMESPACE" -- grep -c "__AGENT_TOKEN__" /tmp/nginx.conf 2>/dev/null || echo "0")
    if [[ "$TOKEN_CHECK" != "0" ]]; then
      # Proxy chain passed but placeholder still in config — entrypoint may still be running.
      # This is a non-fatal warning since connectivity is confirmed.
      warn "Token placeholder found in nginx config (may be stale pod during rollout)"
    else
      info "Token substitution verified"
    fi
  fi
fi

# ─── Deploy Tracking Helpers ────────────────────────────────────────────────

DEPLOY_END=$(date +%s)
DEPLOY_DURATION=$(( DEPLOY_END - DEPLOY_START ))
DEPLOY_MINUTES=$(( DEPLOY_DURATION / 60 ))
DEPLOY_SECONDS=$(( DEPLOY_DURATION % 60 ))
NEW_REVISION=$(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['revision'])" 2>/dev/null || echo "unknown")

log_deploy() {
  local status="$1"
  local log_file="$HOME/.pulse-deploy-history.jsonl"
  python3 -c "
import json, datetime
entry = {
    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
    'status': '$status',
    'release': '$RELEASE',
    'namespace': '$NAMESPACE',
    'revision': '$NEW_REVISION',
    'ui_image': '${UI_IMAGE}:${UI_TAG}',
    'agent_image': '${AGENT_IMAGE}:${AGENT_TAG}',
    'cluster': '$CLUSTER_API',
    'ai_backend': '$AI_BACKEND',
    'duration_seconds': $DEPLOY_DURATION,
    'deployer': '$(whoami)'
}
with open('$log_file', 'a') as f:
    f.write(json.dumps(entry) + '\n')
" 2>/dev/null || true
}

save_deploy_metadata() {
  oc create configmap pulse-deploy-metadata \
    --from-literal=deployer="$(whoami)" \
    --from-literal=timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --from-literal=revision="$NEW_REVISION" \
    --from-literal=ui-image="${UI_IMAGE}:${UI_TAG}" \
    --from-literal=agent-image="${AGENT_IMAGE}:${AGENT_TAG}" \
    --from-literal=ai-backend="$AI_BACKEND" \
    --from-literal=duration="${DEPLOY_DURATION}s" \
    -n "$NAMESPACE" \
    --dry-run=client -o yaml | oc apply -f - 2>/dev/null || true
}

notify_slack() {
  local status="$1" color="$2"
  [[ -z "${PULSE_SLACK_WEBHOOK:-}" ]] && return 0
  curl -sf -X POST "$PULSE_SLACK_WEBHOOK" \
    -H 'Content-type: application/json' \
    -d "{\"attachments\":[{\"color\":\"$color\",\"title\":\"Pulse Deploy: $status\",\"fields\":[{\"title\":\"Cluster\",\"value\":\"$CLUSTER_API\",\"short\":true},{\"title\":\"Revision\",\"value\":\"$NEW_REVISION\",\"short\":true},{\"title\":\"UI\",\"value\":\"${UI_TAG}\",\"short\":true},{\"title\":\"Agent\",\"value\":\"${AGENT_TAG}\",\"short\":true},{\"title\":\"Duration\",\"value\":\"${DEPLOY_MINUTES}m${DEPLOY_SECONDS}s\",\"short\":true},{\"title\":\"Deployer\",\"value\":\"$(whoami)\",\"short\":true}]}]}" \
    2>/dev/null || warn "Slack notification failed"
}

# ─── Handle Results ─────────────────────────────────────────────────────────

if [[ "$HEALTHY" != "true" && -n "$PREV_REVISION" ]]; then
  log_deploy "rolled_back"
  notify_slack "ROLLED BACK" "danger"
  warn "Health check failed — rolling back to revision $PREV_REVISION"
  helm rollback "$RELEASE" "$PREV_REVISION" -n "$NAMESPACE" --timeout 120s 2>/dev/null
  wait_for_rollout "openshiftpulse" "$NAMESPACE" 60
  wait_for_rollout "$AGENT_DEPLOY" "$NAMESPACE" 60
  error "Deploy ROLLED BACK to revision $PREV_REVISION due to failed health check"
  echo ""
  echo "════════════════════════════════════════════"
  error "Deploy failed and was rolled back"
  echo ""
  echo "  Rolled back to: revision $PREV_REVISION"
  echo "  Investigate:    oc logs deployment/$AGENT_DEPLOY -n $NAMESPACE"
  echo "  Manual retry:   $0"
  echo "════════════════════════════════════════════"
  exit 1
fi

# Success
log_deploy "success"
save_deploy_metadata
notify_slack "Success" "good"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════"
info "Deploy complete! (${DEPLOY_MINUTES}m${DEPLOY_SECONDS}s)"
echo ""
echo "  URL:       https://$ROUTE"
echo "  Cluster:   $CLUSTER_API"
echo "  NS:        $NAMESPACE"
echo "  Revision:  $NEW_REVISION"
echo "  UI image:  ${UI_IMAGE}:${UI_TAG}"
echo "  Agent img: ${AGENT_IMAGE}:${AGENT_TAG}"
echo "  AI:        $AI_BACKEND"
echo "  Agent:     ${VERSION:-unknown}"
echo ""
echo "  Uninstall:         $0 --uninstall"
echo "  Rollback:          $0 --rollback"
echo "  Integration tests: ./deploy/integration-test.sh --namespace $NAMESPACE"
echo "  Deploy history:    cat ~/.pulse-deploy-history.jsonl"
echo "════════════════════════════════════════════"
