import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchFixHistorySummary,
  fetchScannerCoverage,
  fetchConfidenceCalibration,
  fetchAccuracyStats,
  fetchCostStats,
  fetchIntelligenceSections,
  fetchPromptStats,
  fetchRecommendations,
  fetchReadinessSummary,
  fetchCapabilities,
  fetchAgentVersion,
  fetchSessionAnalytics,
} from '../analyticsApi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => vi.clearAllMocks());

describe('analyticsApi', () => {
  it('fetchFixHistorySummary calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ total_actions: 5 }) });
    const result = await fetchFixHistorySummary(7);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/fix-history/summary?days=7');
    expect(result.total_actions).toBe(5);
  });

  it('fetchScannerCoverage calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ coverage_pct: 78 }) });
    const result = await fetchScannerCoverage();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/monitor/coverage?days=7');
    expect(result.coverage_pct).toBe(78);
  });

  it('fetchConfidenceCalibration calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ rating: 'good' }) });
    const result = await fetchConfidenceCalibration();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/confidence?days=30');
    expect(result.rating).toBe('good');
  });

  it('fetchAccuracyStats calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ avg_quality_score: 0.85 }) });
    const result = await fetchAccuracyStats();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/accuracy?days=30');
    expect(result.avg_quality_score).toBe(0.85);
  });

  it('fetchCostStats calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ total_tokens: 50000 }) });
    const result = await fetchCostStats();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/cost?days=30');
    expect(result.total_tokens).toBe(50000);
  });

  it('fetchIntelligenceSections calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ query_reliability: {} }) });
    const result = await fetchIntelligenceSections();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/intelligence?days=7&mode=sre');
    expect(result.query_reliability).toBeDefined();
  });

  it('fetchPromptStats calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ stats: { total_prompts: 100 } }) });
    const result = await fetchPromptStats();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/prompt?days=30');
    expect(result.stats.total_prompts).toBe(100);
  });

  it('fetchPromptStats passes skill parameter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ stats: {} }) });
    await fetchPromptStats(30, 'sre');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/prompt?days=30&skill=sre');
  });

  it('fetchRecommendations calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
    const result = await fetchRecommendations();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/recommendations');
    expect(result.recommendations).toEqual([]);
  });

  it('fetchReadinessSummary calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ pass_rate: 0.93 }) });
    const result = await fetchReadinessSummary();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/readiness');
    expect(result.pass_rate).toBe(0.93);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchFixHistorySummary()).rejects.toThrow();
  });

  it('fetchCapabilities returns data on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ max_trust_level: 3 }) });
    const result = await fetchCapabilities();
    expect(result.max_trust_level).toBe(3);
  });

  it('fetchCapabilities falls back to max_trust_level 0 on error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await fetchCapabilities();
    expect(result.max_trust_level).toBe(0);
  });

  it('fetchAgentVersion returns data on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ agent: '2.0.0', protocol: 2, tools: 111 }) });
    const result = await fetchAgentVersion();
    expect(result?.agent).toBe('2.0.0');
  });

  it('fetchAgentVersion returns null on error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await fetchAgentVersion();
    expect(result).toBeNull();
  });

  it('fetchSessionAnalytics calls correct endpoint with default days', async () => {
    const mockData = {
      summary: { total_sessions: 25, total_page_views: 180, unique_pages: 8, total_queries: 42, avg_duration_seconds: 35.2 },
      pages: [{ page: '/pulse', views: 50, sessions: 20 }],
      time_on_page: [{ page: '/pulse', avg_seconds: 45.3, samples: 18 }],
      agent_queries_by_page: [{ page: '/incidents', queries: 15 }],
      top_suggestions: [{ suggestion: 'Show me crashlooping pods', clicks: 8 }],
      feature_usage: [{ feature: 'chart_edit', uses: 12 }],
      days: 7,
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockData) });
    const result = await fetchSessionAnalytics();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/sessions?days=7');
    expect(result.summary.total_sessions).toBe(25);
    expect(result.pages).toHaveLength(1);
    expect(result.top_suggestions[0].clicks).toBe(8);
  });

  it('fetchSessionAnalytics passes custom days parameter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ summary: {}, pages: [], days: 30 }) });
    await fetchSessionAnalytics(30);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/agent/analytics/sessions?days=30');
  });
});
