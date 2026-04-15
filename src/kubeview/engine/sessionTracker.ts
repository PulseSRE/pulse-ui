/**
 * Session analytics — tracks page views, time-on-page, and user interactions.
 * Events batched and flushed every 30s or on page unload.
 */

const SESSION_KEY = 'pulse-session-id';
const FLUSH_INTERVAL = 30_000;
const MAX_BATCH = 50;

interface SessionEvent {
  session_id: string;
  event_type: string;
  page: string;
  data: Record<string, unknown>;
}

let sessionId = sessionStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, sessionId);
}

const queue: SessionEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function enqueue(eventType: string, page: string, data: Record<string, unknown> = {}) {
  queue.push({
    session_id: sessionId!,
    event_type: eventType,
    page,
    data,
  });

  // Auto-flush if batch is full
  if (queue.length >= MAX_BATCH) {
    flush();
  }
}

async function flush() {
  if (queue.length === 0) return;

  const batch = queue.splice(0, MAX_BATCH);
  try {
    await fetch('/api/agent/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Silent fail — analytics should never block the UI
  }
}

/** Start the flush timer. Call once on app mount. */
export function startSessionTracker() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL);

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    flush();
  });
}

/** Stop the flush timer. */
export function stopSessionTracker() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flush();
}

/** Track a page view. Call on route change. */
export function trackPageView(page: string, from?: string) {
  enqueue('page_view', page, from ? { from } : {});
}

/** Track leaving a page with duration. */
export function trackPageLeave(page: string, durationMs: number) {
  enqueue('page_leave', page, { duration_ms: durationMs });
}

/** Track an agent query with the page context. */
export function trackAgentQuery(page: string, queryPreview: string) {
  enqueue('agent_query', page, { query_preview: queryPreview.slice(0, 100) });
}

/** Track a follow-up suggestion click. */
export function trackSuggestionClick(page: string, text: string) {
  enqueue('suggestion_click', page, { text: text.slice(0, 200) });
}

/** Track a feature usage event. */
export function trackFeatureUse(page: string, feature: string) {
  enqueue('feature_use', page, { feature });
}

export { sessionId };
