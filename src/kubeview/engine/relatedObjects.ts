/**
 * The objects that exist for one workload and are left behind when only the
 * workload is deleted: the Services that select its pods and the Routes to
 * them, its HorizontalPodAutoscaler, PodDisruptionBudgets and
 * NetworkPolicies, the ConfigMaps and Secrets its pod template reads, and its
 * PersistentVolumeClaims.
 *
 * Found through label selectors (against the pod template's labels), the
 * HPA's scaleTargetRef, Route backends and pod template references. An object
 * another workload in the namespace also uses is kept and cannot be chosen;
 * when the other workloads could not all be read, sharing is unknown and the
 * object is not chosen by default. PVCs are never chosen by default.
 */
import type { K8sResource } from './renderers';
import { labelSelectorMatches } from './upgradeHealth';
import { podTemplateOf, referencedConfig, usagesIn } from './configConsumers';

export type RelatedKind = 'Service' | 'Route' | 'HorizontalPodAutoscaler' | 'PodDisruptionBudget' | 'NetworkPolicy' | 'ConfigMap' | 'Secret' | 'PersistentVolumeClaim';

export const RELATED_SOURCES: Record<RelatedKind, { group: string; plural: string; base: (ns: string) => string }> = {
  Service: { group: '', plural: 'services', base: (ns) => `/api/v1/namespaces/${ns}/services` },
  Route: { group: 'route.openshift.io', plural: 'routes', base: (ns) => `/apis/route.openshift.io/v1/namespaces/${ns}/routes` },
  HorizontalPodAutoscaler: { group: 'autoscaling', plural: 'horizontalpodautoscalers', base: (ns) => `/apis/autoscaling/v2/namespaces/${ns}/horizontalpodautoscalers` },
  PodDisruptionBudget: { group: 'policy', plural: 'poddisruptionbudgets', base: (ns) => `/apis/policy/v1/namespaces/${ns}/poddisruptionbudgets` },
  NetworkPolicy: { group: 'networking.k8s.io', plural: 'networkpolicies', base: (ns) => `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies` },
  ConfigMap: { group: '', plural: 'configmaps', base: (ns) => `/api/v1/namespaces/${ns}/configmaps` },
  Secret: { group: '', plural: 'secrets', base: (ns) => `/api/v1/namespaces/${ns}/secrets` },
  PersistentVolumeClaim: { group: '', plural: 'persistentvolumeclaims', base: (ns) => `/api/v1/namespaces/${ns}/persistentvolumeclaims` },
};

export const LISTED_KINDS = ['Service', 'Route', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'NetworkPolicy', 'PersistentVolumeClaim'] as const;
export type ListedKind = typeof LISTED_KINDS[number];

export const KIND_LABEL: Record<RelatedKind, string> = {
  Service: 'Services', Route: 'Routes', HorizontalPodAutoscaler: 'HorizontalPodAutoscalers', PodDisruptionBudget: 'PodDisruptionBudgets',
  NetworkPolicy: 'NetworkPolicies', ConfigMap: 'ConfigMaps', Secret: 'Secrets', PersistentVolumeClaim: 'PersistentVolumeClaims',
};

/** Created in every namespace by the cluster; never the workload's own. */
const CLUSTER_CONFIGMAPS = new Set(['kube-root-ca.crt', 'openshift-service-ca.crt']);

export interface RelatedCandidate {
  kind: RelatedKind;
  name: string;
  path: string;
  /** Chosen for deletion by default. */
  defaultChecked: boolean;
  /** Why it is kept and cannot be chosen; undefined when it can be. */
  keptReason?: string;
  note: string;
  /** Deleting it destroys data (PVCs). */
  dataLoss?: boolean;
  /** The object as read, when it was listed (for a saved copy; metadata only for ConfigMaps/Secrets). */
  resource?: K8sResource;
  /** Deleted by the workload's own controller (a StatefulSet's PVC retention policy), not by Pulse. */
  byController?: boolean;
}

export interface RelatedInputs {
  /** Every workload in the namespace that could be read (any kind). */
  workloads: K8sResource[];
  /** Workload kinds that could not be listed: sharing is unknown. */
  workloadsIncomplete: string[];
  /** Per listed kind: the items, or null when it could not be read. */
  lists: Partial<Record<ListedKind, K8sResource[] | null>>;
  /** PV reclaim policy by PV name: a policy, or null when the PV could not be read. */
  reclaimPolicies?: Record<string, string | null>;
  /**
   * ConfigMaps and Secrets in the namespace, metadata only (uid, labels,
   * ownerReferences; never data), or null when they could not be listed.
   */
  configMeta?: Partial<Record<'ConfigMap' | 'Secret', K8sResource[] | null>>;
  /** ServiceAccounts in the namespace (their pull secrets), or null when unreadable. */
  serviceAccounts?: K8sResource[] | null;
  /** The Helm release the workload belongs to, if any: objects of another release are kept. */
  helmRelease?: string;
}

