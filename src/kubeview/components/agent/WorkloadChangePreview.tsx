/**
 * What a chat workload write will change, in the confirmation card.
 *
 * Built from the agent's `confirm_request.preview` of kind `workload_change`
 * (API_CONTRACT): `patch_workload_container`, `scale_workload`,
 * `restart_workload` and `rollback_workload`. The agent computes it as you,
 * from the code the tool runs, including a server-side dry run, so the diff is
 * what the API server would store, in the same before/after form as the pod
 * page's guided fixes. An older agent sends no preview; the card then shows
 * the tool's parameters and "No dry run available".
 */
import type { DiffLine, DryRunState, WriteDiff } from '../primitives/WriteConfirmDialog';

export const WORKLOAD_CHANGE_TOOLS = new Set(['patch_workload_container', 'scale_workload', 'restart_workload', 'rollback_workload']);

interface WorkloadChange {
  valid: boolean;
  error?: string;
  summary?: string;
  diffHeader?: string;
  diff: DiffLine[];
  dryRun?: { state?: string; message?: string };
  impact?: string;
  undo?: string;
  gitops?: { tool?: string; app?: string; detail?: string } | null;
  warnings: string[];
  protectedNamespace?: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** The preview as a workload change, or null when the agent sent none of that kind. */
export function workloadChange(preview?: Record<string, unknown>): WorkloadChange | null {
  if (!preview || preview.kind !== 'workload_change') return null;
  const diff = Array.isArray(preview.diff)
    ? (preview.diff as Array<Record<string, unknown>>).map((d) => ({ field: str(d.field), before: str(d.before), after: str(d.after) }))
    : [];
  const gitops = preview.gitops && typeof preview.gitops === 'object' ? (preview.gitops as WorkloadChange['gitops']) : null;
  return {
    valid: preview.valid === true,
    error: preview.error === undefined ? undefined : str(preview.error),
    summary: str(preview.summary) || undefined,
    diffHeader: str(preview.diffHeader) || undefined,
    diff,
    dryRun: preview.dryRun && typeof preview.dryRun === 'object' ? (preview.dryRun as WorkloadChange['dryRun']) : undefined,
    impact: str(preview.impact) || undefined,
    undo: str(preview.undo) || undefined,
    gitops,
    warnings: Array.isArray(preview.warnings) ? (preview.warnings as unknown[]).map(str).filter(Boolean) : [],
    protectedNamespace: preview.protectedNamespace === true,
  };
}

/** Why the agent will refuse this write, or null when it will run. */
export function workloadPreviewInvalid(preview?: Record<string, unknown>): string | null {
  const w = workloadChange(preview);
  if (!w || w.valid) return null;
  return w.error || str(w.dryRun?.message) || 'Pulse will refuse this change.';
}

export function workloadDryRun(preview?: Record<string, unknown>): DryRunState {
  const w = workloadChange(preview);
  if (!w || !w.dryRun) return { state: 'unavailable' };
  if (w.dryRun.state === 'passed') return { state: 'passed', message: w.dryRun.message || 'Passed · admitted by the API server' };
  if (w.dryRun.state === 'failed') return { state: 'failed', message: w.dryRun.message || 'The API server refused the dry run' };
  return w.error ? { state: 'failed', message: w.error } : { state: 'unavailable' };
}

export function workloadDiff(preview?: Record<string, unknown>): WriteDiff | undefined {
  const w = workloadChange(preview);
  if (!w || !w.valid || !w.diffHeader) return undefined;
  return { header: w.diffHeader, lines: w.diff };
}

/** Kubernetes resource (plural) the write patches, for the card's access review. */
export function workloadPlural(kind: unknown): string | null {
  const k = str(kind).toLowerCase();
  if (k === 'deployment' || k === 'deploy') return 'deployments';
  if (k === 'statefulset' || k === 'sts') return 'statefulsets';
  if (k === 'daemonset' || k === 'ds') return 'daemonsets';
  return null;
}

/** GitOps owner, warnings and the refusal reason, under the diff. */
export function WorkloadChangeNotes({ preview }: { preview?: Record<string, unknown> }) {
  const w = workloadChange(preview);
  if (!w) return null;
  const invalid = workloadPreviewInvalid(preview);
  const owner = w.gitops;
  if (!invalid && !owner && w.warnings.length === 0 && !w.protectedNamespace) return null;
  return (
    <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 space-y-1.5 text-xs" data-testid="workload-change-notes">
      {invalid && <p role="alert" className="text-red-300">Pulse will refuse this: {invalid}</p>}
      {owner && (
        <p className="text-amber-300" data-testid="workload-gitops">
          {owner.tool === 'Helm'
            ? <>Managed by Helm release {owner.app ? <strong className="font-medium">{owner.app}</strong> : null} ({owner.detail}): the next helm upgrade overwrites this change. Make it in the chart's values as well.</>
            : <>Managed by Argo CD application {owner.app ? <strong className="font-medium">{owner.app}</strong> : null} ({owner.detail}): the next sync can revert this change. Prefer a pull request to its source; ask Pulse to propose the change to Git.</>}
        </p>
      )}
      {w.protectedNamespace && <p className="text-amber-300">This is a protected namespace (PULSE_AGENT_PROTECTED_NAMESPACES).</p>}
      {w.warnings.length > 0 && (
        <ul className="space-y-0.5 text-slate-300">
          {w.warnings.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}
