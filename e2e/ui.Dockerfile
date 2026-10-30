# Dev server for integration tests
FROM node:22-alpine
WORKDIR /app
# The repo uses pnpm (package.json "packageManager"); there is no package-lock.json.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 9000
# Bind all interfaces so the published port reaches the dev server, and do not
# try to open a browser inside the container.
CMD ["pnpm", "exec", "rspack", "serve", "--mode", "development", "--host", "0.0.0.0", "--no-open"]
