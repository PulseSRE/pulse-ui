import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileWarning, CheckCircle, XCircle, HelpCircle, Loader2, ChevronRight, ChevronDown, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Panel } from '../../components/primitives/Panel';
import { LoadError } from '../../components/primitives/LoadError';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { TONE_CLASSES } from '../../engine/statusColors';
import { listK8s, readK8s, type ReadResult } from '../../engine/readResult';
import { k8sPatch } from '../../engine/query';
import { assertActiveCluster, clusterDisplayName } from '../../engine/pendingCluster';
import { gvrKey } from '../../engine/discovery';
import { useFleetStore } from '../../store/fleetStore';
import { useClusterStore } from '../../store/clusterStore';
import { useCanI } from '../../hooks/useCanI';
import type { ConfigMap } from '../../engine/types';
import {
  API_REQUEST_COUNTS_PATH, ADMIN_GATES_PATH, ADMIN_ACKS_PATH,
  type APIRequestCount, type ApiRemovalVerdict, type AdminGate, type ApiRemovalInputs, type RemovedApi,
} from '../../engine/upgradeApiRemovals';

/** The reads behind the removed-API check, for the active cluster. Never throws: each read is a ReadResult. */
export function useApiRemovalReads() {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const opts = { staleTime: 60_000, retry: false } as const;
  const arcs = useQuery({
    queryKey: ['upgrade-api-removals', clusterId, 'apirequestcounts'],
    queryFn: () => listK8s<APIRequestCount>(API_REQUEST_COUNTS_PATH, clusterId),
    ...opts,
  });
  const gates = useQuery({
    queryKey: ['upgrade-api-removals', clusterId, 'admin-gates'],
    queryFn: () => readK8s<ConfigMap>(ADMIN_GATES_PATH, clusterId),
    ...opts,
  });
  const acks = useQuery({
    queryKey: ['upgrade-api-removals', clusterId, 'admin-acks'],
    queryFn: () => readK8s<ConfigMap>(ADMIN_ACKS_PATH, clusterId),
    ...opts,
  });
  const loading = !arcs.data || !gates.data || !acks.data;
  const reads: Omit<ApiRemovalInputs, 'clusterVersion' | 'targetVersion'> | null = loading ? null : {
    apiRequestCounts: arcs.data as ReadResult<APIRequestCount[]>,
    adminGates: gates.data as ReadResult<ConfigMap>,
    adminAcks: acks.data as ReadResult<ConfigMap>,
  };
  const times = [arcs.dataUpdatedAt, gates.dataUpdatedAt, acks.dataUpdatedAt];
  return {
    clusterId,
    reads,
    /** When the oldest of the three reads answered; 0 until all have. */
    updatedAt: times.every((t) => t > 0) ? Math.min(...times) : 0,
    refetchAll: () => { void arcs.refetch(); void gates.refetch(); void acks.refetch(); },
    refetchAcks: () => acks.refetch(),
  };
}

export const VERDICT_LABEL: Record<ApiRemovalVerdict['status'], string> = { go: 'Go', no_go: 'No-go', unknown: 'Could not check' };

export function VerdictBadge({ status }: { status: ApiRemovalVerdict['status'] }) {
  const tone = status === 'go' ? 'success' : status === 'no_go' ? 'danger' : 'neutral';
  const Icon = status === 'go' ? CheckCircle : status === 'no_go' ? XCircle : HelpCircle;
  return (
    <span
      data-testid="removed-apis-verdict"
      data-status={status}
      {...(status === 'unknown' ? { 'data-unknown': true } : {})}
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium', TONE_CLASSES[tone].chip)}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {VERDICT_LABEL[status]}
    </span>
  );
}

const MAX_CALLER_CHARS = 120;
/** Usernames and user agents are client-controlled: cap what is rendered, keep the full text in the tooltip. */
export function truncateCaller(s: string): string {
  return s.length > MAX_CALLER_CHARS ? `${s.slice(0, MAX_CALLER_CHARS - 1)}\u2026` : s;
}

function apiVersionLabel(api: RemovedApi) {
  return api.group ? `${api.group}/${api.version}` : api.version;
}

/** The resource list page for an API, when discovery on this cluster still serves it. */
function useResourceListPath(clusterId: string) {
  const registry = useClusterStore((s) => s.resourceRegistry);
  const discoveryClusterId = useClusterStore((s) => s.discoveryClusterId);
  return (api: RemovedApi): string | null => {
    if (!registry || discoveryClusterId !== clusterId) return null;
    if (!registry.has(gvrKey(api.group, api.version, api.resource))) return null;
    return `/r/${api.group ? `${api.group}~` : ''}${api.version}~${api.resource}`;
  };
}

/** The merge patch that acknowledges a gate; the confirm dialog shows it verbatim. */
export function ackPatch(key: string): { data: Record<string, string> } {
  return { data: { [key]: 'true' } };
}

/**
 * Acknowledge admin gates: merge-patches openshift-config/admin-acks with the
 * user's own credentials on the cluster the reads came from, after a confirm
 * dialog quoting the gate. The acknowledged state shown afterwards comes from
 * re-reading admin-acks, not from assuming the patch took.
 */