export interface RelatedResult {
  candidates: RelatedCandidate[];
  /** Kinds Pulse could not check at all. */
  notChecked: RelatedKind[];
}

function templateLabels(w: K8sResource): Record<string, string> {
  return podTemplateOf(w)?.metadata?.labels ?? {};
}

function sameWorkload(a: K8sResource, b: K8sResource): boolean {
  return a.kind === b.kind && a.metadata.name === b.metadata.name;
}

function fmtRef(w: K8sResource): string { return `${w.kind} ${w.metadata.name}`; }

function sharingNote(others: K8sResource[], incomplete: string[], what: string): { keptReason?: string; unknown?: string } {
  if (others.length) return { keptReason: `Kept: also ${what} ${others.map(fmtRef).join(', ')}` };
  if (incomplete.length) return { unknown: `Could not check whether ${incomplete.join(', ')} also use it` };
  return {};
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Why an object belongs to something else and must be kept, or undefined. */
function ownedElsewhere(r: K8sResource | undefined, kind: RelatedKind, helmRelease: string | undefined): string | undefined {
  if (!r) return undefined;
  const refs = r.metadata.ownerReferences ?? [];
  const ctrl = refs.find((o) => o.controller);
  if (ctrl) return `Kept: managed by ${ctrl.kind} ${ctrl.name}`;
  // A ConfigMap/Secret with any owner is garbage-collected with that owner, or created by it.
  if ((kind === 'ConfigMap' || kind === 'Secret') && refs.length) return `Kept: owned by ${refs[0].kind} ${refs[0].name}`;
  const release = r.metadata.labels?.['app.kubernetes.io/managed-by'] === 'Helm' ? r.metadata.annotations?.['meta.helm.sh/release-name'] : undefined;
  if (release && release !== helmRelease) return `Kept: part of Helm release ${release}`;
  return undefined;
}

const OTHER_USERS = 'Deployment, StatefulSet, DaemonSet, DeploymentConfig, CronJob or Job';

function storageOf(pvc: K8sResource): string {
  const st = pvc.status as { capacity?: { storage?: string } } | undefined;
  const sp = pvc.spec as { resources?: { requests?: { storage?: string } } } | undefined;
  return st?.capacity?.storage ?? sp?.resources?.requests?.storage ?? 'unknown size';
}

export function computeRelated(workload: K8sResource, inputs: RelatedInputs): RelatedResult {
  const ns = workload.metadata.namespace || '';
  const labels = templateLabels(workload);
  const others = inputs.workloads.filter((w) => !sameWorkload(w, workload)
    // Jobs a CronJob created use its template; the CronJob stands for them.
    && !(w.kind === 'Job' && (w.metadata.ownerReferences ?? []).some((o) => o.kind === 'CronJob')));
  const incomplete = inputs.workloadsIncomplete;
  const out: RelatedCandidate[] = [];
  const notChecked: RelatedKind[] = [];
  const list = (k: ListedKind) => {
    const v = inputs.lists[k];
    if (v === null || v === undefined) { notChecked.push(k); return []; }
    return v;
  };
  const selectsWith = (sel: Parameters<typeof labelSelectorMatches>[0]) => others.filter((o) => labelSelectorMatches(sel, templateLabels(o)));

  // Services selecting its pods.
  const deletableServices = new Set<string>();
  const keptServices = new Set<string>();
  for (const svc of list('Service')) {
    const sel = (svc.spec as { selector?: Record<string, string> } | undefined)?.selector;
    if (!sel || Object.keys(sel).length === 0 || !labelSelectorMatches({ matchLabels: sel }, labels)) continue;
    const share = sharingNote(selectsWith({ matchLabels: sel }), incomplete, 'selects pods of');
    if (share.keptReason) keptServices.add(svc.metadata.name); else deletableServices.add(svc.metadata.name);
    out.push({
      kind: 'Service', name: svc.metadata.name, path: `${RELATED_SOURCES.Service.base(ns)}/${svc.metadata.name}`, resource: svc,
      defaultChecked: !share.keptReason && !share.unknown,
      keptReason: share.keptReason,
      note: share.unknown ?? `Selects only this ${workload.kind}'s pods`,
    });
  }

  // Routes whose backends are among those Services.
  for (const route of list('Route')) {
    const spec = route.spec as { host?: string; to?: { kind?: string; name?: string }; alternateBackends?: Array<{ kind?: string; name?: string }> } | undefined;
    const backends = [spec?.to, ...(spec?.alternateBackends ?? [])].filter((b): b is { kind?: string; name?: string } => !!b && (b.kind ?? 'Service') === 'Service' && !!b.name).map((b) => b.name!);
    if (!backends.some((b) => deletableServices.has(b) || keptServices.has(b))) continue;
    const kept = backends.filter((b) => !deletableServices.has(b));
    const host = spec?.host ? ` at ${spec.host}` : '';
    out.push({
      kind: 'Route', name: route.metadata.name, path: `${RELATED_SOURCES.Route.base(ns)}/${route.metadata.name}`, resource: route,
      defaultChecked: kept.length === 0 && out.find((c) => c.kind === 'Service' && backends.includes(c.name))?.defaultChecked !== false,
      keptReason: kept.length ? `Kept: also routes to Service ${kept.join(', ')}, which is kept` : undefined,
      note: `Routes traffic${host} to Service ${backends.join(', ')}`,
    });
  }

  // Its HorizontalPodAutoscaler.
  for (const hpa of list('HorizontalPodAutoscaler')) {
    const t = (hpa.spec as { scaleTargetRef?: { kind?: string; name?: string } } | undefined)?.scaleTargetRef;
    if (t?.kind !== workload.kind || t.name !== workload.metadata.name) continue;
    out.push({ kind: 'HorizontalPodAutoscaler', name: hpa.metadata.name, path: `${RELATED_SOURCES.HorizontalPodAutoscaler.base(ns)}/${hpa.metadata.name}`, resource: hpa, defaultChecked: true, note: `Targets only this ${workload.kind}` });
  }

  // PDBs and NetworkPolicies selecting its pods.
  for (const [kind, selOf] of [
    ['PodDisruptionBudget', (r: K8sResource) => (r.spec as { selector?: never } | undefined)?.selector],
    ['NetworkPolicy', (r: K8sResource) => (r.spec as { podSelector?: never } | undefined)?.podSelector],
  ] as const) {
    for (const r of list(kind)) {
      const sel = selOf(r) as Parameters<typeof labelSelectorMatches>[0];
      if (!labelSelectorMatches(sel, labels)) continue;
      const empty = !!sel && Object.keys((sel as { matchLabels?: object }).matchLabels ?? {}).length === 0 && ((sel as { matchExpressions?: unknown[] }).matchExpressions ?? []).length === 0;
      const share = empty ? { keptReason: `Kept: selects every pod in ${ns}` } : sharingNote(selectsWith(sel), incomplete, 'selects pods of');
      out.push({
        kind, name: r.metadata.name, path: `${RELATED_SOURCES[kind].base(ns)}/${r.metadata.name}`, resource: r,
        defaultChecked: !share.keptReason && !('unknown' in share && share.unknown),
        keptReason: share.keptReason,
        note: ('unknown' in share && share.unknown) || `Selects only this ${workload.kind}'s pods`,
      });
    }
  }

  // ConfigMaps and Secrets its pod template reads.
  const spec = podTemplateOf(workload)?.spec;
  const refs = referencedConfig(spec);
  const pullSecrets = new Set((spec?.imagePullSecrets ?? []).map((s) => s.name));
  for (const [kind, names] of [['ConfigMap', refs.configMaps], ['Secret', refs.secrets]] as const) {
    for (const name of names) {
      const path = `${RELATED_SOURCES[kind].base(ns)}/${name}`;
      if (kind === 'ConfigMap' && CLUSTER_CONFIGMAPS.has(name)) {
        out.push({ kind, name, path, defaultChecked: false, keptReason: `Kept: created by the cluster in every namespace`, note: '' });
        continue;
      }
      const users = others.filter((o) => usagesIn(podTemplateOf(o)?.spec, kind, name).length > 0);
      const share = sharingNote(users, incomplete, 'used by');
      const metaList = inputs.configMeta?.[kind];
      const meta = metaList?.find((m) => m.metadata.name === name);
      const sas = kind === 'Secret' && inputs.serviceAccounts
        ? inputs.serviceAccounts.filter((sa) => {
          const x = sa as unknown as { imagePullSecrets?: Array<{ name?: string }>; secrets?: Array<{ name?: string }> };
          return [...(x.imagePullSecrets ?? []), ...(x.secrets ?? [])].some((r) => r.name === name);
        }).map((sa) => sa.metadata.name)
        : [];
      const unknowns = [
        share.unknown,
        !metaList ? `Could not check what owns it (${KIND_LABEL[kind]} could not be listed)` : undefined,
        kind === 'Secret' && inputs.serviceAccounts === null ? 'Could not check whether a ServiceAccount lists it' : undefined,
      ].filter(Boolean);
      const kept = share.keptReason
        ?? (metaList && !meta ? `Not found in ${ns}` : undefined)
        ?? (sas.length ? `Kept: listed by ServiceAccount ${sas.join(', ')}` : undefined);
      const onlyPull = kind === 'Secret' && pullSecrets.has(name) && usagesIn(spec, 'Secret', name).every((u) => u.how === 'imagePullSecret');
      out.push({
        kind, name, path, resource: meta,
        // A Secret is never chosen by default: it may hold the only copy of a credential.
        defaultChecked: kind === 'ConfigMap' && !kept && unknowns.length === 0,
        keptReason: kept,
        note: unknowns.length
          ? unknowns.join('. ')
          : `No other ${OTHER_USERS} in ${ns} uses it${kind === 'Secret' ? ', and no ServiceAccount lists it' : ''}; other kinds not checked${kind === 'Secret' ? (onlyPull ? '. Image pull secret: not chosen by default' : '. Secrets are not chosen by default') : ''}`,
      });
    }
  }

  // PVCs: mounted by the template, or created from a StatefulSet's claim templates.
  const pvcs = list('PersistentVolumeClaim');
  const claimNames = new Set((spec?.volumes ?? []).map((v) => (v as { persistentVolumeClaim?: { claimName?: string } }).persistentVolumeClaim?.claimName).filter((n): n is string => !!n));
  const templateClaims = new Set<string>();
  const stsSpec = workload.spec as { volumeClaimTemplates?: Array<{ metadata?: { name?: string } }>; persistentVolumeClaimRetentionPolicy?: { whenDeleted?: string } } | undefined;
  // whenDeleted: Delete — the StatefulSet controller deletes its template claims itself.
  const retentionDeletes = workload.kind === 'StatefulSet' && stsSpec?.persistentVolumeClaimRetentionPolicy?.whenDeleted === 'Delete';
  if (workload.kind === 'StatefulSet') {
    const tmpls = (stsSpec?.volumeClaimTemplates ?? []).map((t) => t.metadata?.name).filter((t): t is string => !!t);
    for (const p of pvcs) {
      if (tmpls.some((t) => new RegExp(`^${escapeRegExp(t)}-${escapeRegExp(workload.metadata.name)}-\\d+$`).test(p.metadata.name))) {
        claimNames.add(p.metadata.name);
        templateClaims.add(p.metadata.name);
      }
    }
  }
  for (const name of [...claimNames].sort()) {
    const pvc = pvcs.find((p) => p.metadata.name === name);
    const users = others.filter((o) => (podTemplateOf(o)?.spec?.volumes ?? []).some((v) => (v as { persistentVolumeClaim?: { claimName?: string } }).persistentVolumeClaim?.claimName === name));
    const share = sharingNote(users, incomplete, 'mounted by');
    const volumeName = (pvc?.spec as { volumeName?: string } | undefined)?.volumeName;
    const policy = volumeName ? inputs.reclaimPolicies?.[volumeName] : undefined;
    const size = pvc ? storageOf(pvc) : 'unknown size';
    const loss = !pvc
      ? (inputs.lists.PersistentVolumeClaim ? 'The claim was not found.' : 'Its size and reclaim policy could not be checked.')
      : policy === 'Delete'
        ? `Deleting it destroys ${size} of data for good: the volume's reclaim policy is Delete.`
        : policy === 'Retain'
          ? `Deleting it releases ${size}: the reclaim policy is Retain, so the volume and its data stay, but must be reclaimed by hand.`
          : policy
            ? `${size}; the volume's reclaim policy is ${policy}.`
            : `Deleting it may destroy ${size} of data: the volume's reclaim policy could not be checked.`;
    if (retentionDeletes && templateClaims.has(name)) {
      out.push({
        kind: 'PersistentVolumeClaim', name, path: `${RELATED_SOURCES.PersistentVolumeClaim.base(ns)}/${name}`, resource: pvc,
        defaultChecked: true, dataLoss: true, byController: true,
        note: `Will be deleted by the StatefulSet's retention policy (persistentVolumeClaimRetentionPolicy.whenDeleted: Delete), whatever is chosen here. ${loss}`,
      });
      continue;
    }
    out.push({
      kind: 'PersistentVolumeClaim', name, path: `${RELATED_SOURCES.PersistentVolumeClaim.base(ns)}/${name}`, resource: pvc,
      defaultChecked: false, dataLoss: true,
      keptReason: share.keptReason,
      note: `Kept by default. ${share.unknown ? `${share.unknown}. ` : ''}${loss}`,
    });
  }

  // Objects managed by a controller, owned by something, or part of another Helm release are kept.
  for (const c of out) {
    if (c.keptReason || c.byController) continue;
    const why = ownedElsewhere(c.resource, c.kind, inputs.helmRelease);
    if (why) { c.keptReason = why; c.defaultChecked = false; }
  }

  return { candidates: out, notChecked: [...new Set(notChecked)] };
}
