/**
 * Deploy an app (DeployApp mock): one form with optional sections — Source
 * (image, or Git through BuildConfig + ImageStream when the cluster serves
 * OpenShift builds), Config (ConfigMap/Secret references by name), Storage,
 * Health checks, Resources with the namespace's quota headroom, and Expose
 * (Service + Route). Nothing is created until the dry run (DeployDryRun) has
 * passed and the user confirms.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { dump } from 'js-yaml';
import { Box, FileCode, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useDiscovery } from '../../hooks/useDiscovery';
import { useCanI } from '../../hooks/useCanI';
import { k8sFetch } from '../../engine/query';
import { errorReason } from '../../engine/readResult';
import { askPulse } from '../../engine/askPulse';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { formatBytes } from '../../engine/format';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import {
  effectiveForm, emptyForm, planObjects, quotaHeadroom, quotaVerdict, referencedConfig, replicasOf, validateForm,
  type DeployForm, type EnvEntry, type LimitRange, type ProbeKind, type Quota, type QuotaLine,
} from '../../engine/deployApp';
import { METADATA_LIST } from './deployRunner';
import { NamespacePicker } from './NamespacePicker';
import { FormField } from './FormField';
import { DeployDryRunDialog } from './DeployDryRunDialog';

const inputCls = 'mt-1 w-full rounded-sm border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500';

function Section({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{n} · {title}</h3>
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      {children}
    </Card>
  );
}

type NameList = { names: string[]; error?: string; loading: boolean };

/** Names of objects in the namespace, as metadata only (Secret values never reach the browser). */
function useNames(clusterId: string, path: string | null): NameList {
  const q = useQuery({
    queryKey: ['deploy-app', 'names', clusterId, path],
    enabled: !!path,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await k8sFetch(clusterId, path!, { headers: { Accept: METADATA_LIST } });
      if (!res.ok) throw new Error(errorReason({ status: res.status }));
      return (((await res.json()).items ?? []) as Array<{ metadata: { name: string } }>).map((i) => i.metadata.name).sort();
    },
  });
  return { names: q.data ?? [], error: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : undefined, loading: q.isLoading && !!path };
}

interface StorageClass { metadata: { name: string; annotations?: Record<string, string> }; volumeBindingMode?: string }

function useStorageClasses(clusterId: string) {
  return useQuery({
    queryKey: ['deploy-app', 'storageclasses', clusterId],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await k8sFetch(clusterId, '/apis/storage.k8s.io/v1/storageclasses');
      if (!res.ok) throw new Error(errorReason({ status: res.status }));
      return ((await res.json()).items ?? []) as StorageClass[];
    },
  });
}

const isDefaultClass = (sc: StorageClass) => sc.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';

function useLimitRanges(clusterId: string, ns: string) {
  return useQuery({
    queryKey: ['deploy-app', 'limitranges', clusterId, ns],
    enabled: !!ns,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await k8sFetch(clusterId, `/api/v1/namespaces/${ns}/limitranges`);
      if (!res.ok) throw new Error(errorReason({ status: res.status }));
      return ((await res.json()).items ?? []) as LimitRange[];
    },
  });
}

function useQuotas(clusterId: string, ns: string) {
  return useQuery({
    queryKey: ['deploy-app', 'quotas', clusterId, ns],
    enabled: !!ns,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await k8sFetch(clusterId, `/api/v1/namespaces/${ns}/resourcequotas`);
      if (!res.ok) throw new Error(res.status === 403 ? `you can't read ResourceQuota in ${ns}` : errorReason({ status: res.status }));
      return ((await res.json()).items ?? []) as Quota[];
    },
  });
}

function fmtQuota(resource: string, v: number): string {
  if (/memory|storage/.test(resource)) return formatBytes(v);
  if (/cpu/.test(resource)) return v < 1 ? `${Math.round(v * 1000)}m` : `${Number(v.toFixed(2))}`;
  return String(Math.round(v));
}

