/**
 * What a chat-proposed InstallPlan approval will do, in the confirmation card.
 *
 * Built from the agent's `confirm_request.preview` (`installplan_approve`),
 * computed as you before you decide: the CSVs the plan installs and the ones
 * it replaces, how many resources it applies (CRDs called out), the
 * resourceVersion the approval is held to, the API server's dry run, and any
 * Argo CD application tracking it. An older agent sends no preview; the card
 * then says what it cannot show.
 */
import type { DryRunState } from '../primitives/WriteConfirmDialog';

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

/** The agent's reason the approval will be refused, or null. */
export function installPlanPreviewInvalid(preview?: Record<string, unknown>): string | null {
  if (!preview || preview.valid !== false) return null;
  return str(preview.error) || 'Pulse will refuse this approval.';
}

/** The preview's server dry run, as the card's Dry run row. */
export function installPlanDryRun(preview?: Record<string, unknown>): DryRunState {
  if (!preview) return { state: 'unavailable' };
  const invalid = installPlanPreviewInvalid(preview);
  if (invalid) return { state: 'failed', message: invalid };
  if (preview.dryRun === 'passed') return { state: 'passed', message: 'Passed · admitted by the API server (checked as you by Pulse)' };
  return { state: 'unavailable' };
}

export function InstallPlanPreview({ input, preview }: { input: Record<string, unknown>; preview?: Record<string, unknown> }) {
  const invalid = installPlanPreviewInvalid(preview);
  const installs = list(preview?.installs);
  const replaces = list(preview?.replaces);
  const steps = Array.isArray(preview?.steps) ? (preview!.steps as Array<{ kind?: string; name?: string }>) : [];
  const stepCount = Number(preview?.stepCount ?? steps.length) || 0;
  const crdCount = Number(preview?.crdCount ?? 0) || 0;
  return (
    <div className="space-y-2 rounded-sm border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs" data-testid="installplan-preview">
      <h4 className="font-medium text-slate-400">InstallPlan {str(input.namespace)}/{str(input.name)}</h4>
      {!preview ? (
        <p className="text-slate-400">This agent sent no preview, so what the plan installs is not shown. Check Operators › Needs approval before approving.</p>
      ) : (
        <>
          {invalid && <p role="alert" className="text-red-300">Pulse will refuse this: {invalid}</p>}
          {(installs.length > 0 || replaces.length > 0) && (
            <div className="font-mono">
              {replaces.map((c) => <div key={`r-${c}`} className="text-red-300">- {c}</div>)}
              {installs.map((c) => <div key={`i-${c}`} className="text-green-300">+ {c}</div>)}
              {replaces.length === 0 && <div className="text-slate-400">{preview.subscription ? 'Replaces nothing installed' : 'Replaced version unknown (Subscription not readable)'}</div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="font-medium text-slate-400">Operator</div>
              <div className="text-slate-200">{str(preview.operator) || 'unknown'}{preview.channel ? ` · channel ${str(preview.channel)}` : ''}</div>
            </div>
            <div>
              <div className="font-medium text-slate-400">Held to resourceVersion</div>
              <div className="font-mono text-slate-200">{str(preview.resourceVersion) || 'none'}</div>
            </div>
          </div>
          {stepCount > 0 && (
            <details>
              <summary className="cursor-pointer text-slate-300">
                Applies {stepCount} resource{stepCount === 1 ? '' : 's'}{crdCount ? `, including ${crdCount} CustomResourceDefinition${crdCount === 1 ? '' : 's'}` : ''}
              </summary>
              <ul className="mt-1 max-h-40 overflow-auto font-mono text-slate-300">
                {steps.map((s, i) => <li key={i}>{str(s.kind)} {str(s.name)}</li>)}
              </ul>
            </details>
          )}
          {preview.gitops ? <p className="text-amber-300">{str(preview.gitops)}</p> : null}
          <p className="text-slate-400">{str(preview.noDeny) || 'OLM has no Deny: leaving the plan unapproved is how an update is declined.'}</p>
        </>
      )}
    </div>
  );
}
