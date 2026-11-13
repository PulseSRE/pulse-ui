/**
 * What a chat-proposed access change will do, in the confirmation card.
 *
 * Built from the agent's `access_change` preview for `grant_access` and
 * `revoke_access` (pulse-agent API_CONTRACT `confirm_request.preview`):
 * computed as you, from the code the tool runs. It carries the binding YAML
 * as a line diff, the role and its rules, what the subject can newly do, who
 * else keeps the binding, the API server's dry run of the exact request, and
 * a risk level with its reasons. An older agent sends no preview; the card
 * then shows the model's input and says what it cannot show.
 *
 * Access changes are never auto-approved, at any trust level, and a HIGH one
 * takes no keyboard shortcut and needs an explicit acknowledgement.
 */
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DryRunState } from '../primitives/WriteConfirmDialog';

export const ACCESS_TOOLS = new Set(['grant_access', 'revoke_access']);

export interface AccessDiffLine { op: '+' | '-' | ' '; text: string }

export interface AccessChange {
  action: 'create' | 'remove-subject' | 'delete' | '';
  valid: boolean;
  error: string;
  risk: 'HIGH' | 'MEDIUM';
  riskReasons: string[];
  subject: { kind: string; name: string; namespace?: string };
  role: { kind: string; name: string; rules: string[]; rulesKnown: boolean; rulesNote: string };
  binding: { kind: string; name: string; namespace: string | null };
  scope: 'namespace' | 'cluster';
  diff: AccessDiffLine[];
  newPermissions: { state: string; rules: string[]; alreadyHad: string[]; note: string } | null;
  otherSubjects: Array<{ kind: string; name: string; namespace?: string }>;
  deletesBinding: boolean;
  dryRun: { state: string; message: string };
  impact: string;
  undo: string;
  gitops: { tool: string; app: string; detail: string } | null;
  warnings: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str) : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The agent's preview, read defensively; null when it is not an access_change preview. */
export function accessChange(preview?: Record<string, unknown>): AccessChange | null {
  if (!preview || preview.kind !== 'access_change') return null;
  const subject = obj(preview.subject);
  const role = obj(preview.role);
  const binding = obj(preview.binding);
  const dryRun = obj(preview.dryRun);
  const np = preview.newPermissions ? obj(preview.newPermissions) : null;
  const gitops = preview.gitops ? obj(preview.gitops) : null;
  const action = str(preview.action);
  return {
    action: action === 'create' || action === 'remove-subject' || action === 'delete' ? action : '',
    valid: preview.valid === true,
    error: str(preview.error),
    // Anything but an explicit MEDIUM is treated as HIGH.
    risk: preview.risk === 'MEDIUM' ? 'MEDIUM' : 'HIGH',
    riskReasons: strs(preview.riskReasons),
    subject: { kind: str(subject.kind), name: str(subject.name), namespace: subject.namespace ? str(subject.namespace) : undefined },
    role: { kind: str(role.kind), name: str(role.name), rules: strs(role.rules), rulesKnown: role.rulesKnown === true, rulesNote: str(role.rulesNote) },
    binding: { kind: str(binding.kind), name: str(binding.name), namespace: binding.namespace ? str(binding.namespace) : null },
    scope: preview.scope === 'cluster' ? 'cluster' : 'namespace',
    diff: Array.isArray(preview.diff)
      ? (preview.diff as unknown[]).map((d) => {
        const line = obj(d);
        const op = line.op === '+' || line.op === '-' ? line.op : ' ';
        return { op, text: str(line.text) } as AccessDiffLine;
      })
      : [],
    newPermissions: np ? { state: str(np.state), rules: strs(np.rules), alreadyHad: strs(np.alreadyHad), note: str(np.note) } : null,
    otherSubjects: Array.isArray(preview.otherSubjects)
      ? (preview.otherSubjects as unknown[]).map((s) => {
        const o = obj(s);
        return { kind: str(o.kind), name: str(o.name), namespace: o.namespace ? str(o.namespace) : undefined };
      })
      : [],
    deletesBinding: preview.deletesBinding === true,
    dryRun: { state: str(dryRun.state), message: str(dryRun.message) },
    impact: str(preview.impact),
    undo: str(preview.undo),
    gitops: gitops ? { tool: str(gitops.tool), app: str(gitops.app), detail: str(gitops.detail) } : null,
    warnings: strs(preview.warnings),
  };
}

