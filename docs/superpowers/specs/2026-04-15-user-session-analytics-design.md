# User Session Analytics

> Historical design record. This proposal reflects its dated design discussion, not a statement that every feature, path, count, or acceptance criterion is implemented today. For current behavior and setup, use [README](../../../README.md), route/source modules, and current test output.

## Goal

Track user behavior across the Pulse UI — which pages drive agent interactions, how long users spend on each view, and which follow-up suggestions get clicked. Data stored in PostgreSQL alongside existing analytics, queryable via a new REST endpoint.

## Architecture

### Backend

**New table:** `user_events` (migration 018)

```sql
CREATE TABLE IF NOT EXISTS user_events (
    id          SERIAL PRIMARY KEY,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL DEFAULT '',
    event_type  TEXT NOT NULL,
    page        TEXT NOT NULL DEFAULT '',
    data        JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_user_events_ts ON user_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_page ON user_events(page, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
```

**Event types:**
- `page_view` — user navigated to a page. Data: `{from: "/pulse", to: "/incidents"}`
- `page_leave` — user left a page. Data: `{page: "/incidents", duration_ms: 45000}`
- `agent_query` — user sent a message to the agent. Data: `{page: "/compute", query_preview: "why is node..."}`
- `suggestion_click` — user clicked a follow-up suggestion. Data: `{text: "Build me a dashboard for this", page: "/incidents"}`
- `feature_use` — user used a specific feature. Data: `{feature: "chart_edit", page: "/custom/cv-abc"}`

**New endpoint:** `POST /analytics/events` — accepts a batch of events

```json
{
  "events": [
    {"event_type": "page_view", "page": "/incidents", "data": {"from": "/pulse"}},
    {"event_type": "suggestion_click", "page": "/incidents", "data": {"text": "Diagnose this?"}}
  ]
}
```

Fire-and-forget — returns 202 immediately, writes async. No auth required beyond the existing OAuth proxy (user identity from X-Forwarded-User header).

**New endpoint:** `GET /analytics/sessions` — aggregated session analytics

Returns: top pages by visit count, avg time-on-page, agent queries by page, top follow-up suggestions clicked, feature usage counts.

### Frontend

**New module:** `src/kubeview/engine/sessionTracker.ts`

- Listens to route changes via `useLocation()` in a `<SessionTracker>` component mounted in Shell
- Tracks `page_view` on navigation, `page_leave` with duration on unmount
- Batches events and flushes every 30 seconds or on `beforeunload`
- Generates a session ID (UUID) stored in sessionStorage
- User ID from the OAuth identity (X-Forwarded-User header, already available)

**Integration points:**
- `Shell.tsx` — mount `<SessionTracker>`
- `DockAgentPanel.tsx` — emit `agent_query` event with current page when user sends a message
- Follow-up `PromptPill` components — emit `suggestion_click` with the suggestion text
- `ChartEditPopover` — emit `feature_use` event

### Data Flow

```
User navigates → SessionTracker detects route change → queues page_view event
User sends agent message → DockAgentPanel emits agent_query with current route
User clicks suggestion → PromptPill emits suggestion_click with text
Every 30s → flush batch to POST /analytics/events
Page unload → flush remaining events with page_leave duration
```

## What NOT to Build

- No click heatmaps or scroll depth
- No real-time dashboard (query via GET endpoint)
- No PII in events — user_id is the OAuth username, no email/IP
- No client-side storage — all events go to PostgreSQL
- No sampling — volume is low enough to track everything

## Testing

- Unit test: SessionTracker emits page_view on route change
- Unit test: batch flush sends correct payload
- Unit test: suggestion_click captures text
- API test: POST /analytics/events returns 202
- API test: GET /analytics/sessions returns aggregated data
