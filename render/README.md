# Pulse render service

Screenshots a draft dashboard in the real UI so the agent can see what it is about to save. The agent's view designer calls it, through the `preview_dashboard` tool, before saving a larger dashboard. It looks at the image and fixes what it sees, such as empty rows, cramped widgets or cut-off tables, before the user does.

```
POST /render                     Authorization: Bearer $RENDER_TOKEN
{ "spec": { "title", "description"?, "layout": [...], "positions"? },
  "userToken": "<the requesting user's OpenShift token>",
  "width"?: 640-2560 (1440), "height"?: 400-2000 (1000) }

200 { "image": "<base64 PNG>", "width", "height", "cells": [{title, text, scrolls, clipped}],
      "pageErrors": [...], "error": "", "truncated": false }
400 bad request · 401 wrong/missing RENDER_TOKEN · 429 busy · 500 render failed
GET /healthz
```

## How it renders

The page is the UI's `/preview` route (`src/kubeview/views/PreviewView.tsx`). It renders a spec it is handed, using the same widgets and grid as a saved dashboard, with no app shell and no editing controls, and saves nothing. The service puts the spec in `window.__PULSE_PREVIEW__` before the page loads. It then waits for widgets to fetch and draw, grows the viewport to the dashboard's full height (capped at 6000px) and screenshots it.

Every request runs in a fresh browser context with the user's token on every request (`X-Forwarded-Access-Token`), so widget data comes back with that user's permissions and nobody else's. Nothing from one user's render is visible to the next.

## Security

- **Callers:** only the agent knows `RENDER_TOKEN`, and the service accepts nothing without it.
- **Credentials:** the service holds no cluster credentials. It can show a user only what that user's own token can read.
- **Which UI port:** the service must reach the UI on a listener that serves the static UI and the `/api/kubernetes/`, `/api/prometheus/` and `/api/alertmanager/` proxies, and **not** `/api/agent/`. Those proxies authenticate the forwarded token upstream. The UI's main nginx `/api/agent/` route adds the agent's own credential and trusts `X-Forwarded-User`, so a caller that could reach it directly could act as any user against the agent. pulse-operator deploys a render-only listener and network policies that let only the render service reach it, and only the agent reach the render service.
- **Errors:** render failures return only the error type, never messages that might contain internal URLs.

## Running locally

```bash
cd render && npm install
RENDER_TOKEN=dev UI_URL=http://127.0.0.1:9000 CHROMIUM_PATH=/path/to/chromium node server.mjs
```

`UI_URL` can be the dev server (`pnpm dev`). Env: `PORT` (8090), `MAX_CONCURRENT` (2), `RENDER_TIMEOUT_MS` (30000).

The image is `Dockerfile.render` (Debian-based, because Chromium's libraries are not in the UBI repositories). Tests are in `render/app.test.mjs` and run with the UI's `pnpm test`.