/** True when the agent has already said the write will be refused. */
export function accessPreviewInvalid(preview?: Record<string, unknown>): string | null {
  const change = accessChange(preview);
  if (!change || change.valid) return null;
  if (change.error) return change.error;
  if (change.dryRun.state === 'failed') return change.dryRun.message || 'The API server refused the dry run.';
  return 'Pulse will refuse this access change.';
}

export function accessDryRun(preview?: Record<string, unknown>): DryRunState {
  const change = accessChange(preview);
  if (!change) return { state: 'unavailable' };
  if (change.dryRun.state === 'passed') return { state: 'passed', message: change.dryRun.message || undefined };
  if (change.dryRun.state === 'failed') return { state: 'failed', message: change.dryRun.message || 'Refused by the API server' };
  if (change.error) return { state: 'failed', message: change.error };
  return { state: 'unavailable' };
}

/**
 * The access change's risk: the agent's assessment when it sent one. Without
 * a preview a grant is HIGH (what it hands over is unknown), a revoke MEDIUM.
 */
export function accessRisk(tool: string, preview?: Record<string, unknown>): 'HIGH' | 'MEDIUM' {
  const change = accessChange(preview);
  if (change) return change.risk;
  return tool === 'grant_access' ? 'HIGH' : 'MEDIUM';
}

/** The permission the card checks for the person before offering Approve. */
export function accessPermission(tool: string, input: Record<string, unknown>, preview?: Record<string, unknown>): { verb: string; group: string; resource: string; namespace?: string } | null {
  const change = accessChange(preview);
  const ns = typeof input.namespace === 'string' && input.namespace ? input.namespace : undefined;
  const group = 'rbac.authorization.k8s.io';
  if (tool === 'grant_access') return { verb: 'create', group, resource: ns ? 'rolebindings' : 'clusterrolebindings', namespace: ns };
  if (tool === 'revoke_access') {
    const cluster = input.binding_kind === 'ClusterRoleBinding';
    return { verb: change?.deletesBinding ? 'delete' : 'patch', group, resource: cluster ? 'clusterrolebindings' : 'rolebindings', namespace: cluster ? undefined : ns };
  }
  return null;
}

function subjectText(s: { kind: string; name: string; namespace?: string }): string {
  return s.kind === 'ServiceAccount' && s.namespace ? `ServiceAccount ${s.namespace}/${s.name}` : `${s.kind} ${s.name}`;
}

function inputSubject(input: Record<string, unknown>): string {
  return `${str(input.subject_kind) || 'Subject'} ${str(input.subject_name)}`;
}

/** The red banner for a HIGH-risk access change, with the reasons. */
export function AccessRiskBanner({ reasons, tool }: { reasons: string[]; tool: string }) {
  return (
    <div role="alert" data-testid="access-risk-banner" className="rounded-sm border border-red-700 bg-red-950/50 px-3 py-2 text-xs text-red-200">
      <div className="flex items-center gap-1.5 font-semibold text-red-100">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        {tool === 'grant_access' ? 'High-risk grant: this can hand over control' : 'High-risk access change'}
      </div>
      {reasons.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 space-y-0.5">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      ) : (
        <p className="mt-1">This agent sent no preview, so what the role grants is not shown. Check the role in Access review before approving.</p>
      )}
      <p className="mt-1 text-red-300">Never approved automatically or by a keyboard shortcut.</p>
    </div>
  );
}

