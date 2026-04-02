#!/usr/bin/env bash
# Deploy OpenShift Pulse (UI + Agent) to an OpenShift cluster.
#
# Builds images locally with Podman, pushes to Quay.io, deploys via Helm.
# Never uses S2I or on-cluster builds.
#
# Usage:
#   ./deploy/deploy.sh                                  # UI only (no agent)
#   ./deploy/deploy.sh --agent-repo /path/to/pulse-agent # UI + Agent
#   ./deploy/deploy.sh --uninstall                       # Remove everything
#   ./deploy/deploy.sh --dry-run --agent-repo ../pulse-agent  # Preview
#
# Prerequisites: oc (logged in), helm, npm, podman (logged in to quay.io)

set -euo pipefail
trap 'rm -f /tmp/pulse-ui-build.log /tmp/pulse-ui-push.log' EXIT

# ─── Configuration ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_REPO=""
NO_AGENT=false
NAMESPACE="openshiftpulse"
RELEASE="pulse"
UI_IMAGE="quay.io/amobrem/openshiftpulse"
AGENT_IMAGE="quay.io/amobrem/pulse-agent"
UI_TAG=""
AGENT_TAG=""
_WS_TOKEN_OVERRIDE="${PULSE_AGENT_WS_TOKEN:-}"
GCP_KEY_FILE=""
DRY_RUN=false
UNINSTALL=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-repo) AGENT_REPO="$2"; shift 2 ;;
    --no-agent)   NO_AGENT=true; shift ;;
    --namespace)  NAMESPACE="$2"; shift 2 ;;
    --ws-token)   _WS_TOKEN_OVERRIDE="$2"; shift 2 ;;
    --gcp-key)    GCP_KEY_FILE="$2"; shift 2 ;;
    --ui-tag)     UI_TAG="$2"; shift 2 ;;
    --agent-tag)  AGENT_TAG="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --uninstall)  UNINSTALL=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --help|-h)
      cat <<HELP
Usage: $0 [--agent-repo /path/to/pulse-agent] [options]

Options:
  --agent-repo PATH   Path to pulse-agent repo (deploys UI + Agent)
  --no-agent          Deploy UI only, skip agent
  --namespace NS      Target namespace (default: openshiftpulse)
  --gcp-key PATH      GCP service account JSON for Vertex AI
  --ws-token TOKEN    WebSocket auth token (auto-generated if unset)
  --ui-tag TAG        UI image tag (default: git SHA short)
  --agent-tag TAG     Agent image tag (default: git SHA short)
  --dry-run           Preview what will be deployed without deploying
  --uninstall         Remove all Pulse resources from the cluster
  --skip-build        Skip image builds, use existing images

Images (built locally, pushed to Quay.io):
  UI:    $UI_IMAGE:<tag>
  Agent: $AGENT_IMAGE:<tag>

AI Backend (pick one):
  Vertex AI:     ANTHROPIC_VERTEX_PROJECT_ID=proj CLOUD_ML_REGION=us-east5 \\
                   $0 --agent-repo ../pulse-agent --gcp-key ~/sa-key.json
  Anthropic API: ANTHROPIC_API_KEY=sk-ant-... $0 --agent-repo ../pulse-agent
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

# ─── Phase 0: Preflight Checks ──────────────────────────────────────────────

step "Preflight checks"

for cmd in oc helm npm podman; do
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

info "Tools: oc, helm, npm, podman — OK"
CLUSTER_API=$(oc whoami --show-server)
info "Cluster: $CLUSTER_API"

# Agent repo validation
if [[ -z "$AGENT_REPO" ]]; then
  NO_AGENT=true
  warn "No --agent-repo provided — deploying UI only"
fi

if [[ "$NO_AGENT" == "false" ]]; then
  if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
    error "No AI backend configured. Set ANTHROPIC_API_KEY or ANTHROPIC_VERTEX_PROJECT_ID."
    exit 1
  fi
  if [[ ! -d "$AGENT_REPO" ]]; then
    error "Agent repo not found: $AGENT_REPO"
    exit 1
  fi
  [[ -d "$AGENT_REPO/chart" ]] || { error "Agent repo missing chart/: $AGENT_REPO"; exit 1; }
  AGENT_REPO="$(cd "$AGENT_REPO" && pwd)"
  info "Agent repo: $AGENT_REPO"
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
if [[ -z "$AGENT_TAG" && "$NO_AGENT" == "false" ]]; then
  if [[ "$SKIP_BUILD" == "true" ]]; then
    AGENT_TAG="latest"
  else
    AGENT_TAG=$(git_tag "$AGENT_REPO")
  fi
