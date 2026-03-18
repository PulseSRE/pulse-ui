FROM nginxinc/nginx-unprivileged:alpine

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built static files
COPY dist/ /usr/share/nginx/html/

# Script to inject service account token into nginx config at runtime
COPY entrypoint.sh /entrypoint.sh

USER 0
RUN chmod +x /entrypoint.sh
USER 1001

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
