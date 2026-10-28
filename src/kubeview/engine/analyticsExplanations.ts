/** Contextual explanations for analytics metrics — what it means, thresholds, and suggested actions. */

export interface MetricExplanation {
  what: string;
  good: string;
  bad: string;
  action: string;
  actionLink?: string;
}

export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  total_calls: {
    what: 'Total tool invocations across all agent conversations.',
    good: 'More calls = more usage. No threshold.',
    bad: 'Very low numbers may indicate the agent is underutilized.',
    action: 'Check if users know how to interact with the agent.',
  },
  unique_tools: {
    what: 'How many distinct tools the agent has used.',
    good: 'Higher coverage means the agent is utilizing its full toolkit.',
    bad: 'Low count may mean the agent is stuck on a few tools.',
    action: 'Review unused tools in the list below.',
  },
  error_rate: {
    what: 'Percentage of tool calls that returned errors.',
    good: 'Under 5% is healthy.',
    bad: 'Over 10% — tools are failing frequently.',
    action: 'Check error details in the Usage tab.',
    actionLink: '/agent?tab=usage',
  },
  avg_duration: {
    what: 'Average time per tool call.',
    good: 'Under 500ms is fast. Under 2s is acceptable.',
    bad: 'Over 5s — tools are slow, degrading user experience.',
    action: 'Check which tools are slowest in the top tools list.',
  },
  quality_gate: {
    what: 'Eval suite pass rate — tests the agent against known scenarios.',
    good: '100% means all scenarios passed.',
    bad: 'Any failure means the agent may mishandle certain queries.',
    action: 'Click to view eval details and failing scenarios.',
  },
  scanner_coverage: {
    what: 'How many of the available scanners are actively monitoring.',
    good: '100% means full coverage.',
    bad: 'Below 80% — some issue types may go undetected.',
    action: 'Click to see which scanners are disabled.',
  },
  fix_outcomes: {
    what: 'Results of auto-fix actions taken by the agent.',
    good: 'High success rate with zero rollbacks.',
    bad: 'Failures or rollbacks mean the agent is making mistakes.',
    action: 'Review fix history in Incidents.',
    actionLink: '/inbox?preset=needs_attention',
  },
  quality_score: {
    what: 'Overall response quality score from user feedback and heuristics.',
    good: 'Above 80% is strong.',
    bad: 'Below 70% — responses may be inaccurate or unhelpful.',
    action: 'Check anti-patterns below for specific issues.',
  },
  override_rate: {
    what: 'How often users override the agent\'s skill selection.',
    good: 'Under 10% — routing is accurate.',
    bad: 'Over 20% — users frequently disagree with routing.',
    action: 'Review ORCA channel weights in the selector analytics.',
  },
  cache_hit_rate: {
    what: 'How often the system prompt is served from cache.',
    good: 'Above 80% — saving tokens and cost.',
    bad: 'Below 50% — prompt changes are invalidating cache.',
    action: 'Check prompt audit for frequently changing sections.',
  },
};
