import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileKey, Check, X, CheckCheck } from 'lucide-react';
import { k8sList } from '../../engine/query';
import {
  CSR_LIST_PATH, csrStatus, decideCsr, isKubeletServing, isPending,
  type CertificateSigningRequest, type CSRStatus,
} from '../../engine/csr';
import { formatAge } from '../../engine/dateUtils';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { useUIStore } from '../../store/uiStore';
import { Card } from '../../components/primitives/Card';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { EmptyState } from '../../components/primitives/EmptyState';
import { StatCard } from '../../components/primitives/StatCard';
import { MetricGrid } from '../../components/primitives/MetricGrid';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';

const STATUS_VARIANT: Record<CSRStatus, 'warning' | 'success' | 'info' | 'error'> = {
  Pending: 'warning',
  Approved: 'info',
  Issued: 'success',
  Denied: 'error',
  Failed: 'error',
};

type Decision =
  | { kind: 'one'; csr: CertificateSigningRequest; decision: 'Approved' | 'Denied' }
  | { kind: 'bulk'; csrs: CertificateSigningRequest[] };

/** Pending CSRs on the active cluster, for the Compute badge and the Admin tab. */
export function useCsrs() {
  const clusterId = useActiveClusterId();
  return useQuery<CertificateSigningRequest[]>({
    queryKey: ['admin', 'csrs', clusterId],
    queryFn: async () => (await k8sList<CertificateSigningRequest>(CSR_LIST_PATH, undefined, clusterId))
      .filter((c) => typeof c?.spec?.signerName === 'string'),
    refetchInterval: 30000,
    retry: false,
  });
}

