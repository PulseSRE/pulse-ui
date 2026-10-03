# Screenshot Updater

Takes headless Chrome screenshots of key pages and updates `docs/screenshots/`.

Use a previously authorized running app/test cluster. Do not start a deployment just to refresh screenshots. Prefer the checked-in `scripts/capture-screenshots.ts`; inspect its current flags/dependencies before running. Never include live credentials or sensitive cluster content in published images.

## Prerequisites
- App running at http://localhost:9000 (pnpm dev + oc proxy)
- Chrome installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

## Instructions

1. **Check app is running**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/
   ```
   If not 200, instruct user to start the dev server.

2. **Capture screenshots** using headless Chrome:
   ```bash
   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
   DIR="docs/screenshots"
   PROFILE="/tmp/chrome-screenshots"
   rm -rf "$PROFILE"
   ARGS="--headless=new --disable-gpu --no-sandbox --window-size=1440,900 --virtual-time-budget=15000 --user-data-dir=$PROFILE --disable-extensions"
   ```

   Pages to capture:
   - welcome.png → /welcome
   - pulse.png → /pulse
   - workloads.png → /workloads
   - compute.png → /compute
   - storage.png → /storage
   - networking.png → /networking
   - alerts.png → /alerts
   - security.png → /security
   - access-control.png → /access-control
   - admin.png → /admin
   - builds.png → /builds
   - crds.png → /crds

3. **Visually verify screenshots** show the intended route and loaded state. File size alone cannot establish correct rendering.

4. **Report** which screenshots were updated and which may need manual capture (data-heavy pages may show loading skeletons in headless mode).

Note: Pages requiring live API data (Pulse, Workloads, Compute) may only show loading states in headless mode. The Welcome page and static UI elements will capture correctly.
