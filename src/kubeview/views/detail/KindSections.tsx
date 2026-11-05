/**
 * Detail-page sections for kinds whose everyday actions used to need YAML:
 * expanding a PVC (and seeing which pods mount it), editing an HPA's bounds,
 * a Service's endpoints, making a StorageClass the default, and which
 * workloads use a ConfigMap or Secret.
 */
import { useQuery } from '@tanstack/react-query';
import { Maximize2, SlidersHorizontal, Star } from 'lucide-react';
import { k8sGet, k8sList } from '../../engine/query';
import { PulseError } from '../../engine/errors';
import { useFleetStore } from '../../store/fleetStore';
import { useCanI } from '../../hooks/useCanI';
import { useActionDialog, describeWriteError } from '../../components/ActionDialog';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import {
  isDefaultStorageClass, expandPvc, quantityToBytes, sendWrite, setDefaultStorageClass, setHpaBounds,
} from '../../engine/workloadActions';
import type { K8sResource } from '../../engine/renderers';
import type { Pod } from '../../engine/types';
import { DetailSection } from './MetadataSections';
import { ConfigConsumersSection } from './ConfigConsumers';

type Go = (path: string, title: string) => void;

export function KindSections({ resource, go, savedAt }: { resource: K8sResource; go: Go; savedAt?: number }) {
  switch (resource.kind) {
    case 'ConfigMap':
    case 'Secret': return resource.metadata.namespace ? <ConfigConsumersSection resource={resource} go={go} savedAt={savedAt} /> : null;
    case 'PersistentVolumeClaim': return <PvcSection pvc={resource} go={go} />;
    case 'HorizontalPodAutoscaler': return <HpaSection hpa={resource} />;
    case 'Service': return <ServiceEndpointsSection svc={resource} go={go} />;
    case 'StorageClass': return <StorageClassSection sc={resource} />;
    default: return null;
  }
}

// ── PVC ─────────────────────────────────────────────

interface PvcSpec { storageClassName?: string; resources?: { requests?: { storage?: string } }; volumeName?: string }

/** Why this PVC cannot be expanded, or null when it can. */
export function pvcExpandBlocker(pvc: K8sResource, sc: K8sResource | null | undefined, scError: unknown): string | null {
  const spec = pvc.spec as PvcSpec | undefined;
  if ((pvc.status as { phase?: string } | undefined)?.phase !== 'Bound') return 'Only a Bound claim can be expanded';
  if (!spec?.storageClassName) return 'The claim names no StorageClass, so its expansion support is unknown';
  if (scError) return `StorageClass "${spec.storageClassName}" could not be read`;
  if (!sc) return 'Checking the StorageClass…';
  if ((sc as { allowVolumeExpansion?: boolean }).allowVolumeExpansion !== true) {
    return `StorageClass "${spec.storageClassName}" does not allow volume expansion (allowVolumeExpansion is not true)`;
  }
  return null;
}