fi

info "UI tag: $UI_TAG"
[[ "$NO_AGENT" == "false" ]] && info "Agent tag: $AGENT_TAG"
info "All preflight checks passed"

# ─── Phase 1: Detect Cluster Configuration ──────────────────────────────────

step "Detecting cluster configuration"

# Ensure namespace exists
oc get namespace "$NAMESPACE" &>/dev/null || oc create namespace "$NAMESPACE"

# OAuth proxy image
OAUTH_TAG=$(oc get imagestream oauth-proxy -n openshift -o jsonpath='{.status.tags[0].tag}' 2>/dev/null || echo "")
if [[ -z "$OAUTH_TAG" ]]; then
  warn "oauth-proxy ImageStream not found — using registry.redhat.io fallback"
  OAUTH_IMAGE="registry.redhat.io/openshift4/ose-oauth-proxy:v4.17"
else
  OAUTH_IMAGE="image-registry.openshift-image-registry.svc:5000/openshift/oauth-proxy:${OAUTH_TAG}"
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
  if [[ "$NO_AGENT" == "false" ]]; then
    echo "  Agent image:   ${AGENT_IMAGE}:${AGENT_TAG}"
    if [[ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
      echo "  AI backend:    Vertex AI (${ANTHROPIC_VERTEX_PROJECT_ID} / ${CLOUD_ML_REGION:-us-east5})"
    elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
      echo "  AI backend:    Anthropic API (direct)"
    fi
  else
    echo "  Agent:         not deployed"
  fi
  echo "  OAuth proxy:   $OAUTH_IMAGE"
  echo "  Monitoring:    $MONITORING_ENABLED"
  echo "  Apps domain:   $CLUSTER_DOMAIN"
  echo ""
  echo "  Helm release: $RELEASE (umbrella chart)"
  echo ""
  echo "  Deploy order:"
  echo "    1. Build images (npm + podman, parallel)"
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
  npm run build --silent
  info "UI built (dist/)"

  if [[ "$NO_AGENT" == "false" ]]; then
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
    podman build --platform linux/amd64 -t "${UI_IMAGE}:${UI_TAG}" .
    podman tag "${UI_IMAGE}:${UI_TAG}" "${UI_IMAGE}:latest"
    podman push "${UI_IMAGE}:${UI_TAG}"
    podman push "${UI_IMAGE}:latest"
    info "Pushed ${UI_IMAGE}:${UI_TAG} + latest"
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
if [[ "$NO_AGENT" == "false" ]]; then
  [[ -n "$GCP_KEY" ]] && ensure_secret gcp-sa-key "$NAMESPACE" --from-file=key.json="$GCP_KEY"
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] && ensure_secret anthropic-api-key "$NAMESPACE" --from-literal=api-key="${ANTHROPIC_API_KEY}"
fi

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
# Without this, fresh installs get a token mismatch: nginx uses the literal fallback
# while the agent reads a different auto-generated token from ws-token.yaml.
if [[ "$NO_AGENT" == "false" ]]; then
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
fi

# Label namespace for Helm ownership
oc label namespace "$NAMESPACE" app.kubernetes.io/managed-by=Helm --overwrite 2>/dev/null || true
oc annotate namespace "$NAMESPACE" meta.helm.sh/release-name="$RELEASE" meta.helm.sh/release-namespace="$NAMESPACE" --overwrite 2>/dev/null || true

# Build Helm dependencies
helm dependency build deploy/helm/pulse/ 2>/dev/null

# Build args
HELM_ARGS=""
# UI subchart
HELM_ARGS="$HELM_ARGS --set openshiftpulse.image.repository=$UI_IMAGE"
HELM_ARGS="$HELM_ARGS --set openshiftpulse.image.tag=$UI_TAG"
HELM_ARGS="$HELM_ARGS --set openshiftpulse.oauthProxy.image=$OAUTH_IMAGE"
HELM_ARGS="$HELM_ARGS --set openshiftpulse.route.clusterDomain=$CLUSTER_DOMAIN"
HELM_ARGS="$HELM_ARGS --set openshiftpulse.monitoring.prometheus.enabled=$MONITORING_ENABLED"
HELM_ARGS="$HELM_ARGS --set openshiftpulse.monitoring.alertmanager.enabled=$MONITORING_ENABLED"

if [[ "$NO_AGENT" == "false" ]]; then
  # Wire UI → agent
  HELM_ARGS="$HELM_ARGS --set openshiftpulse.agent.enabled=true"
  HELM_ARGS="$HELM_ARGS --set openshiftpulse.agent.serviceName=$AGENT_DEPLOY"
  HELM_ARGS="$HELM_ARGS --set openshiftpulse.agent.wsToken=$WS_TOKEN"
  HELM_ARGS="$HELM_ARGS --set openshiftpulse.agent.wsTokenSecret=$WS_SECRET"
  # Agent subchart
  HELM_ARGS="$HELM_ARGS --set agent.enabled=true"
  HELM_ARGS="$HELM_ARGS --set agent.image.repository=$AGENT_IMAGE"
  HELM_ARGS="$HELM_ARGS --set agent.image.tag=$AGENT_TAG"
  HELM_ARGS="$HELM_ARGS --set agent.rbac.allowWriteOperations=true"
  HELM_ARGS="$HELM_ARGS --set agent.rbac.allowSecretAccess=true"
  HELM_ARGS="$HELM_ARGS --set agent.wsAuth.existingSecret=$WS_SECRET"

  if [[ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
    HELM_ARGS="$HELM_ARGS --set agent.vertexAI.projectId=${ANTHROPIC_VERTEX_PROJECT_ID}"
    HELM_ARGS="$HELM_ARGS --set agent.vertexAI.region=${CLOUD_ML_REGION:-us-east5}"
    HELM_ARGS="$HELM_ARGS --set agent.vertexAI.existingSecret=gcp-sa-key"
    AI_BACKEND="vertex"
  elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    HELM_ARGS="$HELM_ARGS --set agent.anthropicApiKey.existingSecret=anthropic-api-key"
    AI_BACKEND="anthropic"
  fi
else
  HELM_ARGS="$HELM_ARGS --set openshiftpulse.agent.enabled=false"
  HELM_ARGS="$HELM_ARGS --set agent.enabled=false"
fi

helm upgrade --install "$RELEASE" deploy/helm/pulse/ \
  -n "$NAMESPACE" --create-namespace \
  $HELM_ARGS \
  --timeout 180s
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

HEALTHY="n/a"
AI_BACKEND="${AI_BACKEND:-none}"
VERSION=""

if [[ "$NO_AGENT" == "false" ]]; then
  step "Health verification"

  # Wait for rollout, then health check via the agent pod (not PostgreSQL)
  wait_for_rollout "$AGENT_DEPLOY" "$NAMESPACE" 120

  HEALTHY=false
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
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════"
if [[ "$HEALTHY" == "true" ]]; then
  info "Deploy complete! (UI + Agent)"
elif [[ "$NO_AGENT" == "true" ]]; then
  info "Deploy complete! (UI only)"
else
  warn "Agent health check did not pass — it may still be starting"
fi
echo ""
echo "  URL:       https://$ROUTE"
echo "  Cluster:   $CLUSTER_API"
echo "  NS:        $NAMESPACE"
echo "  UI image:  ${UI_IMAGE}:${UI_TAG}"
if [[ "$NO_AGENT" == "false" ]]; then
  echo "  Agent img: ${AGENT_IMAGE}:${AGENT_TAG}"
  echo "  AI:        $AI_BACKEND"
  echo "  Agent:     ${VERSION:-unknown}"
fi
echo ""
echo "  Uninstall:         $0 --uninstall"
echo "  Integration tests: ./deploy/integration-test.sh --namespace $NAMESPACE"
echo "════════════════════════════════════════════"