export function CsrTab({ go }: { go: (path: string, title: string) => void }) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const { data: csrs = [], isLoading, error, refetch } = useCsrs();
  const [showAll, setShowAll] = React.useState(false);
  const { allowed: canApprove } = useCanI('update', 'certificates.k8s.io', 'certificatesigningrequests', undefined, 'approval');
  const action = usePinnedAction<Decision>();
  const [bulkResult, setBulkResult] = React.useState<string[] | null>(null);

  const sorted = React.useMemo(() => [...csrs].sort((a, b) => {
    const pa = isPending(a) ? 0 : 1;
    const pb = isPending(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (b.metadata.creationTimestamp || '').localeCompare(a.metadata.creationTimestamp || '');
  }), [csrs]);
  const pending = sorted.filter(isPending);
  const pendingKubelet = pending.filter(isKubeletServing);
  const visible = showAll ? sorted : pending;

  const confirm = async () => {
    const p = action.pending?.target;
    if (!p) return;
    const ok = await action.run(p.kind === 'one' ? `${p.decision === 'Approved' ? 'Approving' : 'Denying'} ${p.csr.metadata.name}` : 'Bulk approval', async (target, clusterId) => {
      if (target.kind === 'one') {
        await decideCsr(clusterId, target.csr, target.decision);
        addToast({ type: 'success', title: `${target.csr.metadata.name} ${target.decision === 'Approved' ? 'approved' : 'denied'}` });
        return;
      }
      // One request per CSR; report each failure instead of stopping at the first.
      const failures: string[] = [];
      for (const csr of target.csrs) {
        try {
          await decideCsr(clusterId, csr, 'Approved');
        } catch (e) {
          failures.push(`${csr.metadata.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const done = target.csrs.length - failures.length;
      if (failures.length > 0) {
        setBulkResult(failures);
        throw new Error(`${done} of ${target.csrs.length} approved; ${failures.length} failed`);
      }
      addToast({ type: 'success', title: `${done} kubelet serving CSR${done === 1 ? '' : 's'} approved` });
    });
    queryClient.invalidateQueries({ queryKey: ['admin', 'csrs'] });
    if (ok) setBulkResult(null);
  };


  const target = action.pending?.target;
  const dialogTitle = !target ? '' : target.kind === 'bulk'
    ? `Approve ${target.csrs.length} kubelet serving CSR${target.csrs.length === 1 ? '' : 's'}?`
    : `${target.decision === 'Approved' ? 'Approve' : 'Deny'} ${target.csr.metadata.name}?`;
  const dialogDescription = !target ? '' : target.kind === 'bulk'
    ? 'Each request below is approved with an Approved condition on its approval subresource. The kubelet then receives a serving certificate signed by the cluster CA.'
    : target.decision === 'Approved'
      ? `Adds an Approved condition. The signer ${target.csr.spec.signerName} will issue a certificate to ${target.csr.spec.username || 'the requester'} with usages: ${(target.csr.spec.usages || []).join(', ') || 'none listed'}.`
      : `Adds a Denied condition. No certificate is issued; ${target.csr.spec.username || 'the requester'} has to submit a new request.`;

  // The dialog stays mounted while the list reloads (e.g. after a cluster
  // switch), so a pending decision is refused with a reason, not lost.
  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading certificate signing requests…</div>
      ) : error ? (
        <LoadError title="Certificate signing requests could not be loaded" error={error} onRetry={() => refetch()} />
      ) : (<>
      <MetricGrid>
        <StatCard label="Pending" value={pending.length} variant={pending.length > 0 ? 'warning' : 'default'} highlight={pending.length > 0} />
        <StatCard label="Pending kubelet serving" value={pendingKubelet.length} />
        <StatCard label="All requests" value={csrs.length} />
      </MetricGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>
          {showAll ? 'Show pending only' : `Show all (${csrs.length})`}
        </Button>
        {pendingKubelet.length > 0 && (
          <Button
            size="sm"
            onClick={() => action.open({ kind: 'bulk', csrs: pendingKubelet })}
            disabled={!canApprove}
            title={canApprove ? undefined : 'You do not have permission to approve certificate signing requests'}
          >
            <CheckCheck className="w-3.5 h-3.5" /> Approve {pendingKubelet.length} kubelet serving CSR{pendingKubelet.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            icon={<FileKey className="w-8 h-8" />}
            title={showAll ? 'No certificate signing requests' : 'No pending certificate signing requests'}
            description="Nodes and kubelets request certificates here; new nodes wait on a pending request until it is approved."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800 text-left">
                  <th className="py-2 px-3 font-normal">Name</th>
                  <th className="py-2 px-3 font-normal">Requester</th>
                  <th className="py-2 px-3 font-normal">Signer</th>
                  <th className="py-2 px-3 font-normal">Usages</th>
                  <th className="py-2 px-3 font-normal">Age</th>
                  <th className="py-2 px-3 font-normal">Status</th>
                  <th className="py-2 px-3 font-normal sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {visible.map((csr) => {
                  const status = csrStatus(csr);
                  return (
                    <tr key={csr.metadata.uid || csr.metadata.name} data-testid={`csr-${csr.metadata.name}`}>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => go(`/r/certificates.k8s.io~v1~certificatesigningrequests/_/${csr.metadata.name}`, csr.metadata.name)}
                          className="text-blue-400 hover:text-blue-300 font-mono"
                        >
                          {csr.metadata.name}
                        </button>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-300">{csr.spec.username || '—'}</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{csr.spec.signerName}</td>
                      <td className="py-2 px-3 text-slate-400">{(csr.spec.usages || []).join(', ') || '—'}</td>
                      <td className="py-2 px-3 text-slate-500">{csr.metadata.creationTimestamp ? formatAge(new Date(csr.metadata.creationTimestamp)) : '—'}</td>
                      <td className="py-2 px-3"><Badge size="sm" variant={STATUS_VARIANT[status]}>{status}</Badge></td>
                      <td className="py-2 px-3">
                        {status === 'Pending' && (
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" disabled={!canApprove} aria-label={`Approve ${csr.metadata.name}`}
                              title={canApprove ? undefined : 'You do not have permission to approve certificate signing requests'}
                              onClick={() => action.open({ kind: 'one', csr, decision: 'Approved' })}>
                              <Check className="w-3.5 h-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="danger" disabled={!canApprove} aria-label={`Deny ${csr.metadata.name}`}
                              title={canApprove ? undefined : 'You do not have permission to deny certificate signing requests'}
                              onClick={() => action.open({ kind: 'one', csr, decision: 'Denied' })}>
                              <X className="w-3.5 h-3.5" /> Deny
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>)}

      <ConfirmDialog
        open={!!action.pending}
        onClose={() => { action.close(); setBulkResult(null); }}
        onConfirm={confirm}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={target?.kind === 'one' && target.decision === 'Denied' ? 'Deny' : 'Approve'}
        variant={target?.kind === 'one' && target.decision === 'Denied' ? 'danger' : 'warning'}
        loading={action.running}
      >
        {target?.kind === 'bulk' && (
          <ul className="mt-3 max-h-48 overflow-auto space-y-1 text-xs font-mono text-slate-300" aria-label="Requests to approve">
            {target.csrs.map((c) => <li key={c.metadata.name}>{c.metadata.name} — {c.spec.username}</li>)}
          </ul>
        )}
        {action.error && <LoadError className="mt-3" title="Not done" error={action.error} />}
        {bulkResult && (
          <ul className="mt-2 space-y-1 text-xs text-red-300" aria-label="Failed approvals">
            {bulkResult.map((f) => <li key={f}>{f}</li>)}
          </ul>
        )}
      </ConfirmDialog>
    </div>
  );
}

/** Compute badge: shown only when the active cluster has pending CSRs. */
export function PendingCsrNotice({ go }: { go: (path: string, title: string) => void }) {
  const { data: csrs = [] } = useCsrs();
  const pending = csrs.filter(isPending).length;
  if (pending === 0) return null;
  return (
    <button
      onClick={() => go('/admin?tab=csrs', 'Certificate requests')}
      className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg border border-amber-800 bg-amber-950/30 text-left text-sm text-amber-200 hover:bg-amber-900/30"
    >
      <FileKey className="w-4 h-4 text-amber-400 shrink-0" />
      {pending} certificate signing request{pending === 1 ? ' is' : 's are'} pending approval — nodes may not join or serve logs until approved
      <span className="ml-auto text-xs text-amber-300">Review →</span>
    </button>
  );
}
