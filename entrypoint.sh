#!/bin/sh
# Read the service account token and inject it into nginx config
SA_TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null || echo "")

# Replace $sa_token placeholder in nginx config
sed -i "s|\$sa_token|${SA_TOKEN}|g" /etc/nginx/nginx.conf

# Start nginx
exec nginx -g 'daemon off;'