export function AccessChangePreview({ tool, input, preview }: { tool: string; input: Record<string, unknown>; preview?: Record<string, unknown> }) {
  const change = accessChange(preview);
  const invalid = accessPreviewInvalid(preview);
  if (!change) {
    return (
      <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 space-y-1 text-xs" data-testid="access-preview">
        <p className="text-slate-200">
          {tool === 'grant_access'
            ? `Grant ${str(input.role_kind) || 'ClusterRole'} ${str(input.role_name)} to ${inputSubject(input)} ${input.namespace ? `in ${str(input.namespace)}` : 'cluster-wide'}`
            : `Remove ${inputSubject(input)} from ${str(input.binding_kind)} ${input.namespace ? `${str(input.namespace)}/` : ''}${str(input.binding_name)}`}
        </p>
        <p className="text-slate-400">This agent sent no preview, so the binding, the role's rules and the dry run are not shown here; check them in Access review.</p>
      </div>
    );
  }
  const where = change.binding.namespace ? `${change.binding.namespace}/` : '';
  return (
    <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 space-y-2 text-xs" data-testid="access-preview">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <div className="text-slate-400 font-medium">Subject</div>
          <div className="text-slate-200">{subjectText(change.subject)}</div>
        </div>
        <div>
          <div className="text-slate-400 font-medium">Role</div>
          <div className="text-slate-200">{change.role.kind} {change.role.name}</div>
        </div>
        <div>
          <div className="text-slate-400 font-medium">Where</div>
          <div className="text-slate-200">{change.scope === 'cluster' ? 'Cluster-wide (every namespace)' : `Namespace ${change.binding.namespace ?? ''}`}</div>
        </div>
      </div>

      {invalid && <p role="alert" className="text-red-300">Pulse will refuse this: {invalid}</p>}

      {change.diff.length > 0 && (
        <div>
          <h4 className="font-medium text-slate-400 mb-0.5">
            {change.action === 'create' ? 'New' : change.deletesBinding ? 'Deleted' : 'Changed'} {change.binding.kind} {where}{change.binding.name}
          </h4>
          <pre aria-label="Binding diff" className="max-h-64 overflow-auto rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[12px] leading-relaxed">
            {change.diff.map((d, i) => (
              <span key={i} className={cn('block whitespace-pre', d.op === '+' ? 'text-green-300' : d.op === '-' ? 'text-red-300' : 'text-slate-400')}>
                {d.op} {d.text}
              </span>
            ))}
          </pre>
        </div>
      )}

      {change.deletesBinding && (
        <p className="text-slate-200" data-testid="access-deletes-binding">
          {subjectText(change.subject)} is the binding&apos;s only subject, so the whole {change.binding.kind} is deleted.
        </p>
      )}
      {change.action !== 'create' && change.otherSubjects.length > 0 && (
        <p className="text-slate-300">Keep access through this binding: {change.otherSubjects.map(subjectText).join(', ')}</p>
      )}

      <div>
        <h4 className="font-medium text-slate-400 mb-0.5">{change.action === 'create' ? 'The role grants' : 'Lost through this binding'}</h4>
        {change.role.rulesKnown ? (
          change.role.rules.length > 0
            ? <ul className="font-mono text-slate-300">{change.role.rules.map((r) => <li key={r}>- {r}</li>)}</ul>
            : <p className="text-slate-400">No rules.</p>
        ) : <p className="text-red-300">{change.role.rulesNote || "The role's rules could not be read."}</p>}
      </div>

      {change.action === 'create' && change.newPermissions && (
        <div data-testid="access-new-permissions">
          <h4 className="font-medium text-slate-400 mb-0.5">What {change.subject.name} can newly do</h4>
          {change.newPermissions.rules.length > 0
            ? <ul className="font-mono text-green-300">{change.newPermissions.rules.map((r) => <li key={r}>+ {r}</li>)}</ul>
            : <p className="text-slate-300">Nothing new: they already hold every rule of this role here.</p>}
          {change.newPermissions.alreadyHad.length > 0 && (
            <p className="text-slate-400">Already held: {change.newPermissions.alreadyHad.join('; ')}</p>
          )}
          {change.newPermissions.note && <p className="text-slate-400">{change.newPermissions.note}</p>}
        </div>
      )}

      {change.gitops && (
        <p className="text-amber-300">
          Managed by {change.gitops.tool}{change.gitops.app ? ` (${change.gitops.app})` : ''}: prefer a pull request to its source; a direct edit can be reverted.
        </p>
      )}
      {change.warnings.length > 0 && (
        <ul className="text-slate-300 space-y-0.5">{change.warnings.map((w) => <li key={w}>Note: {w}</li>)}</ul>
      )}
    </div>
  );
}