export function AdminGateActions({ gates, clusterId, onAcked }: {
  gates: AdminGate[];
  clusterId: string;
  onAcked: () => Promise<unknown> | void;
}) {
  const { allowed: canPatch, isLoading: rbacLoading } = useCanI('patch', '', 'configmaps', 'openshift-config');
  const [confirm, setConfirm] = React.useState<{ gate: AdminGate; clusterId: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, unknown>>({});

  const noPermission = 'You do not have permission to patch ConfigMaps in openshift-config.';

  const acknowledge = async () => {
    if (!confirm) return;
    const { gate, clusterId: pinned } = confirm;
    setPending(true);
    try {
      assertActiveCluster(pinned, 'The acknowledgement');
      await k8sPatch(ADMIN_ACKS_PATH, ackPatch(gate.key), 'application/merge-patch+json', pinned);
      setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== gate.key)));
      // The ClusterVersion watch picks up the Upgradeable condition change on its own.
      await onAcked();
    } catch (err) {
      setErrors((e) => ({ ...e, [gate.key]: err }));
    }
    setPending(false);
    setConfirm(null);
  };

  if (gates.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label="Admin acknowledgements">
      {gates.map((gate) => (
        <li key={gate.key} className="rounded-sm border border-slate-800 bg-slate-950/40 p-2.5 text-xs" data-testid={`admin-gate-${gate.key}`}>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-slate-300 break-all">{gate.key}</code>
            {gate.acknowledged === true && (
              <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm', TONE_CLASSES.success.chip)}><ShieldCheck className="w-3 h-3" aria-hidden="true" />Acknowledged</span>
            )}
            {gate.acknowledged === false && (
              <span className={cn('px-1.5 py-0.5 rounded-sm', TONE_CLASSES.warning.chip)}>Not acknowledged</span>
            )}
            {gate.acknowledged === null && (
              <span data-unknown className={cn('px-1.5 py-0.5 rounded-sm', TONE_CLASSES.neutral.chip)}>Acknowledgement unknown</span>
            )}
          </div>
          <p className="mt-1 text-slate-400 whitespace-pre-wrap">{gate.description}</p>
          {gate.acknowledged === false && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirm({ gate, clusterId })}
                disabled={!canPatch || rbacLoading}
                title={!canPatch && !rbacLoading ? noPermission : undefined}
                className="px-2.5 py-1 rounded-sm bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Acknowledge
              </button>
              {!canPatch && !rbacLoading && <span className="text-slate-500">{noPermission}</span>}
            </div>
          )}
          {errors[gate.key] !== undefined && (
            <LoadError className="mt-2" title={`Could not acknowledge ${gate.key}`} error={errors[gate.key]} />
          )}
        </li>
      ))}
      {confirm && (
        <ConfirmDialog
          open={true}
          onClose={() => { if (!pending) setConfirm(null); }}
          onConfirm={() => { void acknowledge(); }}
          title="Acknowledge this admin gate?"
          description={`"${confirm.gate.description}" This patches ConfigMap openshift-config/admin-acks on ${clusterDisplayName(confirm.clusterId)}, setting key ${confirm.gate.key} to "true", using your own credentials.`}
          confirmLabel="Acknowledge"
          variant="warning"
          loading={pending}
        >
          <div className="mt-3 text-xs">
            <div className="text-slate-400 mb-1">Merge patch sent to openshift-config/admin-acks:</div>
            <pre data-testid="admin-ack-patch-body" className="font-mono text-slate-200 bg-slate-950 border border-slate-800 rounded-sm px-2 py-1.5 whitespace-pre-wrap break-all">{JSON.stringify(ackPatch(confirm.gate.key))}</pre>
          </div>
        </ConfirmDialog>
      )}
    </ul>
  );
}

export interface RemovedApisPanelProps {
  verdict: ApiRemovalVerdict | null;
  /** Minors the check can be run for; the selected one is `verdict.target.ocp`. */
  targetOptions: string[];
  selectedTarget: string | undefined;
  onTargetChange: (minor: string) => void;
  /** Option label for a minor (e.g. "4.19 — next minor (not yet offered on your channel)"). */
  targetLabel?: (minor: string) => string;
  clusterId: string;
  onRetry: () => void;
  onAcked: () => Promise<unknown> | void;
  go?: (path: string, title: string) => void;
  /** The admin gates are shown elsewhere (the readiness panel's acknowledgement row). */
  hideGates?: boolean;
}

/**
 * "Removed APIs" check for the next minor: which APIs the target Kubernetes
 * removes are still called, by whom, and which admin gates are unacknowledged.
 * Shown before the update action; it never blocks the update (that is the
 * admin's call) but says plainly when updating will break callers.
 */
