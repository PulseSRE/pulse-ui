#!/usr/bin/env bash
# Deploy OpenShift Pulse + Pulse Agent to an OpenShift cluster.
# Usage: ./deploy/deploy.sh [--agent-repo /path/to/pulse-agent]
#
# Prerequisites: oc login, helm, npm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_REPO="${AGENT_REPO:-/tmp/pulse-agent}"
NAMESPACE="openshiftpulse"
WS_TOKEN="${PULSE_AGENT_WS_TOKEN:-pulse-agent-internal-token}"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-repo) AGENT_REPO="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "=== OpenShift Pulse Deployer ==="
echo "Namespace:  $NAMESPACE"
echo "Agent repo: $AGENT_REPO"
echo "Cluster:    $(oc whoami --show-server)"
echo ""

# 1. Detect cluster oauth-proxy image
echo "[1/8] Detecting oauth-proxy image..."
OAUTH_TAG=$(oc get imagestream oauth-proxy -n openshift -o jsonpath='{.status.tags[0].tag}' 2>/dev/null || echo "v4.4")
OAUTH_IMAGE="image-registry.openshift-image-registry.svc:5000/openshift/oauth-proxy:${OAUTH_TAG}"
echo "  Using: $OAUTH_IMAGE"

# 1b. Auto-detect cluster apps domain for OAuth
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null || echo "")
if [[ -z "$CLUSTER_DOMAIN" ]]; then
  echo "  WARNING: Could not detect cluster apps domain. OAuth redirect may need manual fix."
else
  echo "  Apps domain: $CLUSTER_DOMAIN"
fi

# 2. Build Pulse UI
echo "[2/8] Building Pulse UI..."
cd "$PROJECT_DIR"
npm run build --silent

# 3. Helm install/upgrade Pulse UI
echo "[3/8] Helm install/upgrade Pulse..."
HELM_DOMAIN_FLAG=""
[[ -n "$CLUSTER_DOMAIN" ]] && HELM_DOMAIN_FLAG="--set route.clusterDomain=$CLUSTER_DOMAIN"

if helm status openshiftpulse -n "$NAMESPACE" &>/dev/null; then
  helm upgrade openshiftpulse deploy/helm/openshiftpulse/ -n "$NAMESPACE" \
    --set oauthProxy.image="$OAUTH_IMAGE" \
    --set agent.serviceName=pulse-agent-openshift-sre-agent \
    --set agent.wsToken="$WS_TOKEN" $HELM_DOMAIN_FLAG --quiet
else
  helm install openshiftpulse deploy/helm/openshiftpulse/ -n "$NAMESPACE" --create-namespace \
    --set oauthProxy.image="$OAUTH_IMAGE" \
    --set agent.serviceName=pulse-agent-openshift-sre-agent \
    --set agent.wsToken="$WS_TOKEN" $HELM_DOMAIN_FLAG
fi

# 3b. Fix OAuth redirect URI immediately (before any step that could fail)
echo "  Fixing OAuth redirect URI..."
ROUTE=$(oc get route openshiftpulse -n "$NAMESPACE" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
if [[ -n "$ROUTE" ]]; then
  oc patch oauthclient openshiftpulse --type merge -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}" 2>&1 | tail -1
else
  echo "  WARNING: Route not found yet. OAuth redirect will be fixed after build."
fi

# 4. S2I build for Pulse UI
echo "[4/8] Building Pulse UI image..."
oc start-build openshiftpulse --from-dir=dist --follow -n "$NAMESPACE" 2>&1 | tail -2

# 5. Helm install/upgrade Agent
echo "[5/8] Helm install/upgrade Agent..."
cd "$AGENT_REPO"
if helm status pulse-agent -n "$NAMESPACE" &>/dev/null; then
  helm upgrade pulse-agent chart/ -n "$NAMESPACE" \
    --set rbac.allowWriteOperations=true \
    --set rbac.allowSecretAccess=true \
    --set networkPolicy.disabled=true --quiet
else
  helm install pulse-agent chart/ -n "$NAMESPACE" \
    --set rbac.allowWriteOperations=true \
    --set rbac.allowSecretAccess=true \
    --set networkPolicy.disabled=true
fi

# 6. Build Agent image (two-stage: deps base + code overlay)
echo "[6/8] Building Agent image..."

# 6a. Ensure deps base image exists and is up-to-date
DEPS_HASH=$(md5 -q "$AGENT_REPO/pyproject.toml" 2>/dev/null || md5sum "$AGENT_REPO/pyproject.toml" | cut -d' ' -f1)
CURRENT_HASH=$(oc get istag pulse-agent-deps:latest -n "$NAMESPACE" \
  -o jsonpath='{.image.dockerImageMetadata.Config.Labels.deps-hash}' 2>/dev/null || echo "none")