export function QuotaPanel({ ns, lines, error, loading }: { ns: string; lines: QuotaLine[] | undefined; error?: string; loading: boolean }) {
  if (!ns) return null;
  if (loading) return <p className="text-xs text-slate-500">Checking quota in {ns}…</p>;
  if (error) return <p className="text-xs text-amber-300" data-testid="quota-headroom">Quota: Could not check — {error}.</p>;
  if (!lines || lines.length === 0) return <p className="text-xs text-slate-500" data-testid="quota-headroom">No ResourceQuota in {ns} limits this app.</p>;
  const { over, tight, unset, unknown } = quotaVerdict(lines);
  return (
    <div className="space-y-1 text-xs" data-testid="quota-headroom">
      <div className="text-slate-400">Quota headroom in {ns} · {[...new Set(lines.map((l) => l.quota))].join(', ')}</div>
      <ul className="grid grid-cols-1 gap-1 md:grid-cols-3">
        {lines.map((l) => (
          <li key={`${l.quota}/${l.resource}`} className={cn('rounded-sm border px-2 py-1', l.after > l.hard ? 'border-red-800 text-red-300' : l.duringRollout > l.hard ? 'border-amber-800 text-amber-300' : 'border-slate-800 text-slate-300')}>
            <span className="text-slate-500">{l.resource}</span> {fmtQuota(l.resource, l.after)} of {fmtQuota(l.resource, l.hard)} after deploy
          </li>
        ))}
      </ul>
      {unknown.length > 0 && <p className="text-amber-300">Not counted: {[...new Set(unknown.map((l) => `${l.quota} (${l.scopeUnknown})`))].join(', ')}.</p>}
      {unset.length > 0 && <p className="text-red-300">The quota limits {unset.map((l) => l.resource).join(', ')}, so every pod must set it: fill in Resources or the pods are rejected.</p>}
      {over.length > 0 && <p className="text-red-300">Over quota: {over.map((l) => l.resource).join(', ')}. The pods beyond the quota will not be created.</p>}
      {!over.length && tight.length > 0 && <p className="text-amber-300">Fits, but the next rollout (one extra pod) would exceed {tight.map((l) => l.resource).join(', ')}.</p>}
    </div>
  );
}

const PROBES: ProbeKind[] = ['startup', 'readiness', 'liveness'];

export function formContextText(f: DeployForm): string {
  return dump({ name: f.name, namespace: f.namespace, objects: planObjects(f).map((o) => ({ kind: o.kind, name: o.name, summary: o.summary })) }, { lineWidth: -1 });
}

