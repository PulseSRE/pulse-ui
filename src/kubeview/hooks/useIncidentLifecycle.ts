import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMonitorStore } from '../store/monitorStore';
import { agentFetch } from '../engine/safeQuery';
import type {
  Finding, ActionReport, InvestigationReport, VerificationReport,
} from '../engine/monitorClient';

export interface ImpactAnalysis {
  finding_id: string;
  affected_resource: { kind: string; name: string; namespace: string } | null;
  blast_radius: Array<{ id: string; kind: string; name: string; namespace: string }>;
  upstream_dependencies: Array<{ id: string; kind: string; name: string; namespace: string }>;
  affected_pods: number;
  scope: string;
  risk_level: string;
}

export interface LearningArtifacts {
  finding_id: string;
  scaffolded_skill: { name: string; path: string } | null;
  scaffolded_plan: { name: string; incident_type: string; phases: number } | null;
  scaffolded_eval: { scenario_id: string; tool_calls: number } | null;
  learned_runbook: { name: string; success_count: number; tool_sequence: string[] } | null;
  detected_patterns: Array<{ type: string; description: string; frequency: number }>;
  confidence_delta: { before: number; after: number; delta: number } | null;
  weight_impact: { channel: string; old_weight: number; new_weight: number } | null;
}

export interface Postmortem {
  id: string;
  incident_type: string;
  plan_id: string;
  timeline: string;
  root_cause: string;
  contributing_factors: string[];
  blast_radius: string[];
  actions_taken: string[];
  prevention: string[];
  metrics_impact: string;
  confidence: number;
  generated_at: number;
}

export interface IncidentLifecycle {
  detection: Finding | null;
  impact: ImpactAnalysis | null;
  investigation: InvestigationReport | null;
  action: ActionReport | null;
  verification: VerificationReport | null;
  postmortem: Postmortem | null;
  learning: LearningArtifacts | null;
  isLoading: boolean;
  errors: string[];
  refresh: () => void;
}

async function fetchImpact(findingId: string, resource?: { kind: string; name: string; namespace?: string }): Promise<ImpactAnalysis | null> {
  const params = new URLSearchParams();
  if (resource) {
    params.set('kind', resource.kind);
    params.set('name', resource.name);
    if (resource.namespace) params.set('namespace', resource.namespace);
  }
  const qs = params.toString();
  const res = await agentFetch(`/api/agent/incidents/${encodeURIComponent(findingId)}/impact${qs ? `?${qs}` : ''}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Incident data unavailable (${res.status})`);
  return res.json();
}

async function fetchLearning(findingId: string, category?: string): Promise<LearningArtifacts | null> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await agentFetch(`/api/agent/incidents/${encodeURIComponent(findingId)}/learning${qs}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Incident data unavailable (${res.status})`);
  return res.json();
}

async function fetchPostmortems(): Promise<Postmortem[]> {
  const res = await agentFetch('/api/agent/postmortems');
  if (!res.ok) throw new Error(`Postmortems unavailable (${res.status})`);
  const data = await res.json();
  return data.postmortems ?? [];
}

export function useIncidentLifecycle(findingId: string): IncidentLifecycle {
  const detection = useMonitorStore(
    useCallback((s) => (s.findings || []).find((f) => f.id === findingId) ?? null, [findingId]),
  );
  const investigation = useMonitorStore(
    useCallback((s) => {
      const arr = s.investigations || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].findingId === findingId) return arr[i];
      }
      return null;
    }, [findingId]),
  );
  const action = useMonitorStore(
    useCallback((s) => {
      const pending = (s.pendingActions || []).find((a) => a.findingId === findingId);
      if (pending) return pending;
      const recent = s.recentActions || [];
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].findingId === findingId) return recent[i];
      }
      return null;
    }, [findingId]),
  );
  const verification = useMonitorStore(
    useCallback((s) => {
      // A finding can have multiple remediation attempts. Never attach an old
      // attempt's healthy verdict to a new proposal/execution. Recurrence may
      // arrive with a new findingId, so actionId is the authoritative join.
      return (s.verifications || [])
        .filter((v) => action ? v.actionId === action.id : v.findingId === findingId)
        .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
    }, [action, findingId]),
  );

  const firstResource = detection?.resources?.[0];
  const { data: impact, isLoading: impactLoading, error: impactError, refetch: refreshImpact } = useQuery({
    queryKey: ['incident-impact', findingId, firstResource?.kind, firstResource?.name, firstResource?.namespace],
    queryFn: () => fetchImpact(findingId, firstResource ? { kind: firstResource.kind, name: firstResource.name, namespace: firstResource.namespace } : undefined),
    enabled: !!findingId,
    staleTime: 60_000,
  });

  const { data: learning, isLoading: learningLoading, error: learningError, refetch: refreshLearning } = useQuery({
    queryKey: ['incident-learning', findingId, detection?.category],
    queryFn: () => fetchLearning(findingId, detection?.category),
    enabled: !!findingId,
    staleTime: 60_000,
  });

  const { data: allPostmortems = [], error: postmortemError, refetch: refreshPostmortems } = useQuery({
    queryKey: ['postmortems'],
    queryFn: fetchPostmortems,
    staleTime: 60_000,
  });

  const postmortem = useMemo(() => {
    // plan_id identifies a shared template, not an incident execution. The
    // monitor producer persists pm-{finding.id}; category/template matches can
    // show a different outage's cause and must never complete this stage.
    return allPostmortems.find((pm) => pm.id === `pm-${findingId}`) ?? null;
  }, [allPostmortems, findingId]);

  return {
    detection,
    impact: impact ?? null,
    investigation,
    action,
    verification,
    postmortem,
    learning: learning ?? null,
    isLoading: impactLoading || learningLoading,
    errors: [impactError, learningError, postmortemError].filter(Boolean).map(e => e instanceof Error ? e.message : 'Incident data unavailable'),
    refresh: () => { void refreshImpact(); void refreshLearning(); void refreshPostmortems(); },
  };
}