if [[ "$DEPS_HASH" != "$CURRENT_HASH" ]]; then
  echo "  Deps image needs rebuild (pyproject.toml changed)..."
  oc create imagestream pulse-agent-deps -n "$NAMESPACE" 2>/dev/null || true
  if ! oc get bc pulse-agent-deps -n "$NAMESPACE" &>/dev/null; then
    cat <<DEPEOF | oc apply -f - -n "$NAMESPACE"
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata:
  name: pulse-agent-deps
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
DEPEOF
  fi
  oc start-build pulse-agent-deps --from-dir=. --build-arg="DEPS_HASH=$DEPS_HASH" --follow -n "$NAMESPACE" 2>&1 | tail -3
fi

# 6b. Ensure code BC uses deps as base
oc get bc pulse-agent -n "$NAMESPACE" &>/dev/null || \
  oc new-build --binary --name=pulse-agent --to=pulse-agent:latest -n "$NAMESPACE" 2>&1 | tail -1
oc patch bc pulse-agent -n "$NAMESPACE" --type=json \
  -p='[{"op":"replace","path":"/spec/strategy/dockerStrategy","value":{"from":{"kind":"ImageStreamTag","name":"pulse-agent-deps:latest"}}}]' \
  2>/dev/null || true

# 6c. Code-only build (fast — deps already cached in base image)
echo "  Building code image..."
if ! oc start-build pulse-agent --from-dir=. --follow -n "$NAMESPACE" 2>&1 | tail -3; then
  echo "  Code build failed. Checking if deps image exists..."
  if ! oc get istag pulse-agent-deps:latest -n "$NAMESPACE" &>/dev/null; then
    echo "  Deps image missing — falling back to full single-stage build..."
    oc patch bc pulse-agent -n "$NAMESPACE" --type=json \
      -p='[{"op":"replace","path":"/spec/strategy/dockerStrategy","value":{"dockerfilePath":"Dockerfile.full"}}]'
    oc start-build pulse-agent --from-dir=. --follow -n "$NAMESPACE" 2>&1 | tail -3
    oc patch bc pulse-agent -n "$NAMESPACE" --type=json \
      -p='[{"op":"replace","path":"/spec/strategy/dockerStrategy","value":{"from":{"kind":"ImageStreamTag","name":"pulse-agent-deps:latest"}}}]'
  else
    echo "  ERROR: Code build failed but deps image exists. Check build logs."
    exit 1
  fi
fi

# 7. Configure Agent
echo "[7/8] Configuring Agent..."
AGENT_DIGEST=$(oc get istag pulse-agent:latest -n "$NAMESPACE" -o jsonpath='{.image.dockerImageReference}')
oc set image deployment/pulse-agent-openshift-sre-agent sre-agent="$AGENT_DIGEST" -n "$NAMESPACE" 2>&1 | tail -1
oc set env deployment/pulse-agent-openshift-sre-agent \
  PULSE_AGENT_WS_TOKEN="$WS_TOKEN" \
  ANTHROPIC_VERTEX_PROJECT_ID="${ANTHROPIC_VERTEX_PROJECT_ID:-}" \
  CLOUD_ML_REGION="${CLOUD_ML_REGION:-}" \
  -n "$NAMESPACE" 2>&1 | tail -1

# Mount GCP creds if available
if [[ -f "$HOME/.config/gcloud/application_default_credentials.json" ]]; then
  oc get secret gcp-sa-key -n "$NAMESPACE" &>/dev/null || \
    oc create secret generic gcp-sa-key --from-file=key.json="$HOME/.config/gcloud/application_default_credentials.json" -n "$NAMESPACE"
  oc set volume deployment/pulse-agent-openshift-sre-agent --add --name=gcp-sa-key --secret-name=gcp-sa-key --mount-path=/var/secrets/google --read-only -n "$NAMESPACE" 2>/dev/null || true
  oc set env deployment/pulse-agent-openshift-sre-agent GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google/key.json -n "$NAMESPACE" 2>&1 | tail -1
fi

# Delete restrictive NetworkPolicy if it exists
oc delete networkpolicy pulse-agent-openshift-sre-agent -n "$NAMESPACE" 2>/dev/null || true

# Fix OAuth redirect URI
ROUTE=$(oc get route openshiftpulse -n "$NAMESPACE" -o jsonpath='{.spec.host}')
oc patch oauthclient openshiftpulse --type merge -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}" 2>&1 | tail -1

# 8. Restart and verify
echo "[8/8] Restarting deployments..."
oc rollout restart deployment/openshiftpulse -n "$NAMESPACE"
oc rollout restart deployment/pulse-agent-openshift-sre-agent -n "$NAMESPACE"

echo ""
echo "Waiting for pods..."
sleep 20
oc get pods -n "$NAMESPACE" --field-selector=status.phase=Running --no-headers

# Verify agent health
echo ""
AGENT_HEALTH=$(oc exec deployment/pulse-agent-openshift-sre-agent -n "$NAMESPACE" -- curl -s http://localhost:8080/healthz 2>/dev/null || echo '{"status":"unknown"}')
echo "Agent health: $AGENT_HEALTH"

echo ""
echo "=== Deploy Complete ==="
echo "URL: https://$ROUTE"
echo "Agent: $(oc exec deployment/pulse-agent-openshift-sre-agent -n "$NAMESPACE" -- curl -s http://localhost:8080/version 2>/dev/null || echo 'version check unavailable')"
