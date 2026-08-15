#!/bin/sh
# The nginx config is mounted from the ConfigMap in the deployment manifest.
# User auth is handled by the OAuth proxy sidecar (X-Forwarded-Access-Token).
exec nginx -g 'daemon off;'
