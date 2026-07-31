FROM registry.access.redhat.com/ubi9/nodejs-20:latest

WORKDIR /app
COPY . .

USER 1001

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1
