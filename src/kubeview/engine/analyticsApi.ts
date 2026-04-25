/** Typed fetch functions for Pulse Agent analytics endpoints. */

import { agentFetch } from './safeQuery';

const AGENT_BASE = '/api/agent';

async function get<T>(path: string): Promise<T> {
  const res = await agentFetch(path);
  if (!res.ok) throw new Error(`Analytics API error: ${res.status} on ${path}`);
  return res.json();
}

// --- Types ---

export interface FixHistorySummary {
  total_actions: number;
  completed: number;
  failed: number;
  rolled_back: number;
  success_rate: number;
  rollback_rate: number;
  avg_resolution_ms: number;
  by_category: Array<{ category: string; count: number; success_count: number; auto_fixed: number; confirmation_required: number }>;
  trend: { current_week: number; previous_week: number; delta: number };
  verification: {
    resolved: number;
    still_failing: number;
    improved: number;
    pending: number;
    resolution_rate: number;
  };
}

export interface ScannerCoverage {
  active_scanners: number;
  total_scanners: number;
  coverage_pct: number;
  categories: Array<{ name: string; covered: boolean; scanners: string[] }>;
  per_scanner: Array<{ name: string; enabled: boolean; finding_count: number; actionable_count: number; noise_pct: number }>;
}

export interface ConfidenceCalibration {
  brier_score: number;
  accuracy_pct: number;
  rating: 'good' | 'fair' | 'poor' | 'insufficient_data';
  total_predictions: number;
  buckets: Array<{ range: string; predicted: number; actual: number; count: number }>;
}

export interface AccuracyStats {
  avg_quality_score: number;
  quality_trend: { current: number; previous: number; delta: number };
  dimensions: { resolution: number; efficiency: number; safety: number; speed: number };
  anti_patterns: Array<{ error_type: string; namespace: string; count: number; description: string }>;
  learning: {
    total_runbooks: number;
    new_this_month: number;
    runbook_success_rate: number;
    total_patterns: number;
    pattern_types: Record<string, number>;
  };
  override_rate: { overrides: number; total_proposed: number; rate: number };
}

export interface CostStats {
  avg_tokens_per_incident: number;
  trend: { current: number; previous: number; delta_pct: number };
  by_mode: Array<{ mode: string; avg_tokens: number; count: number; cost_usd?: number }>;
  total_tokens: number;
  total_incidents: number;
  cost?: {
    total_usd: number;
    avg_per_incident_usd: number;
    input_usd: number;
    output_usd: number;
    cache_savings_usd: number;
  };
}

export interface IntelligenceSections {
  query_reliability?: { preferred: Array<{ query: string; success_rate: number; total: number }>; unreliable: Array<{ query: string; success_rate: number; total: number }> };
  error_hotspots?: Array<{ tool: string; error_rate: number; total: number; common_error: string }>;
  token_efficiency?: { avg_input: number; avg_output: number; cache_hit_rate: number };
  harness_effectiveness?: { accuracy: number; wasted: Array<{ tool: string; offered: number; used: number }> };
  routing_accuracy?: { mode_switch_rate: number; total_sessions: number };
  feedback_analysis?: { negative: Array<{ tool: string; count: number }> };
  token_trending?: { input_delta_pct: number; output_delta_pct: number; cache_delta_pct: number };
  dashboard_patterns?: { top_components: Array<{ kind: string; count: number }>; avg_widgets: number };
}

export interface PromptAnalytics {
  stats: {
    total_prompts: number;
    avg_tokens: number;
    cache_hit_rate: number;
    section_avg: Record<string, number>;
    by_skill: Array<{ skill_name: string; count: number; avg_tokens: number; prompt_versions: number }>;
  };
  versions: Array<{ prompt_hash: string; count: number; first_seen: string | null; last_seen: string | null }>;
}

export interface Recommendation {
  type: 'scanner' | 'capability';
  title: string;
  description: string;
  action: { kind: string; scanner?: string; prompt?: string };
}

export interface ReadinessSummary {
  total_gates: number;
  passed: number;
  failed: number;
  attention: number;
  pass_rate: number;
  attention_items: Array<{ gate: string; message: string }>;
}

// --- Fetch functions ---

export const fetchFixHistorySummary = (days = 7) =>
  get<FixHistorySummary>(`${AGENT_BASE}/fix-history/summary?days=${days}`);

export const fetchScannerCoverage = (days = 7) =>
  get<ScannerCoverage>(`${AGENT_BASE}/monitor/coverage?days=${days}`);

export const fetchConfidenceCalibration = (days = 30) =>
  get<ConfidenceCalibration>(`${AGENT_BASE}/analytics/confidence?days=${days}`);

export const fetchAccuracyStats = (days = 30) =>
  get<AccuracyStats>(`${AGENT_BASE}/analytics/accuracy?days=${days}`);

export const fetchCostStats = (days = 30) =>
  get<CostStats>(`${AGENT_BASE}/analytics/cost?days=${days}`);

export const fetchIntelligenceSections = (days = 7, mode = 'sre') =>
  get<IntelligenceSections>(`${AGENT_BASE}/analytics/intelligence?days=${days}&mode=${mode}`);