export function RemovedApisPanel({ verdict, targetOptions, selectedTarget, onTargetChange, targetLabel, clusterId, onRetry, onAcked, go, hideGates }: RemovedApisPanelProps) {
  const [showUnused, setShowUnused] = React.useState(false);
  const listPath = useResourceListPath(clusterId);

  return (
    <Panel title="Removed APIs" icon={<FileWarning className="w-4 h-4 text-amber-500" />}>
      <section aria-label="Removed APIs check" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {verdict ? <VerdictBadge status={verdict.status} /> : (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />Checking…</span>
          )}
          {targetOptions.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              Update to
              <select
                aria-label="Target minor"
                value={selectedTarget ?? ''}
                onChange={(e) => onTargetChange(e.target.value)}
                className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded-sm text-slate-200 font-mono"
              >
                {targetOptions.map((m) => <option key={m} value={m}>{targetLabel ? targetLabel(m) : m}</option>)}
              </select>
            </label>
          )}
          {verdict?.target && <span className="text-xs text-slate-500 font-mono">Kubernetes {verdict.target.kube}</span>}
        </div>

        {verdict?.targetNotOffered && verdict.target && (
          <p className="text-xs text-slate-500" data-testid="removed-apis-target-not-offered">
            Checking {verdict.target.ocp}: next minor (not yet offered on your channel).
          </p>
        )}

        {verdict && <p className="text-xs text-slate-300" data-testid="removed-apis-reason">{verdict.reason}</p>}

        {verdict && verdict.failures.length > 0 && (
          <LoadError
            title={verdict.status === 'unknown' ? 'Removed APIs could not be checked' : 'Part of the removed-API check could not be read'}
            error={verdict.failures.join('; ')}
            onRetry={onRetry}
          />
        )}

        {verdict?.status === 'no_go' && (
          <div role="status" className="rounded-sm border border-red-900 bg-red-950/30 px-3 py-2 text-xs text-red-200">
            Updating is still possible {'—'} it is your call {'—'} but clients calling these APIs will fail once the cluster runs Kubernetes {verdict.target?.kube}, and while the cluster reports Upgradeable=False or an admin gate is unacknowledged, it will not update to {verdict.target?.ocp}.
          </div>
        )}

        {verdict && verdict.inUse.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Removed APIs in use">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-1.5 pr-3 font-medium">Resource</th>
                  <th className="py-1.5 pr-3 font-medium">Group/version</th>
                  <th className="py-1.5 pr-3 font-medium">Removed in</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Requests (24h)</th>
                  <th className="py-1.5 font-medium">Top callers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {verdict.inUse.map((api) => {
                  const path = listPath(api);
                  return (
                    <tr key={api.name} className="align-top">
                      <td className="py-1.5 pr-3 font-mono">
                        {path && go
                          ? <button type="button" onClick={() => go(path, api.resource)} className="text-blue-400 hover:text-blue-300 hover:underline">{api.resource}</button>
                          : <span className="text-slate-200">{api.resource}</span>}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-slate-300">{apiVersionLabel(api)}</td>
                      <td className="py-1.5 pr-3 font-mono text-slate-300">{api.removedInRelease}</td>
                      <td className="py-1.5 pr-3 font-mono text-right text-red-300">{api.requestCount.toLocaleString()}</td>
                      <td className="py-1.5">
                        {api.callers.length === 0 ? <span className="text-slate-500">No per-user breakdown reported</span> : (
                          <ul className="space-y-0.5">
                            {api.callers.slice(0, 3).map((c) => (
                              <li key={`${c.username}|${c.userAgent}`} className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-slate-200 break-all" title={c.username}>{truncateCaller(c.username)}</span>
                                {c.platform && <span className={cn('px-1 rounded-sm text-[10px]', TONE_CLASSES.info.chip)} title="A system: user, usually a cluster component that is updated with the cluster">Platform</span>}
                                <span className="text-slate-500 break-all" title={c.userAgent || undefined}>{c.userAgent ? truncateCaller(c.userAgent) : 'no user agent'}</span>
                                <span className="font-mono text-slate-400">({c.requestCount.toLocaleString()})</span>
                              </li>
                            ))}
                            {api.callers.length > 3 && <li className="text-slate-500">+{api.callers.length - 3} more</li>}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {verdict && verdict.unused.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowUnused((v) => !v)} aria-expanded={showUnused} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              {showUnused ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {verdict.unused.length} removed but not called in the last 24h
            </button>
            {showUnused && (
              <ul className="mt-1.5 ml-5 space-y-0.5 text-xs" aria-label="Removed APIs not in use">
                {verdict.unused.map((api) => {
                  const path = listPath(api);
                  return (
                    <li key={api.name} className="font-mono text-slate-400">
                      {path && go
                        ? <button type="button" onClick={() => go(path, api.resource)} className="text-blue-400 hover:text-blue-300 hover:underline">{api.resource}</button>
                        : api.resource}
                      {' '}<span className="text-slate-500">{apiVersionLabel(api)} · removed in {api.removedInRelease}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {!hideGates && verdict && verdict.gates.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-300">Admin acknowledgements for {verdict.target?.ocp}</div>
            <AdminGateActions gates={verdict.gates} clusterId={clusterId} onAcked={onAcked} />
          </div>
        )}

        {verdict?.target && (
          <p className="text-[11px] text-slate-500">
            Based on APIRequestCount (last 24h of requests). A client that runs less often than daily will not show up here.
          </p>
        )}
      </section>
    </Panel>
  );
}
