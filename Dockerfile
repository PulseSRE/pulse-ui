FROM registry.access.redhat.com/ubi9/nginx-122:latest

# Copy built static files (UBI nginx serves from /opt/app-root/src)
COPY dist/ /opt/app-root/src/

# Entrypoint just starts nginx — config is mounted via ConfigMap in production
USER root
COPY entrypoint.sh /opt/app-root/entrypoint.sh
RUN chmod +x /opt/app-root/entrypoint.sh
USER 1001

EXPOSE 8080

ENTRYPOINT ["/opt/app-root/entrypoint.sh"]