export const fetchPromptStats = (days = 30, skill?: string) =>
  get<PromptAnalytics>(`${AGENT_BASE}/analytics/prompt?days=${days}${skill ? `&skill=${skill}` : ''}`);

export const fetchRecommendations = () =>
  get<{ recommendations: Recommendation[] }>(`${AGENT_BASE}/recommendations`);

export const fetchReadinessSummary = () =>
  get<ReadinessSummary>(`${AGENT_BASE}/analytics/readiness`);

export interface AgentCapabilities {
  max_trust_level: number;
  supported_auto_fix_categories?: string[];
}

export interface AgentVersionInfo {
  agent: string;
  protocol: number;
  tools: number;
  skills: number;
}

export const fetchCapabilities = async (): Promise<AgentCapabilities> => {
  const res = await agentFetch(`${AGENT_BASE}/monitor/capabilities`);
  if (!res.ok) return { max_trust_level: 0 };
  return res.json();
};

export const fetchAgentVersion = async (): Promise<AgentVersionInfo | null> => {
  const res = await agentFetch(`${AGENT_BASE}/version`);
  if (!res.ok) return null;
  return res.json();
};

export interface ResolutionRecord {
  id: string;
  findingId: string;
  category: string;
  tool: string;
  status: string;
  reasoning: string;
  outcome: 'verified' | 'still_failing' | 'improved';
  evidence: string;
  timestamp: number;
  verifiedAt: number | null;
  durationMs: number | null;
  timeToVerifyMs: number | null;
}

export interface ResolutionsResponse {
  resolutions: ResolutionRecord[];
  total: number;
}

export const fetchResolutions = (days = 7, limit = 50) =>
  get<ResolutionsResponse>(`${AGENT_BASE}/fix-history/resolutions?days=${days}&limit=${limit}`);

// --- ORCA analytics ---

export interface TopologySummary {
  nodes: number;
  edges: number;
  kinds: Record<string, number>;
  last_refresh: number;
}

export interface PlanTemplate {
  id: string;
  name: string;
  incident_type: string;
  phases: number;
  max_duration: number;
}

export const fetchTopologySummary = () =>
  get<{ nodes: unknown[]; edges: unknown[]; summary: TopologySummary }>(`${AGENT_BASE}/topology`).then(r => r.summary);

export const fetchPlanTemplates = () =>
  get<{ templates: PlanTemplate[] }>(`${AGENT_BASE}/plan-templates`).then(r => r.templates);

export const fetchPostmortemCount = () =>
  get<{ postmortems: unknown[]; total: number }>(`${AGENT_BASE}/postmortems?limit=1`).then(r => r.total);

export interface SLOStatus {
  service: string;
  type: string;
  target: number;
  window_days: number;
  description: string;
  current_value: number;
  error_budget_remaining: number;
  burn_rate: number;
  alert_level: 'ok' | 'warning' | 'critical';
}

export const fetchSLOStatus = () =>
  get<{ slos: SLOStatus[]; total: number }>(`${AGENT_BASE}/slo`);

export interface FixStrategy {
  category: string;
  tool: string;
  total: number;
  success: number;
  verified: number;
  failed: number;
  success_rate: number;
  verification_rate: number;
}

export interface LearningEvent {
  type: string;
  description: string;
  data?: unknown;
  timestamp?: number;
}

export const fetchFixStrategies = (days = 30) =>
  get<{ strategies: FixStrategy[]; days: number }>(`${AGENT_BASE}/analytics/fix-strategies?days=${days}`);

export const fetchLearningFeed = (days = 7) =>
  get<{ events: LearningEvent[]; days: number }>(`${AGENT_BASE}/analytics/learning?days=${days}`);

// --- Session analytics ---

export interface SessionSummary {
  total_sessions: number;
  total_page_views: number;
  unique_pages: number;
  total_queries: number;
  avg_duration_seconds: number;
}

export interface SessionAnalytics {
  summary: SessionSummary;
  pages: Array<{ page: string; views: number; sessions: number }>;
  time_on_page: Array<{ page: string; avg_seconds: number; samples: number }>;
  agent_queries_by_page: Array<{ page: string; queries: number }>;
  top_suggestions: Array<{ suggestion: string; clicks: number }>;
  feature_usage: Array<{ feature: string; uses: number }>;
  days: number;
}

export const fetchSessionAnalytics = (days = 7) =>
  get<SessionAnalytics>(`${AGENT_BASE}/analytics/sessions?days=${days}`);

// --- Agent health ---

export interface AgentHealthStatus {
  status: string;
  circuit_breaker: { state: string; failure_count: number; recovery_timeout: number };
  errors: { total: number; by_category: Record<string, number>; recent: string[] };
  investigations: Record<string, unknown>;
  autofix_paused: boolean;
}

export const fetchAgentHealth = () =>
  get<AgentHealthStatus>(`${AGENT_BASE}/health`);

export interface ActivityEvent {
  type: 'auto_fix' | 'fix_failed' | 'rollback' | 'self_healed' | 'postmortem' | 'investigation';
  description: string;
  link: string;
  count: number;
  category?: string;
  namespace?: string;
}

export interface AgentActivity {
  events: ActivityEvent[];
  period_days: number;
}

export const fetchAgentActivity = (days = 7) =>
  get<AgentActivity>(`${AGENT_BASE}/activity?days=${days}`);