function PvcSection({ pvc, go }: { pvc: K8sResource; go: Go }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const ns = pvc.metadata.namespace || '';
  const name = pvc.metadata.name;
  const spec = pvc.spec as PvcSpec | undefined;
  const scName = spec?.storageClassName;
  const current = spec?.resources?.requests?.storage ?? '';
  const { allowed: canPatch } = useCanI('patch', '', 'persistentvolumeclaims', ns);
  const { open, dialog } = useActionDialog();

  const sc = useQuery({
    queryKey: ['detail', 'pvc-storageclass', scName, clusterId],
    queryFn: () => k8sGet<K8sResource>(`/apis/storage.k8s.io/v1/storageclasses/${scName}`, clusterId),
    enabled: !!scName,
    retry: false,
  });
  const pods = useQuery({
    queryKey: ['detail', 'pvc-pods', ns, name, clusterId],
    queryFn: () => k8sList<Pod>(`/api/v1/namespaces/${ns}/pods`, undefined, clusterId),
    select: (list) => list.filter((p) => ((p.spec as { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } | undefined)?.volumes ?? [])
      .some((v) => v.persistentVolumeClaim?.claimName === name)),
    enabled: !!ns,
  });

  const blocker = pvcExpandBlocker(pvc, sc.data, sc.error);
  const reason = !canPatch ? 'You do not have permission to change this claim' : blocker;

  const expand = () => open({
    title: `Expand PVC "${name}"`,
    description: `Request more storage for ${name} in ${ns} (now ${current}). Volumes can only grow: the new size must be larger, and it cannot be shrunk back. Some drivers finish the resize only when a pod next mounts the volume.`,
    confirmLabel: 'Expand',
    inputs: [{
      id: 'size', label: 'New size', initial: current, placeholder: 'e.g. 20Gi',
      validate: (v) => {
        const next = quantityToBytes(v.trim());
        if (Number.isNaN(next)) return 'Use a Kubernetes quantity such as 20Gi or 500Mi';
        if (!(next > quantityToBytes(current))) return `Must be larger than the current ${current}`;
        return null;
      },
    }],
    run: (cid, v) => sendWrite(expandPvc(pvc, v.size.trim()), cid),
    success: (v) => `PVC "${name}" expansion to ${v.size.trim()} requested`,
  });

  return (
    <DetailSection
      title="Storage"
      actions={(
        <Button size="sm" variant="secondary" onClick={expand} disabled={!!reason} title={reason ?? undefined}>
          <Maximize2 className="w-3.5 h-3.5" /> Expand
        </Button>
      )}
    >
      <dl className="grid grid-cols-2 gap-2 text-xs mb-3">
        <dt className="text-slate-500">Requested</dt><dd className="text-slate-200 font-mono">{current || '—'}</dd>
        <dt className="text-slate-500">StorageClass</dt>
        <dd>{scName ? <button className="text-blue-400 hover:text-blue-300" onClick={() => go(`/r/storage.k8s.io~v1~storageclasses/_/${scName}`, scName)}>{scName}</button> : <span className="text-slate-500">none</span>}</dd>
        {spec?.volumeName && (<>
          <dt className="text-slate-500">Volume</dt>
          <dd><button className="text-blue-400 hover:text-blue-300" onClick={() => go(`/r/v1~persistentvolumes/_/${spec.volumeName}`, spec.volumeName!)}>{spec.volumeName}</button></dd>
        </>)}
      </dl>
      {blocker && canPatch && blocker !== 'Checking the StorageClass…' && <p className="text-xs text-slate-500 mb-3">Expand unavailable: {blocker}.</p>}
      <h3 className="text-xs font-semibold text-slate-300 mb-1.5">Used by</h3>
      {pods.isError ? (
        <LoadError title="Pods could not be listed" error={pods.error} onRetry={() => pods.refetch()} />
      ) : pods.isLoading ? (
        <p className="text-xs text-slate-500">Loading pods…</p>
      ) : (pods.data ?? []).length === 0 ? (
        <p className="text-xs text-slate-500">No pod in {ns} mounts this claim.</p>
      ) : (
        <ul className="space-y-1">
          {pods.data!.map((p) => (
            <li key={p.metadata.uid ?? p.metadata.name}>
              <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => go(`/r/v1~pods/${ns}/${p.metadata.name}`, p.metadata.name)}>
                {p.metadata.name}
              </button>
              <span className="ml-2 text-xs text-slate-500">{p.status?.phase}{p.spec?.nodeName ? ` · ${p.spec.nodeName}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </DetailSection>
  );
}

// ── HPA ─────────────────────────────────────────────

function HpaSection({ hpa }: { hpa: K8sResource }) {
  const ns = hpa.metadata.namespace || '';
  const spec = hpa.spec as { minReplicas?: number; maxReplicas?: number; scaleTargetRef?: { kind?: string; name?: string } } | undefined;
  const min = spec?.minReplicas ?? 1;
  const max = spec?.maxReplicas ?? 1;
  const { allowed: canPatch } = useCanI('patch', 'autoscaling', 'horizontalpodautoscalers', ns);
  const { open, dialog } = useActionDialog();
  const whole = (v: string) => (/^\d+$/.test(v.trim()) ? null : 'Enter a whole number');

  const edit = () => open({
    title: `Edit replica bounds of "${hpa.metadata.name}"`,
    description: `The autoscaler keeps ${spec?.scaleTargetRef?.kind ?? 'its target'} "${spec?.scaleTargetRef?.name ?? ''}" between these replica counts. Lowering the maximum below the current count scales it down right away.`,
    confirmLabel: 'Save',
    inputs: [
      { id: 'min', label: 'Minimum replicas', initial: String(min), type: 'number', min: 1, validate: (v) => whole(v) ?? (Number(v) < 1 ? 'Minimum is at least 1' : null) },
      { id: 'max', label: 'Maximum replicas', initial: String(max), type: 'number', min: 1, validate: (v, all) => whole(v) ?? (Number(v) < Number(all.min) ? 'Maximum must be at least the minimum' : null) },
    ],
    run: (cid, v) => sendWrite(setHpaBounds(hpa, Number(v.min), Number(v.max)), cid),
    success: (v) => `Replica bounds set to ${v.min}–${v.max}`,
  });

  return (
    <DetailSection
      title="Scaling bounds"
      actions={(
        <Button size="sm" variant="secondary" onClick={edit} disabled={!canPatch} title={canPatch ? undefined : 'You do not have permission to change this autoscaler'}>
          <SlidersHorizontal className="w-3.5 h-3.5" /> Edit min/max
        </Button>
      )}
    >
      <p className="text-sm text-slate-200">{min}–{max} replicas</p>
      {dialog}
    </DetailSection>
  );
}

// ── Service endpoints ───────────────────────────────

interface EndpointAddress { ip: string; nodeName?: string; targetRef?: { kind?: string; name?: string; namespace?: string } }
interface EndpointSubset { addresses?: EndpointAddress[]; notReadyAddresses?: EndpointAddress[]; ports?: Array<{ name?: string; port: number; protocol?: string }> }

function ServiceEndpointsSection({ svc, go }: { svc: K8sResource; go: Go }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const ns = svc.metadata.namespace || '';
  const spec = svc.spec as { selector?: Record<string, string>; type?: string } | undefined;
  const ep = useQuery({
    queryKey: ['detail', 'service-endpoints', ns, svc.metadata.name, clusterId],
    queryFn: async () => {
      try {
        return await k8sGet<{ subsets?: EndpointSubset[] }>(`/api/v1/namespaces/${ns}/endpoints/${svc.metadata.name}`, clusterId);
      } catch (err) {
        if (err instanceof PulseError && err.statusCode === 404) return null;
        throw err;
      }
    },
    refetchInterval: 30_000,
  });

  if (spec?.type === 'ExternalName') return null;
  const subsets = ep.data?.subsets ?? [];
  const ready = subsets.flatMap((s) => (s.addresses ?? []).map((a) => ({ a, ports: s.ports ?? [] })));
  const notReady = subsets.flatMap((s) => s.notReadyAddresses ?? []);
  const noSelector = !spec?.selector || Object.keys(spec.selector).length === 0;

  const addr = (a: EndpointAddress) => (
    a.targetRef?.kind === 'Pod' && a.targetRef.name
      ? <button className="text-blue-400 hover:text-blue-300" onClick={() => go(`/r/v1~pods/${a.targetRef!.namespace || ns}/${a.targetRef!.name}`, a.targetRef!.name!)}>{a.targetRef.name}</button>
      : <span className="text-slate-300">{a.targetRef?.name ?? '—'}</span>
  );

  return (
    <DetailSection title={`Endpoints (${ready.length} ready${notReady.length ? `, ${notReady.length} not ready` : ''})`}>
      {ep.isError ? (
        <LoadError title="Endpoints could not be loaded" error={ep.error} onRetry={() => ep.refetch()} />
      ) : ep.isLoading ? (
        <p className="text-xs text-slate-500">Loading endpoints…</p>
      ) : ready.length === 0 && notReady.length === 0 ? (
        <p className="text-xs text-amber-300">
          {noSelector
            ? 'No endpoints. This Service has no selector, so its endpoints must be managed by hand or by another controller.'
            : 'No ready endpoints: no running, ready pod matches this Service\'s selector, so traffic to it fails.'}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th className="py-1 font-normal">Address</th><th className="font-normal">Target</th><th className="font-normal">Node</th><th className="font-normal">Ready</th></tr></thead>
          <tbody>
            {ready.map(({ a, ports }) => (
              <tr key={`r-${a.ip}`} className="border-t border-slate-800">
                <td className="py-1 font-mono text-slate-200">{a.ip}{ports.length ? `:${ports.map((p) => p.port).join(',')}` : ''}</td>
                <td>{addr(a)}</td><td className="text-slate-400">{a.nodeName ?? '—'}</td><td className="text-emerald-400">Yes</td>
              </tr>
            ))}
            {notReady.map((a) => (
              <tr key={`n-${a.ip}`} className="border-t border-slate-800">
                <td className="py-1 font-mono text-slate-200">{a.ip}</td>
                <td>{addr(a)}</td><td className="text-slate-400">{a.nodeName ?? '—'}</td><td className="text-amber-400">No</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DetailSection>
  );
}

// ── StorageClass ────────────────────────────────────

export function useSetDefaultStorageClass() {
  const { allowed: canPatch } = useCanI('patch', 'storage.k8s.io', 'storageclasses');
  const { open, dialog } = useActionDialog();
  const setDefault = (target: K8sResource) => open({
    title: `Make "${target.metadata.name}" the default StorageClass?`,
    description: 'Claims that name no StorageClass will be provisioned from this class. It is marked default first, then the default annotation (GA and beta) is removed from every other class, so it is the only default. (While more than one class is default, the newest default is used.)',
    confirmLabel: 'Set as default',
    run: async (cid) => {
      // Read the current classes on the pinned cluster, not a possibly stale list.
      const all = await k8sList<K8sResource>('/apis/storage.k8s.io/v1/storageclasses', undefined, cid);
      const reqs = setDefaultStorageClass(target, all);
      const done: string[] = [];
      for (const req of reqs) {
        const name = req.path.split('/').pop()!;
        try {
          await sendWrite(req, cid);
          done.push(name);
        } catch (err) {
          // Say exactly what did and did not change.
          const what = name === target.metadata.name
            ? 'Nothing was changed'
            : `"${target.metadata.name}" is now a default; cleared the default on ${done.slice(1).map((n) => `"${n}"`).join(', ') || 'no other class'}. Still marked default: ${reqs.slice(done.length).map((r) => `"${r.path.split('/').pop()}"`).join(', ')}`;
          throw new Error(`${what}. Failed on "${name}": ${describeWriteError(err)}`);
        }
      }
    },
    success: `"${target.metadata.name}" is now the default StorageClass`,
  });
  return { canPatch, setDefault, dialog };
}

function StorageClassSection({ sc }: { sc: K8sResource }) {
  const { canPatch, setDefault, dialog } = useSetDefaultStorageClass();
  const isDefault = isDefaultStorageClass(sc);
  return (
    <DetailSection
      title="Default class"
      actions={!isDefault && (
        <Button size="sm" variant="secondary" onClick={() => setDefault(sc)} disabled={!canPatch} title={canPatch ? undefined : 'You do not have permission to change StorageClasses'}>
          <Star className="w-3.5 h-3.5" /> Set as default
        </Button>
      )}
    >
      <p className="text-xs text-slate-300">{isDefault ? 'This is the default StorageClass.' : 'Not the default StorageClass.'}</p>
      {dialog}
    </DetailSection>
  );
}