export function QuickDeployTab() {
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const clusterId = useActiveClusterId();
  const clusterName = useFleetStore((s) => s.clusters.find((c) => c.id === s.activeClusterId)?.name ?? s.activeClusterId);
  const [form, setForm] = React.useState<DeployForm>(() => emptyForm(selectedNamespace !== '*' ? selectedNamespace : ''));
  const [showYaml, setShowYaml] = React.useState(false);
  const [dryRunOpen, setDryRunOpen] = React.useState<{ clusterId: string; form: DeployForm } | null>(null);
  const [question, setQuestion] = React.useState('');
  const set = <K extends keyof DeployForm>(k: K, v: DeployForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const ns = form.namespace;

  const { resourceRegistry, isLoading: discovering, error: discoveryError } = useDiscovery();
  const served = (group: string, plural: string) => !!resourceRegistry && [...resourceRegistry.values()].some((t) => t.group === group && t.plural === plural);
  const builds = served('build.openshift.io', 'buildconfigs') && served('image.openshift.io', 'imagestreams');
  const routes = served('route.openshift.io', 'routes');
  const capsUnknown = !resourceRegistry && (discovering || !!discoveryError);
  const gitUnavailable = capsUnknown
    ? (discoveryError ? 'Could not check whether this cluster serves OpenShift builds' : 'Checking whether this cluster serves OpenShift builds…')
    : !builds ? 'This cluster does not serve build.openshift.io, so Git builds are not available here' : undefined;
  const routeUnavailable = capsUnknown ? 'Checking whether this cluster serves Routes…' : !routes ? 'This cluster does not serve route.openshift.io, so no Route can be created' : undefined;

  const pullSecrets = useNames(clusterId, ns ? `/api/v1/namespaces/${ns}/secrets?fieldSelector=${encodeURIComponent('type=kubernetes.io/dockerconfigjson')}` : null);
  const configMaps = useNames(clusterId, ns ? `/api/v1/namespaces/${ns}/configmaps` : null);
  const secrets = useNames(clusterId, ns ? `/api/v1/namespaces/${ns}/secrets` : null);
  const pvcs = useNames(clusterId, ns && form.storage.mode === 'existing' ? `/api/v1/namespaces/${ns}/persistentvolumeclaims` : null);
  const builders = useNames(clusterId, form.source.type === 'git' ? '/apis/image.openshift.io/v1/namespaces/openshift/imagestreams' : null);
  const scs = useStorageClasses(clusterId);
  const quotas = useQuotas(clusterId, ns);
  const limitRanges = useLimitRanges(clusterId, ns);
  const canCreate = useCanI('create', 'apps', 'deployments', ns || undefined, undefined, { enabled: !!ns });

  const applied = effectiveForm(form, { routes });
  const errors = validateForm(applied, { routes, builds });
  const plan = errors.length === 0 ? planObjects(applied) : [];
  const quotaLines = quotas.data ? quotaHeadroom(applied, quotas.data, limitRanges.data ?? []) : undefined;
  const refs = referencedConfig(applied);
  const remote = clusterId !== LOCAL_CLUSTER_ID;
  const denied = ns && !canCreate.isLoading && !canCreate.allowed ? `You do not have permission to create Deployments in ${ns}` : undefined;

  const setEnv = (i: number, e: EnvEntry) => set('env', form.env.map((x, j) => (j === i ? e : x)));
  const setProbe = (k: ProbeKind, patch: Partial<DeployForm['probes'][ProbeKind]>) => set('probes', { ...form.probes, [k]: { ...form.probes[k], ...patch } });

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || remote) return;
    askPulse(`${question.trim()}\n\nThe "Deploy an app" form so far (on cluster ${clusterName}):\n${formContextText(form)}${quotaLines?.length ? `\nQuota after deploy: ${quotaLines.map((l) => `${l.resource} ${fmtQuota(l.resource, l.after)}/${fmtQuota(l.resource, l.hard)}`).join(', ')}` : ''}`, ns ? { kind: 'Namespace', name: ns } : undefined);
    setQuestion('');
  };

  return (
    <div className="space-y-4" data-testid="deploy-app">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100"><Box className="h-4 w-4 text-blue-400" /> Deploy an app</h2>
        <p className="text-xs text-slate-400">Fill what you need; every section below Source is optional. Nothing is created until you review the dry run.</p>
      </div>

      <Section n={1} title="Source" hint="required">
        <fieldset className="space-y-1 text-xs text-slate-300">
          <legend className="sr-only">Source type</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name="source" checked={form.source.type === 'image'} onChange={() => set('source', { type: 'image', image: '', pullSecret: '' })} /> Container image</label>
          <label className={cn('flex items-center gap-1.5', gitUnavailable && 'opacity-50')}>
            <input type="radio" name="source" checked={form.source.type === 'git'} disabled={!!gitUnavailable} onChange={() => set('source', { type: 'git', gitUrl: '', gitRef: '', contextDir: '', builderImage: '' })} />
            Git repository (build with BuildConfig, redeploy on new image)
          </label>
          {gitUnavailable && <p className="pl-5 text-slate-500" data-testid="git-unavailable">{gitUnavailable}.</p>}
        </fieldset>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {form.source.type === 'image' ? (
            <>
              <FormField label="Image" required mono value={form.source.image} onChange={(v) => set('source', { ...form.source as Extract<DeployForm['source'], { type: 'image' }>, image: v })} placeholder="quay.io/org/api:1.2" />
              <label className="block text-xs text-slate-400">
                Pull secret
                <select aria-label="Pull secret" className={inputCls} value={form.source.pullSecret} onChange={(e) => set('source', { ...form.source as Extract<DeployForm['source'], { type: 'image' }>, pullSecret: e.target.value })}>
                  <option value="">None (public image, or linked to the default ServiceAccount)</option>
                  {pullSecrets.names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {pullSecrets.error && <span className="mt-1 block text-amber-300">Could not list pull secrets in {ns} ({pullSecrets.error}).</span>}
              </label>
            </>
          ) : (
            <>
              <FormField label="Git repository" required mono value={form.source.gitUrl} onChange={(v) => set('source', { ...form.source as Extract<DeployForm['source'], { type: 'git' }>, gitUrl: v })} placeholder="https://github.com/org/api.git" />
              <FormField label="Branch or tag" mono value={form.source.gitRef} onChange={(v) => set('source', { ...form.source as Extract<DeployForm['source'], { type: 'git' }>, gitRef: v })} placeholder="main" />
              <FormField label="Context directory" mono value={form.source.contextDir} onChange={(v) => set('source', { ...form.source as Extract<DeployForm['source'], { type: 'git' }>, contextDir: v })} placeholder="/" />
              <div>
                <FormField label="Builder image" required mono list="builder-images" value={form.source.builderImage} onChange={(v) => set('source', { ...form.source as Extract<DeployForm['source'], { type: 'git' }>, builderImage: v })} placeholder="nodejs:20-ubi9" />
                <datalist id="builder-images">{builders.names.map((n) => <option key={n} value={`${n}:latest`} />)}</datalist>
                <span className="mt-1 block text-[11px] text-slate-500">An image stream tag in the openshift namespace.{builders.error ? ` Could not list them (${builders.error}); type one.` : ''}</span>
              </div>
            </>
          )}
          <FormField label="Name" required value={form.name} onChange={(v) => set('name', v)} placeholder="api" />
          <NamespacePicker value={form.namespace} onChange={(v) => set('namespace', v)} />
          <FormField label="Container port" value={form.port} onChange={(v) => set('port', v)} placeholder="8080" />
          <FormField label="Replicas" value={form.replicas} onChange={(v) => set('replicas', v)} placeholder="1" />
        </div>
      </Section>

      <Section n={2} title="Config" hint="optional · environment from ConfigMaps and Secrets">
        {form.env.length === 0 && <p className="text-xs text-slate-500">No environment set.</p>}
        <ul className="space-y-2">
          {form.env.map((e, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2 text-xs" data-testid={`env-${i}`}>
              {e.kind === 'value' ? (
                <>
                  <FormField label="Variable name" mono value={e.name} onChange={(v) => setEnv(i, { ...e, name: v })} placeholder="LOG_LEVEL" />
                  <FormField label="Value" mono value={e.value} onChange={(v) => setEnv(i, { ...e, value: v })} placeholder="info" />
                </>
              ) : (
                <>
                  <label className="block text-xs text-slate-400">
                    {e.kind.startsWith('configMap') ? 'ConfigMap' : 'Secret'}
                    <select aria-label={e.kind.startsWith('configMap') ? 'ConfigMap' : 'Secret'} className={inputCls}
                      value={e.kind.startsWith('configMap') ? (e as { configMap: string }).configMap : (e as { secret: string }).secret}
                      onChange={(ev) => setEnv(i, e.kind.startsWith('configMap') ? { ...(e as Extract<EnvEntry, { configMap: string }>), configMap: ev.target.value } : { ...(e as Extract<EnvEntry, { secret: string }>), secret: ev.target.value })}>
                      <option value="">Choose…</option>
                      {(e.kind.startsWith('configMap') ? configMaps : secrets).names.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-400">
                    Use
                    <select aria-label="Use" className={inputCls} value={e.kind.endsWith('All') ? 'all' : 'key'} onChange={(ev) => {
                      const isCm = e.kind.startsWith('configMap');
                      const ref = isCm ? (e as { configMap: string }).configMap : (e as { secret: string }).secret;
                      setEnv(i, ev.target.value === 'all'
                        ? (isCm ? { kind: 'configMapAll', configMap: ref } : { kind: 'secretAll', secret: ref })
                        : (isCm ? { kind: 'configMapKey', configMap: ref, key: '', name: '' } : { kind: 'secretKey', secret: ref, key: '', name: '' }));
                    }}>
                      <option value="all">All keys as variables</option>
                      <option value="key">One key as a variable</option>
                    </select>
                  </label>
                  {(e.kind === 'configMapKey' || e.kind === 'secretKey') && (
                    <>
                      <FormField label="Key" mono value={e.key} onChange={(v) => setEnv(i, { ...e, key: v })} placeholder="password" />
                      <FormField label="Variable name" mono value={e.name} onChange={(v) => setEnv(i, { ...e, name: v })} placeholder="DB_PASSWORD" />
                    </>
                  )}
                  {e.kind.startsWith('secret') && <span className="pb-2 text-slate-500">value hidden</span>}
                </>
              )}
              <Button size="sm" variant="ghost" aria-label={`Remove environment entry ${i + 1}`} onClick={() => set('env', form.env.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
            </li>
          ))}
        </ul>
        {(configMaps.error || secrets.error) && ns && <p className="text-xs text-amber-300">Could not list {[configMaps.error && 'ConfigMaps', secrets.error && 'Secrets'].filter(Boolean).join(' or ')} in {ns}; the dry run checks the names you use.</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => set('env', [...form.env, { kind: 'configMapAll', configMap: '' }])}><Plus className="h-3 w-3" /> Add from ConfigMap</Button>
          <Button size="sm" variant="secondary" onClick={() => set('env', [...form.env, { kind: 'secretAll', secret: '' }])}><Plus className="h-3 w-3" /> Add from Secret</Button>
          <Button size="sm" variant="secondary" onClick={() => set('env', [...form.env, { kind: 'value', name: '', value: '' }])}><Plus className="h-3 w-3" /> Add variable</Button>
        </div>
        <p className="text-[11px] text-slate-500">Secrets are referenced by name only; Pulse reads their names, never their values.</p>
      </Section>

      <Section n={3} title="Storage" hint="optional">
        <fieldset className="flex flex-wrap gap-4 text-xs text-slate-300">
          <legend className="sr-only">Volume</legend>
          {(['none', 'new', 'existing'] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" name="storage" checked={form.storage.mode === m} onChange={() => set('storage', { ...form.storage, mode: m })} />
              {m === 'none' ? 'No volume' : m === 'new' ? 'New PVC' : 'Existing PVC'}
            </label>
          ))}
        </fieldset>
        {form.storage.mode !== 'none' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {form.storage.mode === 'new' ? (
              <>
                <FormField label="Claim name" mono value={form.storage.claimName} onChange={(v) => set('storage', { ...form.storage, claimName: v })} placeholder={`data-${form.name || 'app'}`} />
                <FormField label="Size" value={form.storage.size} onChange={(v) => set('storage', { ...form.storage, size: v })} placeholder="10Gi" />
                <label className="block text-xs text-slate-400">
                  Storage class
                  <select aria-label="Storage class" className={inputCls} value={form.storage.storageClass} onChange={(e) => set('storage', { ...form.storage, storageClass: e.target.value })}>
                    <option value="">Cluster default</option>
                    {(scs.data ?? []).map((sc) => <option key={sc.metadata.name} value={sc.metadata.name}>{sc.metadata.name}{isDefaultClass(sc) ? ' (default)' : ''}</option>)}
                  </select>
                  {scs.error && <span className="mt-1 block text-amber-300">Could not list storage classes.</span>}
                </label>
                <label className="block text-xs text-slate-400">
                  Access mode
                  <select aria-label="Access mode" className={inputCls} value={form.storage.accessMode} onChange={(e) => set('storage', { ...form.storage, accessMode: e.target.value as DeployForm['storage']['accessMode'] })}>
                    <option value="ReadWriteOnce">ReadWriteOnce (one node)</option>
                    <option value="ReadWriteMany">ReadWriteMany (shared)</option>
                  </select>
                </label>
              </>
            ) : (
              <label className="block text-xs text-slate-400">
                PersistentVolumeClaim
                <select aria-label="PersistentVolumeClaim" className={inputCls} value={form.storage.claimName} onChange={(e) => set('storage', { ...form.storage, claimName: e.target.value })}>
                  <option value="">Choose…</option>
                  {pvcs.names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {pvcs.error && <span className="mt-1 block text-amber-300">Could not list PVCs in {ns} ({pvcs.error}).</span>}
              </label>
            )}
            <FormField label="Mount path" mono value={form.storage.mountPath} onChange={(v) => set('storage', { ...form.storage, mountPath: v })} placeholder="/data" />
          </div>
        )}
        {form.storage.mode !== 'none' && form.storage.accessMode === 'ReadWriteOnce' && replicasOf(form) > 1 && (
          <p className="text-xs text-amber-300">ReadWriteOnce with {replicasOf(form)} replicas: all pods must run on one node. Pick a ReadWriteMany class or use 1 replica.</p>
        )}
      </Section>

      <Section n={4} title="Health checks" hint="optional · recommended">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th className="py-1 font-normal">Probe</th><th className="font-normal">Check</th><th className="font-normal">Timing</th></tr></thead>
          <tbody>
            {PROBES.map((k) => {
              const p = form.probes[k];
              return (
                <tr key={k} className="border-t border-slate-800 align-top" data-testid={`probe-${k}`}>
                  <td className="py-2 pr-2">
                    <label className="flex items-center gap-1.5 text-slate-200 capitalize"><input type="checkbox" checked={p.enabled} onChange={(e) => setProbe(k, { enabled: e.target.checked })} aria-label={`${k} probe`} /> {k}</label>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <select aria-label={`${k} probe type`} value={p.type} disabled={!p.enabled} onChange={(e) => setProbe(k, { type: e.target.value as 'http' | 'tcp' })} className="rounded-sm border border-slate-700 bg-slate-900 px-1 py-1 text-slate-200">
                        <option value="http">HTTP GET</option><option value="tcp">TCP</option>
                      </select>
                      {p.type === 'http' && <input aria-label={`${k} probe path`} value={p.path} disabled={!p.enabled} onChange={(e) => setProbe(k, { path: e.target.value })} className="w-28 rounded-sm border border-slate-700 bg-slate-900 px-1 py-1 font-mono text-slate-200" />}
                      <input aria-label={`${k} probe port`} value={p.port} disabled={!p.enabled} placeholder={form.port || 'port'} onChange={(e) => setProbe(k, { port: e.target.value })} className="w-16 rounded-sm border border-slate-700 bg-slate-900 px-1 py-1 font-mono text-slate-200" />
                    </div>
                  </td>
                  <td className="py-2 text-slate-400">
                    every <input aria-label={`${k} probe period`} value={p.periodSeconds} disabled={!p.enabled} onChange={(e) => setProbe(k, { periodSeconds: e.target.value })} className="w-10 rounded-sm border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200" />s ·
                    timeout <input aria-label={`${k} probe timeout`} value={p.timeoutSeconds} disabled={!p.enabled} onChange={(e) => setProbe(k, { timeoutSeconds: e.target.value })} className="w-10 rounded-sm border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200" />s ·
                    <input aria-label={`${k} probe failures`} value={p.failureThreshold} disabled={!p.enabled} onChange={(e) => setProbe(k, { failureThreshold: e.target.value })} className="ml-1 w-10 rounded-sm border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200" /> failures
                    {k === 'startup' && p.enabled && <span className="ml-1 text-slate-500">({(Number(p.periodSeconds) || 0) * (Number(p.failureThreshold) || 0)}s to start)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section n={5} title="Resources" hint="optional · per pod">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FormField label="CPU request" value={form.resources.cpuRequest} onChange={(v) => set('resources', { ...form.resources, cpuRequest: v })} placeholder="250m" />
          <FormField label="CPU limit" value={form.resources.cpuLimit} onChange={(v) => set('resources', { ...form.resources, cpuLimit: v })} placeholder="1" />
          <FormField label="Memory request" value={form.resources.memRequest} onChange={(v) => set('resources', { ...form.resources, memRequest: v })} placeholder="256Mi" />
          <FormField label="Memory limit" value={form.resources.memLimit} onChange={(v) => set('resources', { ...form.resources, memLimit: v })} placeholder="512Mi" />
        </div>
        {limitRanges.error && ns && <p className="text-xs text-amber-300">LimitRange defaults in {ns} could not be read, so the headroom below uses only what you set.</p>}
        <QuotaPanel ns={ns} lines={quotaLines} loading={quotas.isLoading && !!ns} error={quotas.error ? (quotas.error instanceof Error ? quotas.error.message : String(quotas.error)) : undefined} />
      </Section>

      <Section n={6} title="Expose" hint="optional · Service, Route and TLS">
        <div className="flex flex-wrap gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.expose.service} onChange={(e) => set('expose', { ...form.expose, service: e.target.checked, route: e.target.checked && form.expose.route })} /> Service on port {form.port || '(set the container port)'}</label>
          <label className={cn('flex items-center gap-1.5', routeUnavailable && 'opacity-50')}>
            <input type="checkbox" checked={form.expose.route && !routeUnavailable} disabled={!!routeUnavailable || !form.expose.service} onChange={(e) => set('expose', { ...form.expose, route: e.target.checked })} /> Public Route
          </label>
        </div>
        {routeUnavailable && <p className="text-xs text-slate-500">{routeUnavailable}.</p>}
        {form.expose.route && !routeUnavailable && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Hostname" mono value={form.expose.hostname} onChange={(v) => set('expose', { ...form.expose, hostname: v })} placeholder="generated from the name and namespace" />
            <label className="block text-xs text-slate-400">
              TLS
              <select aria-label="TLS" className={inputCls} value={form.expose.tls} onChange={(e) => set('expose', { ...form.expose, tls: e.target.value as DeployForm['expose']['tls'] })}>
                <option value="edge">Edge, redirect HTTP (cluster wildcard certificate)</option>
                <option value="reencrypt">Re-encrypt</option>
                <option value="passthrough">Passthrough</option>
                <option value="none">None (HTTP only)</option>
              </select>
            </label>
          </div>
        )}
        {replicasOf(form) > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-300"><input type="checkbox" checked={form.pdb} onChange={(e) => set('pdb', e.target.checked)} /> Add a PodDisruptionBudget (minAvailable 1), so a node drain keeps one pod running</label>
        )}
      </Section>

      <Card className="space-y-3 p-4" data-testid="deploy-review">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-100">{errors.length ? 'Not ready for a dry run' : 'Ready for a dry run'}</div>
            <div className="text-xs text-slate-500">The API server checks all {plan.length || ''} objects without creating anything. You confirm the object list next.</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowYaml(!showYaml)} disabled={plan.length === 0}><FileCode className="h-3.5 w-3.5" /> {showYaml ? 'Hide YAML' : 'View YAML'}</Button>
            <Button onClick={() => setDryRunOpen({ clusterId, form: applied })} disabled={errors.length > 0 || !!denied || (!!ns && canCreate.isLoading)} title={denied ?? (ns && canCreate.isLoading ? 'Checking your permissions…' : errors.length ? 'Fix the form first' : undefined)}>Dry run</Button>
          </div>
        </div>
        {denied && <p className="text-xs text-amber-300">{denied}.</p>}
        {errors.length > 0 && (form.name || form.source.type === 'git' || (form.source.type === 'image' && form.source.image)) && (
          <ul className="space-y-0.5 text-xs text-red-300" data-testid="form-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        {plan.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">What this creates</div>
            <ul className="space-y-0.5 text-xs" data-testid="deploy-plan">
              {plan.map((o) => <li key={o.kind} className="font-mono text-slate-300"><span className="text-emerald-400">+</span> {o.kind}/{o.name} <span className="font-sans text-slate-500">{o.summary}</span></li>)}
              {(refs.configMaps.length > 0 || refs.secrets.length > 0) && (
                <li className="text-slate-400"><span className="text-slate-500">=</span> Uses existing {[...refs.configMaps.map((n) => `ConfigMap ${n}`), ...refs.secrets.map((n) => `Secret ${n}`)].join(', ')}</li>
              )}
            </ul>
          </div>
        )}
        {showYaml && plan.length > 0 && <pre className="max-h-96 overflow-auto rounded-sm bg-slate-950 p-2 text-[11px] text-slate-300" aria-label="Planned YAML">{plan.map((o) => dump(o.body, { lineWidth: -1 })).join('---\n')}</pre>}
      </Card>

      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><MessageSquare className="h-4 w-4 text-violet-400" /> Ask Pulse about this deploy</h3>
        <p className="mt-1 text-xs text-slate-400" data-testid="deploy-ask-note">{remote ? 'Pulse AI answers about the local cluster only.' : 'The form, its objects and the namespace quota are attached as context; the answer opens in the Pulse AI panel.'}</p>
        <form onSubmit={ask} className="mt-2 flex gap-2">
          <label htmlFor="deploy-ask" className="sr-only">Question for Pulse</label>
          <input id="deploy-ask" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={remote}
            placeholder="Fill this in: deploy quay.io/acme/api:1.4 on 8080 with 2 replicas and expose it"
            className="min-h-[40px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500" />
          <button type="submit" disabled={remote || !question.trim()} className="rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50">Ask</button>
        </form>
      </Card>

      {discoveryError && !resourceRegistry && <LoadError title="The cluster's APIs could not be discovered, so Git builds and Routes are unavailable" error={discoveryError} />}

      {dryRunOpen && (
        <DeployDryRunDialog
          clusterId={dryRunOpen.clusterId}
          form={dryRunOpen.form}
          storageClassBinding={(scs.data ?? []).find((sc) => (dryRunOpen.form.storage.storageClass ? sc.metadata.name === dryRunOpen.form.storage.storageClass : isDefaultClass(sc)))?.volumeBindingMode}
          quotaLines={quotaLines}
          onClose={() => setDryRunOpen(null)}
          onEditHostname={(host) => { setForm((f) => ({ ...f, expose: { ...f.expose, hostname: host } })); setDryRunOpen(null); }}
        />
      )}
    </div>
  );
}
