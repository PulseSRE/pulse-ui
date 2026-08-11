// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
import {
  trackPageView,
  trackPageLeave,
  trackAgentQuery,
  trackSuggestionClick,
  trackFeatureUse,
  stopSessionTracker,
} from '../sessionTracker';

/** Flush by calling stopSessionTracker which flushes then clears timer */
async function flushEvents() {
  stopSessionTracker();
  await vi.waitFor(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  stopSessionTracker();
});

describe('sessionTracker', () => {
  it('trackPageView queues and flushes a page_view event', async () => {
    trackPageView('/inbox', '/pulse');
    await flushEvents();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent/analytics/events',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const event = body.events.find((e: { event_type: string }) => e.event_type === 'page_view');
    expect(event.page).toBe('/inbox');
    expect(event.data.from).toBe('/pulse');
  });

  it('trackPageLeave includes duration_ms', async () => {
    trackPageLeave('/compute', 45000);
    await flushEvents();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const event = body.events.find((e: { event_type: string }) => e.event_type === 'page_leave');
    expect(event.data.duration_ms).toBe(45000);
  });

  it('trackAgentQuery truncates query to 100 chars', async () => {
    trackAgentQuery('/workloads', 'a'.repeat(200));
    await flushEvents();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const event = body.events.find((e: { event_type: string }) => e.event_type === 'agent_query');
    expect(event.data.query_preview.length).toBe(100);
  });

  it('trackSuggestionClick captures text and page', async () => {
    trackSuggestionClick('/inbox', 'Build me a dashboard for this');
    await flushEvents();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const event = body.events.find((e: { event_type: string }) => e.event_type === 'suggestion_click');
    expect(event.data.text).toBe('Build me a dashboard for this');
    expect(event.page).toBe('/inbox');
  });

  it('trackFeatureUse records feature name', async () => {
    trackFeatureUse('/custom/cv-abc', 'chart_edit');
    await flushEvents();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const event = body.events.find((e: { event_type: string }) => e.event_type === 'feature_use');
    expect(event.data.feature).toBe('chart_edit');
  });

  it('batches multiple events in one flush', async () => {
    trackPageView('/pulse');
    trackPageView('/inbox');
    trackPageView('/compute');
    await flushEvents();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.events.length).toBe(3);
  });

  it('does not flush when queue is empty', async () => {
    await flushEvents();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('silently handles fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    trackPageView('/pulse');
    await flushEvents();
    // Should not throw
    expect(mockFetch).toHaveBeenCalled();
  });

  it('all events include session_id', async () => {
    trackPageView('/pulse');
    trackAgentQuery('/pulse', 'test');
    trackSuggestionClick('/pulse', 'suggestion');
    await flushEvents();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    for (const event of body.events) {
      expect(event.session_id).toBeTruthy();
    }
  });
});
