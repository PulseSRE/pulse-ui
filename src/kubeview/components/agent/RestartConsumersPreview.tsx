/**
 * What a chat-proposed "restart consumers" will do, in the confirmation card.
 *
 * Built from the agent's `confirm_request.preview` (kind `restart_consumers`,
 * computed as you, from the code the tool runs): every workload it restarts in
 * order, its rollout strategy and Services, how it uses the ConfigMap/Secret,
 * an Argo CD owner, the consumers it leaves alone and why, and the server-side
 * dry run of every patch. An older agent sends no preview; the card then says
 * what it cannot show.
 */

interface RestartItem { kind?: string; name?: string; strategy?: string; services?: string[] | null; uses?: string[]; gitops?: string | null }
interface SkipItem { kind?: string; name?: string; reason?: string; pickUp?: string }
interface DryRunError { kind?: string; name?: string; error?: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function list<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** True when the agent has already said the restart will be refused. */
export function restartPreviewInvalid(preview?: Record<string, unknown>): string | null {
  if (!preview || preview.valid !== false) return null;
  return str(preview.error) || 'Pulse will refuse this restart.';
}

/** The number of workloads the preview says will restart (null without a preview). */
export function restartCount(preview?: Record<string, unknown>): number | null {
  return preview && Array.isArray(preview.restart) ? preview.restart.length : null;
}

export function RestartConsumersPreview({ input, preview }: { input: Record<string, unknown>; preview?: Record<string, unknown> }) {
  const target = `${str(input.kind)} ${str(input.namespace)}/${str(input.name)}`;
  if (!preview) {
    return (
      <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 text-xs" data-testid="restart-consumers-preview">
        <p className="text-slate-400">Restarts the workloads that use {target}. This agent sent no preview, so they are not listed here; check the {str(input.kind) || 'object'}'s Used by section.</p>
      </div>
    );
  }
  const invalid = restartPreviewInvalid(preview);
  const restart = list<RestartItem>(preview.restart);
  const skipped = list<SkipItem>(preview.skipped);
  const others = list<SkipItem>(preview.notRestarted);
  const incomplete = list<string>(preview.incomplete);
  const dryErrors = list<DryRunError>((preview.dryRun as { errors?: unknown } | undefined)?.errors);
  return (
    <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 space-y-2 text-xs" data-testid="restart-consumers-preview">
      {invalid && <p role="alert" className="text-red-300">Pulse will refuse this: {invalid}</p>}
      {dryErrors.length > 0 && (
        <ul className="text-red-300">
          {dryErrors.map((e, i) => <li key={i}>Dry run refused {str(e.kind)} {str(e.name)}: {str(e.error)}</li>)}
        </ul>
      )}
      <div>
        <h4 className="font-medium text-slate-400 mb-0.5">Restarts, in this order ({restart.length})</h4>
        {restart.length === 0 ? <p className="text-slate-400">Nothing to restart.</p> : (
          <ol className="space-y-1">
            {restart.map((r, i) => (
              <li key={`${r.kind}/${r.name}`} className="text-slate-200">
                <span className="text-faint">{i + 1}. </span>
                <span className="text-slate-400">{str(r.kind)} </span>
                <span className="font-mono">{str(r.name)}</span>
                <span className="text-slate-400"> · {str(r.strategy)}</span>
                {r.services === null
                  ? <span className="text-faint"> · Services: could not check</span>
                  : r.services && r.services.length > 0 && <span className="text-slate-400"> · serves {r.services.join(', ')}</span>}
                {list<string>(r.uses).length > 0 && <div className="text-faint pl-4">{list<string>(r.uses).join('; ')}</div>}
                {r.gitops && (
                  <div className="text-amber-300 pl-4">Managed by Argo CD ({r.gitops}): the restart annotation is drift it may revert, starting a second rollout. Make the config change itself through Git.</div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {(skipped.length > 0 || others.length > 0) && (
        <div>
          <h4 className="font-medium text-slate-400 mb-0.5">Not restarted</h4>
          <ul className="text-slate-400 space-y-0.5">
            {skipped.map((s) => <li key={`s-${s.kind}/${s.name}`}>{str(s.kind)} <span className="font-mono">{str(s.name)}</span>: {str(s.reason)}</li>)}
            {others.map((s) => <li key={`o-${s.kind}/${s.name}`}>{str(s.kind)} <span className="font-mono">{str(s.name)}</span>: picks up changes {str(s.pickUp)}</li>)}
          </ul>
        </div>
      )}
      {incomplete.length > 0 && <p className="text-amber-300">Could not check {incomplete.join(', ')}: there may be more consumers.</p>}
      {preview.orderUnknown === true && <p className="text-slate-400">Services could not be read, so the order is as listed, not by traffic.</p>}
      {preview.sequence != null && <p className="text-slate-400">{str(preview.sequence)}</p>}
      {preview.notScanned != null && <p className="text-faint">Not checked: {str(preview.notScanned)}.</p>}
    </div>
  );
}
