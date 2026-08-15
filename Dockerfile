FROM registry.access.redhat.com/ubi9/nginx-122:latest

# Copy built static files (UBI nginx serves from /opt/app-root/src)
COPY dist/ /opt/app-root/src/

# Entrypoint just starts nginx — config is mounted via ConfigMap in production
COPY entrypoint.sh /opt/app-root/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/opt/app-root/entrypoint.sh"]
