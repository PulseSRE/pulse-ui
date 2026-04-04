/**
 * Tool Usage Store — fetches tool catalog, agent metadata, and usage analytics
 * from the Pulse Agent backend API.
 */

import { create } from 'zustand';

const AGENT_BASE = '/api/agent';

export interface ToolInfo {
  name: string;
  description: string;
  requires_confirmation: boolean;
  category: string | null;
}

export interface AgentInfo {
  name: string;
  description: string;
  tools_count: number;
  has_write_tools: boolean;
  categories: string[];
}

export interface ToolUsageEntry {
  id: number;
  timestamp: string;
  session_id: string;
  turn_number: number;
  agent_mode: string;
  tool_name: string;
  tool_category: string | null;
  input_summary: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  error_category: string | null;
  duration_ms: number;
  result_bytes: number;
  requires_confirmation: boolean;
  was_confirmed: boolean | null;
  query_summary: string | null;
}

export interface ToolStat {
  tool_name: string;
  count: number;
  error_count: number;
  avg_duration_ms: number;
  avg_result_bytes: number;
}

export interface UsageStats {
  total_calls: number;
  unique_tools_used: number;
  error_rate: number;
  avg_duration_ms: number;
  avg_result_bytes: number;
  by_tool: ToolStat[];
  by_mode: Array<{ mode: string; count: number }>;
  by_category: Array<{ category: string; count: number }>;
  by_status: Record<string, number>;
}

export interface UsageFilters {
  tool_name?: string;
  agent_mode?: string;
  status?: string;
  session_id?: string;
  from?: string;
  to?: string;
  page: number;
  per_page: number;
}

interface ToolUsageState {
  tools: { sre: ToolInfo[]; security: ToolInfo[]; write_tools: string[] } | null;
  agents: AgentInfo[];
  usage: { entries: ToolUsageEntry[]; total: number; page: number; per_page: number } | null;
  stats: UsageStats | null;
  toolsLoading: boolean;
  agentsLoading: boolean;
  usageLoading: boolean;
  statsLoading: boolean;
  filters: UsageFilters;
  loadTools: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadUsage: (filters?: Partial<UsageFilters>) => Promise<void>;
  loadStats: (from?: string, to?: string) => Promise<void>;
  setFilters: (filters: Partial<UsageFilters>) => void;
}

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${AGENT_BASE}${path}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export const useToolUsageStore = create<ToolUsageState>()((set, get) => ({
  tools: null,
  agents: [],
  usage: null,
  stats: null,
  toolsLoading: false,
  agentsLoading: false,
  usageLoading: false,
  statsLoading: false,
  filters: { page: 1, per_page: 50 },

  loadTools: async () => {
    set({ toolsLoading: true });
    const data = await apiFetch<{ sre: ToolInfo[]; security: ToolInfo[]; write_tools: string[] }>('/tools');
    set({ tools: data, toolsLoading: false });
  },

  loadAgents: async () => {
    set({ agentsLoading: true });
    const data = await apiFetch<AgentInfo[]>('/agents');
    set({ agents: data || [], agentsLoading: false });
  },

  loadUsage: async (overrides) => {
    const filters = { ...get().filters, ...overrides };
    set({ usageLoading: true, filters });
    const params = new URLSearchParams();
    if (filters.tool_name) params.set('tool_name', filters.tool_name);
    if (filters.agent_mode) params.set('agent_mode', filters.agent_mode);
    if (filters.status) params.set('status', filters.status);
    if (filters.session_id) params.set('session_id', filters.session_id);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    params.set('page', String(filters.page));
    params.set('per_page', String(filters.per_page));
    const data = await apiFetch<{ entries: ToolUsageEntry[]; total: number; page: number; per_page: number }>(
      `/tools/usage?${params}`,
    );
    set({ usage: data, usageLoading: false });
  },

  loadStats: async (from, to) => {
    set({ statsLoading: true });
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    const data = await apiFetch<UsageStats>(`/tools/usage/stats${qs ? `?${qs}` : ''}`);
    set({ stats: data, statsLoading: false });
  },

  setFilters: (partial) => {
    const filters = { ...get().filters, ...partial };
    set({ filters });
  },
}));
