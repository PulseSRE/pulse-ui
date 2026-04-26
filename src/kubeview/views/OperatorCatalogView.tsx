import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Puzzle, Search, Package, CheckCircle, XCircle, Loader2,
  ArrowRight, ArrowLeft, Star, Filter, Shield, Globe, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sCreate, k8sDelete, k8sGet } from '../engine/query';
import { safeQuery } from '../engine/safeQuery';
import { useUIStore } from '../store/uiStore';
import { showErrorToast } from '../engine/errorToast';
import { PulseError } from '../engine/errors';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { Card } from '../components/primitives/Card';

interface PackageManifest {
  metadata: { name: string; namespace?: string };
  status: {
    catalogSource: string;
    catalogSourceNamespace: string;
    channels: Array<{
      name: string;
      currentCSV: string;
      currentCSVDesc: {
        displayName: string;
        description: string;
        icon: Array<{ base64data: string; mediatype: string }>;
        version: string;
        provider: { name: string };
        installModes: Array<{ type: string; supported: boolean }>;
        annotations?: Record<string, string>;
      };
    }>;
    defaultChannel: string;
    provider: { name: string };
  };
}

const CATALOG_LABELS: Record<string, { label: string; color: string }> = {
  'redhat-operators': { label: 'Red Hat', color: 'bg-red-900/50 text-red-300 border-red-800' },
  'certified-operators': { label: 'Certified', color: 'bg-blue-900/50 text-blue-300 border-blue-800' },
  'community-operators': { label: 'Community', color: 'bg-green-900/50 text-green-300 border-green-800' },
};

const POPULAR_OPERATORS = [
  'cluster-logging', 'loki-operator', 'cluster-observability-operator',
  'redhat-oadp-operator', 'quay-operator', 'external-secrets-operator',
  'elasticsearch-operator', 'servicemeshoperator', 'serverless-operator',
  'web-terminal', 'devworkspace-operator', 'rhacs-operator',
  'compliance-operator', 'file-integrity-operator', 'costmanagement-metrics-operator',
  'kubevirt-hyperconverged', 'local-storage-operator', 'odf-operator',
];

export default function OperatorCatalogView() {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [catalogFilter, setCatalogFilter] = useState<string>('all');
  const [selectedOp, setSelectedOp] = useState<PackageManifest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [installNs, setInstallNs] = useState('openshift-operators');
  const [installingOp, setInstallingOp] = useState<{ name: string; ns: string; displayName: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [uninstalling, setUninstalling] = useState(false);
  const [showUninstallDialog, setShowUninstallDialog] = useState(false);
  const [orphanedCrds, setOrphanedCrds] = useState<Array<{ name: string; kind: string }>>([]);
  const [cleaningCrds, setCleaningCrds] = useState(false);

  // Fetch all package manifests
  const { data: packages = [], isLoading } = useQuery<PackageManifest[]>({
    queryKey: ['operator-catalog'],
    queryFn: () => k8sList<PackageManifest>('/apis/packages.operators.coreos.com/v1/packagemanifests'),
    staleTime: 300000, // 5 min cache
  });

  // Fetch installed subscriptions
  const { data: subscriptions = [] } = useQuery<any[]>({
    queryKey: ['readiness', 'subscriptions'],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/operators.coreos.com/v1alpha1/subscriptions'))) ?? [],
    staleTime: 60000,
  });

  const installedNames = useMemo(() => new Set(subscriptions.map((s: any) => s.spec?.name || s.metadata?.name)), [subscriptions]);

  // Deduplicate by name (multiple catalog versions)
  const dedupedPackages = useMemo(() => {
    const seen = new Map<string, PackageManifest>();
    for (const pkg of packages) {
      const name = pkg.metadata.name;
      const existing = seen.get(name);
      // Prefer redhat-operators > certified > community
      const priority: Record<string, number> = { 'redhat-operators': 3, 'certified-operators': 2, 'community-operators': 1 };
      const existingPriority = existing ? (priority[existing.status.catalogSource.replace(/-4\.\d+$/, '')] || 0) : 0;
      const newPriority = priority[pkg.status.catalogSource.replace(/-4\.\d+$/, '')] || 0;
      if (!existing || newPriority > existingPriority) {
        seen.set(name, pkg);
      }
    }
    return [...seen.values()];
  }, [packages]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = dedupedPackages;

    if (catalogFilter === 'installed') {
      result = result.filter(p => installedNames.has(p.metadata.name));
    } else if (catalogFilter !== 'all') {
      result = result.filter(p => p.status.catalogSource.replace(/-4\.\d+$/, '') === catalogFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => {
        const desc = p.status.channels?.[0]?.currentCSVDesc;
        return p.metadata.name.toLowerCase().includes(q) ||
          (desc?.displayName || '').toLowerCase().includes(q) ||
          (desc?.description || '').toLowerCase().includes(q);
      });
    }

    // Sort: popular first, then alphabetical
    return result.sort((a, b) => {
      const aPopular = POPULAR_OPERATORS.includes(a.metadata.name) ? 1 : 0;
      const bPopular = POPULAR_OPERATORS.includes(b.metadata.name) ? 1 : 0;
      if (aPopular !== bPopular) return bPopular - aPopular;
      const aName = a.status.channels?.[0]?.currentCSVDesc?.displayName || a.metadata.name;
      const bName = b.status.channels?.[0]?.currentCSVDesc?.displayName || b.metadata.name;
      return aName.localeCompare(bName);
    });
  }, [dedupedPackages, search, catalogFilter, installedNames]);

  // Install operator
  const handleInstall = async (pkg: PackageManifest, channel: string, ns: string) => {
    setInstalling(true);
    try {
      // Create namespace if it doesn't exist (best effort)
      if (ns !== 'openshift-operators') {
        try {
          await k8sCreate('/api/v1/namespaces', { apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } });
        } catch (err: unknown) {
          if (!(err instanceof PulseError && err.statusCode === 409)) showErrorToast(err, 'Failed to create namespace');
        }
      }

      // Create OperatorGroup if namespace is not openshift-operators (which has a global one)
      if (ns !== 'openshift-operators' && ns !== 'openshift-operators-redhat') {
        try {
          await k8sCreate(`/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`, {
            apiVersion: 'operators.coreos.com/v1',
            kind: 'OperatorGroup',
            metadata: { name: `${pkg.metadata.name}-group`, namespace: ns },
            spec: { targetNamespaces: [ns] },
          });
        } catch (err: unknown) {
          if (!(err instanceof PulseError && err.statusCode === 409)) showErrorToast(err, 'Failed to create OperatorGroup');
        }
      }

      // Create Subscription
      await k8sCreate(`/apis/operators.coreos.com/v1alpha1/namespaces/${ns}/subscriptions`, {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: pkg.metadata.name, namespace: ns },
        spec: {
          channel,
          name: pkg.metadata.name,
          source: pkg.status.catalogSource,
          sourceNamespace: pkg.status.catalogSourceNamespace || 'openshift-marketplace',
          installPlanApproval: 'Automatic',
        },
      });

      const displayName = pkg.status.channels?.[0]?.currentCSVDesc?.displayName || pkg.metadata.name;
      addToast({ type: 'success', title: 'Subscription created', detail: `${displayName} installing in ${ns}` });
      queryClient.invalidateQueries({ queryKey: ['readiness', 'subscriptions'] });
      setInstallingOp({ name: pkg.metadata.name, ns, displayName });
      setSelectedOp(null);
    } catch (err) {
      showErrorToast(err, 'Install failed');
    }
    setInstalling(false);
  };

  // Uninstall operator
  const handleUninstall = async () => {
    if (!selectedOp || !selectedSub) return;

    setUninstalling(true);
    setShowUninstallDialog(false);

    // Capture owned CRDs before deleting CSV
    const ownedCrds = installedCsv?.spec?.customresourcedefinitions?.owned || [];

    try {
      const subNs = selectedSub.metadata.namespace;
      const subName = selectedSub.metadata.name;
      const csvName = selectedSub.status?.installedCSV;

      // Delete the Subscription first
      await k8sDelete(`/apis/operators.coreos.com/v1alpha1/namespaces/${subNs}/subscriptions/${subName}`);

      // Delete the CSV if it exists
      if (csvName) {
        try {
          await k8sDelete(`/apis/operators.coreos.com/v1alpha1/namespaces/${subNs}/clusterserviceversions/${csvName}`);
        } catch {
          // CSV might already be gone or handled by OLM
        }
      }

      const displayName = selectedOp.status.channels?.[0]?.currentCSVDesc?.displayName || selectedOp.metadata.name;
      addToast({ type: 'success', title: 'Operator uninstalled', detail: `${displayName} has been removed` });

      // Check which CRDs are still on the cluster
      if (ownedCrds.length > 0) {
        const stillPresent: Array<{ name: string; kind: string }> = [];
        for (const crd of ownedCrds) {
          try {
            await k8sGet(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${crd.name}`);
            stillPresent.push({ name: crd.name, kind: crd.kind });
          } catch {
            // CRD already gone
          }
        }
        if (stillPresent.length > 0) {
          setOrphanedCrds(stillPresent);
        }
      }

      // Invalidate cache and clear selection
      queryClient.invalidateQueries({ queryKey: ['readiness', 'subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['operator-sub', selectedOp.metadata.name] });
      setSelectedOp(null);
    } catch (err) {
      showErrorToast(err, 'Uninstall failed');
    }

    setUninstalling(false);
  };

  const handleCleanupCrds = async () => {
    setCleaningCrds(true);
    let cleaned = 0;
    for (const crd of orphanedCrds) {
      try {
        await k8sDelete(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${crd.name}`);
        cleaned++;
      } catch {
        // best effort
      }
    }
    addToast({ type: 'success', title: `Cleaned up ${cleaned} CRD${cleaned !== 1 ? 's' : ''}` });
    setOrphanedCrds([]);
    setCleaningCrds(false);
  };

  // Catalog source counts (must be before conditional return)
  const catalogs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of dedupedPackages) {
      const key = p.status.catalogSource.replace(/-4\.\d+$/, '');
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [dedupedPackages]);

  // Initialize channel/ns when operator is selected
  React.useEffect(() => {
    if (selectedOp) {
      const channels = selectedOp.status.channels || [];
      setSelectedChannel(selectedOp.status.defaultChannel || channels[0]?.name || '');
      const desc = channels.find(c => c.name === selectedOp.status.defaultChannel)?.currentCSVDesc || channels[0]?.currentCSVDesc;
      const allNsSupported = desc?.installModes?.find((m: any) => m.type === 'AllNamespaces')?.supported;
      setInstallNs(
        selectedOp.metadata.name.includes('logging') ? 'openshift-logging'
        : selectedOp.metadata.name.includes('loki') ? 'openshift-operators-redhat'
        : allNsSupported ? 'openshift-operators'
        : `openshift-${selectedOp.metadata.name}`
      );
    }
  }, [selectedOp]);

  // Track install progress
  const { data: installSub } = useQuery({
    queryKey: ['install-progress', installingOp?.name, installingOp?.ns],
    queryFn: () => installingOp ? safeQuery(() => k8sGet<any>(`/apis/operators.coreos.com/v1alpha1/namespaces/${installingOp.ns}/subscriptions/${installingOp.name}`)) : null,
    enabled: !!installingOp,
    refetchInterval: 3000,
  });

  const { data: installCsv } = useQuery({
    queryKey: ['install-csv', installSub?.status?.installedCSV, installingOp?.ns],
    queryFn: () => installSub?.status?.installedCSV ? safeQuery(() => k8sGet<any>(`/apis/operators.coreos.com/v1alpha1/namespaces/${installingOp!.ns}/clusterserviceversions/${installSub.status.installedCSV}`)) : null,
    enabled: !!installSub?.status?.installedCSV && !!installingOp,
    refetchInterval: 3000,
  });

  const installPhase = React.useMemo(() => {
    if (!installingOp) return null;
    if (!installSub) return 'creating';
    if (!installSub.status?.installedCSV) return 'pending';
    if (!installCsv) return 'installing';
    const csvPhase = installCsv.status?.phase;
    if (csvPhase === 'Succeeded') return 'succeeded';
    if (csvPhase === 'Failed') return 'failed';
    return 'installing';
  }, [installingOp, installSub, installCsv]);

  // Toast on success (don't auto-dismiss — show next steps)
  const [toastedSuccess, setToastedSuccess] = useState(false);
  useEffect(() => {
    if (installPhase === 'succeeded' && !toastedSuccess) {
      addToast({ type: 'success', title: `${installingOp?.displayName} is ready` });
      queryClient.invalidateQueries({ queryKey: ['readiness', 'subscriptions'] });
      setToastedSuccess(true);
    }
    if (!installingOp) setToastedSuccess(false);
  }, [installPhase, toastedSuccess, installingOp]);

  // Post-install guidance for known operators
  const postInstallSteps = useMemo<Array<{ title: string; description: string; path: string; label: string }>>(() => {
    if (!installingOp || installPhase !== 'succeeded') return [];
    const name = installingOp.name.toLowerCase();

    if (name.includes('cluster-logging')) return [
      { title: 'Create a ClusterLogForwarder', description: 'Configure what logs to collect and where to send them', path: '/create/observability.openshift.io~v1~clusterlogforwarders', label: 'Create ClusterLogForwarder' },
      { title: 'Install Loki for log storage', description: 'CLO needs a log store — Loki is the recommended option', path: '/create/v1~pods?tab=operators&q=loki', label: 'Install Loki' },
    ];
    if (name.includes('loki')) return [
      { title: 'Create a LokiStack', description: 'Configure log storage with S3/Azure/GCS backend and storage class', path: '/create/loki.grafana.com~v1~lokistacks', label: 'Create LokiStack' },
      { title: 'Create storage credentials Secret', description: 'LokiStack needs a Secret with your object storage credentials', path: '/create/v1~secrets', label: 'Create Secret' },
      { title: 'Connect logging to Loki', description: 'Create or update a ClusterLogForwarder to send logs to your LokiStack', path: '/create/observability.openshift.io~v1~clusterlogforwarders', label: 'Create ClusterLogForwarder' },
    ];
    if (name.includes('observability')) return [
      { title: 'COO is ready', description: 'The Cluster Observability Operator manages the monitoring stack, distributed tracing, and log correlation. It works automatically with the built-in Prometheus and Alertmanager — no additional configuration required.', path: '/alerts', label: 'View Alerts' },
    ];
    if (name.includes('oadp') || name.includes('data-protection')) return [
      { title: 'Create a DataProtectionApplication', description: 'Configure backup storage location (S3, Azure, GCS) and schedule', path: '/create/oadp.openshift.io~v1alpha1~dataprotectionapplications', label: 'Create DPA' },
      { title: 'Create backup credentials Secret', description: 'DPA needs a Secret with your cloud storage credentials', path: '/create/v1~secrets', label: 'Create Secret' },
      { title: 'Create a Backup Schedule', description: 'Set up recurring etcd and application backups', path: '/create/velero.io~v1~schedules', label: 'Create Schedule' },
    ];
    if (name.includes('quay')) return [
      { title: 'Create a QuayRegistry', description: 'Deploy a Quay registry instance with managed storage and database', path: '/create/quay.redhat.com~v1~quayregistries', label: 'Create QuayRegistry' },
    ];
    if (name.includes('external-secrets')) return [
      { title: 'Create a SecretStore', description: 'Connect to your secret provider (Vault, AWS Secrets Manager, GCP)', path: '/create/external-secrets.io~v1beta1~secretstores', label: 'Create SecretStore' },
      { title: 'Create an ExternalSecret', description: 'Sync a secret from your provider into a K8s Secret', path: '/create/external-secrets.io~v1beta1~externalsecrets', label: 'Create ExternalSecret' },
    ];
    if (name.includes('servicemesh') || name.includes('istio')) return [
      { title: 'Create a ServiceMeshControlPlane', description: 'Deploy the Istio control plane in your namespace', path: '/create/maistra.io~v2~servicemeshcontrolplanes', label: 'Create SMCP' },
      { title: 'Create a ServiceMeshMemberRoll', description: 'Add namespaces to the service mesh', path: '/create/maistra.io~v2~servicemeshmemberrolls', label: 'Create SMMR' },
    ];
    if (name.includes('serverless')) return [
      { title: 'Create a KnativeServing', description: 'Enable serverless workloads with Knative Serving', path: '/create/operator.knative.dev~v1beta1~knativeservings', label: 'Create KnativeServing' },
    ];
    if (name.includes('odf') || name.includes('openshift-data-foundation')) return [
      { title: 'Create a StorageSystem', description: 'Configure the storage backend (Ceph, NooBaa)', path: '/create/odf.openshift.io~v1alpha1~storagesystems', label: 'Create StorageSystem' },
    ];
    if (name.includes('gitops') || name.includes('argocd')) return [
      { title: 'Access ArgoCD Console', description: 'OpenShift GitOps creates an ArgoCD instance in openshift-gitops namespace. Access it via the ArgoCD route.', path: '/r/route.openshift.io~v1~routes', label: 'View Routes' },
      { title: 'Create an Application', description: 'Create an ArgoCD Application that syncs a Git repo to your cluster', path: '/create/argoproj.io~v1alpha1~applications', label: 'Create Application' },
      { title: 'Add cluster config to Git', description: 'Move your cluster configuration (operators, namespaces, RBAC, quotas) into a Git repository for declarative management', path: '/admin', label: 'View Config' },
    ];

    // Generic fallback
    return [];
  }, [installingOp, installPhase]);

  // Install progress banner
  const installProgressBanner = installingOp && (
    <div className={cn('rounded-lg border p-4 flex items-center gap-4',
      installPhase === 'succeeded' ? 'bg-green-950/30 border-green-800' :
      installPhase === 'failed' ? 'bg-red-950/30 border-red-800' :
      'bg-blue-950/30 border-blue-800'
    )}>
      {installPhase === 'succeeded' ? <CheckCircle className="w-6 h-6 text-green-400 shrink-0" /> :
       installPhase === 'failed' ? <XCircle className="w-6 h-6 text-red-400 shrink-0" /> :
       <Loader2 className="w-6 h-6 text-blue-400 animate-spin shrink-0" />}
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-200">{installingOp.displayName}</div>
        <div className="text-xs text-slate-400 mt-0.5">
          {installPhase === 'creating' && 'Creating subscription...'}
          {installPhase === 'pending' && 'Waiting for install plan approval...'}
          {installPhase === 'installing' && `Installing CSV ${installSub?.status?.installedCSV || ''}...`}
          {installPhase === 'succeeded' && 'Operator installed and ready'}
          {installPhase === 'failed' && `Failed: ${installCsv?.status?.message || 'Unknown error'}`}
        </div>
        {/* Progress steps */}
        <div className="flex items-center gap-1 mt-2">
          {['creating', 'pending', 'installing', 'succeeded'].map((step, i) => {
            const steps = ['creating', 'pending', 'installing', 'succeeded'];
            const currentIdx = steps.indexOf(installPhase || '');
            const stepIdx = i;
            const done = stepIdx < currentIdx || installPhase === 'succeeded';
            const active = stepIdx === currentIdx;
            return (
              <React.Fragment key={step}>
                <div className={cn('flex items-center gap-1',
                  done ? 'text-green-400' : active ? 'text-blue-400' : 'text-slate-600'
                )}>
                  {done ? <CheckCircle className="w-3 h-3" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-3 h-3 rounded-full border border-slate-600" />}
                  <span className="text-xs">{step === 'creating' ? 'Subscribe' : step === 'pending' ? 'Plan' : step === 'installing' ? 'Install' : 'Ready'}</span>
                </div>
                {i < 3 && <div className={cn('flex-1 h-px mx-1', done ? 'bg-green-700' : 'bg-slate-700')} />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <button onClick={() => setInstallingOp(null)} className="text-xs text-slate-400 hover:text-slate-200 shrink-0 self-start mt-1">
        {installPhase === 'succeeded' || installPhase === 'failed' ? 'Close' : 'Hide'}
      </button>
    </div>
  );

  // What's Next panel (shown after successful install)
  const whatNextPanel = installPhase === 'succeeded' && postInstallSteps.length > 0 && (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100">What's Next — Configure {installingOp?.displayName}</h2>
        <p className="text-xs text-slate-500 mt-0.5">The operator is installed. Complete these steps to finish setup:</p>
      </div>
      <div className="divide-y divide-slate-800">
        {postInstallSteps.map((step, i) => (
          <div key={i} className="px-4 py-3 flex items-start gap-3">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-900/50 text-blue-300 text-xs font-bold shrink-0 mt-0.5">{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-200">{step.title}</div>
              <div className="text-xs text-slate-500 mt-0.5">{step.description}</div>
            </div>
            <button onClick={() => go(step.path, step.label)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded shrink-0">
              {step.label} <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );

  // Fetch CSV for installed operator to get provided APIs
  // Fetch subscription directly for selected operator (don't rely on readiness cache)
  const { data: selectedSub } = useQuery({
    queryKey: ['operator-sub', selectedOp?.metadata?.name],
    queryFn: async () => {
      if (!selectedOp) return null;
      const allSubs = await k8sList<any>('/apis/operators.coreos.com/v1alpha1/subscriptions');
      return allSubs.find((s: any) => (s.spec?.name || s.metadata?.name) === selectedOp.metadata.name) || null;
    },
    enabled: !!selectedOp,
    staleTime: 15000,
  });

  const installedCsvName = selectedSub?.status?.installedCSV;
  const installedCsvNs = selectedSub?.metadata?.namespace;

  const { data: installedCsv } = useQuery({
    queryKey: ['csv-detail', installedCsvName, installedCsvNs],
    queryFn: () => safeQuery(() => k8sGet<any>(`/apis/operators.coreos.com/v1alpha1/namespaces/${installedCsvNs}/clusterserviceversions/${installedCsvName}`)),
    enabled: !!installedCsvName && !!installedCsvNs,
    staleTime: 30000,
  });

  const providedApis = useMemo(() => {
    if (!installedCsv) return [];
    const owned = installedCsv.spec?.customresourcedefinitions?.owned || [];
    // Deduplicate by kind (some appear with multiple versions)
    const seen = new Set<string>();
    return owned.filter((crd: any) => {
      if (seen.has(crd.kind)) return false;
      seen.add(crd.kind);
      return true;
    });
  }, [installedCsv]);

  // Fetch operator's running resources (deployments, pods)
  const csvDeploymentNames = useMemo(() => {
    if (!installedCsv) return [];
    return (installedCsv.spec?.install?.spec?.deployments || []).map((d: any) => d.name);
  }, [installedCsv]);

  const csvServiceAccounts = useMemo(() => {
    if (!installedCsv) return [];
    const perms = [
      ...(installedCsv.spec?.install?.spec?.clusterPermissions || []),
      ...(installedCsv.spec?.install?.spec?.permissions || []),
    ];
    return [...new Set(perms.map((p: any) => p.serviceAccountName))];
  }, [installedCsv]);

  const { data: operatorPods = [] } = useQuery<any[]>({
    queryKey: ['operator-pods', installedCsvNs, csvDeploymentNames],
    queryFn: async () => {
      if (!installedCsvNs || csvDeploymentNames.length === 0) return [];
      const allPods = await k8sList<any>(`/api/v1/namespaces/${installedCsvNs}/pods`);
      return allPods.filter((p: any) => csvDeploymentNames.some((dn: string) => p.metadata.name.startsWith(dn)));
    },
    enabled: csvDeploymentNames.length > 0 && !!installedCsvNs,
    refetchInterval: 15000,
  });

  const { data: installPlan } = useQuery({
    queryKey: ['installplan', selectedSub?.status?.installPlanRef?.name, installedCsvNs],
    queryFn: () => selectedSub?.status?.installPlanRef?.name && installedCsvNs
      ? safeQuery(() => k8sGet<any>(`/apis/operators.coreos.com/v1alpha1/namespaces/${installedCsvNs}/installplans/${selectedSub.status.installPlanRef.name}`))
      : null,
    enabled: !!selectedSub?.status?.installPlanRef?.name && !!installedCsvNs,
    staleTime: 60000,
  });

  // Detail view
  if (selectedOp) {
    const desc = selectedOp.status.channels?.find(c => c.name === selectedOp.status.defaultChannel)?.currentCSVDesc
      || selectedOp.status.channels?.[0]?.currentCSVDesc;
    const channels = selectedOp.status.channels || [];
    const isInstalled = installedNames.has(selectedOp.metadata.name);
    const catalogBase = selectedOp.status.catalogSource.replace(/-4\.\d+$/, '');
    const catalogInfo = CATALOG_LABELS[catalogBase];
    const allNsSupported = desc?.installModes?.find((m: any) => m.type === 'AllNamespaces')?.supported;

    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <button onClick={() => setSelectedOp(null)} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-4 h-4" /> Back to catalog
          </button>

          {installProgressBanner}
          {whatNextPanel}

          <div className="flex items-start gap-4">
            {desc?.icon?.[0]?.base64data ? (
              <img src={`data:${desc.icon[0].mediatype};base64,${desc.icon[0].base64data}`} className="w-16 h-16 rounded-lg" alt="" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-slate-800 flex items-center justify-center"><Puzzle className="w-8 h-8 text-slate-600" /></div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-100">{desc?.displayName || selectedOp.metadata.name}</h1>
                {isInstalled && <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-300 rounded border border-green-800">Installed</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
                <span>{desc?.provider?.name || selectedOp.status.provider?.name}</span>
                <span>v{desc?.version}</span>
                {catalogInfo && <span className={cn('text-xs px-1.5 py-0.5 rounded border', catalogInfo.color)}>{catalogInfo.label}</span>}
              </div>
            </div>
          </div>

          {/* Description */}
          <Card className="p-4">
            <p className="text-sm text-slate-300 whitespace-pre-line">{desc?.description || 'No description available.'}</p>
          </Card>

          {/* Install form */}
          {!isInstalled && (
            <div className="bg-blue-950/30 rounded-lg border border-blue-800 p-4 space-y-4">
              <h2 className="text-sm font-semibold text-blue-200">Install Operator</h2>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Channel</label>
                <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)}
                  className="px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 w-full max-w-xs">
                  {channels.map(ch => <option key={ch.name} value={ch.name}>{ch.name} (v{ch.currentCSVDesc?.version})</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Install Namespace</label>
                <input type="text" value={installNs} onChange={(e) => setInstallNs(e.target.value)}
                  className="px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 w-full max-w-xs font-mono" />
                <div className="text-xs text-slate-500 mt-1">
                  {allNsSupported ? 'This operator supports all namespaces — openshift-operators is recommended.' : 'This operator requires its own namespace.'}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => handleInstall(selectedOp, selectedChannel, installNs)} disabled={installing}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
                  {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                  {installing ? 'Installing...' : 'Install'}
                </button>
                <span className="text-xs text-slate-500">Creates Namespace, OperatorGroup, and Subscription</span>
              </div>
            </div>
          )}

          {/* Provided APIs — show for installed operators */}
          {isInstalled && !installedCsv && (
            <Card className="p-4 text-center">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">Loading operator details...</p>
            </Card>
          )}
          {isInstalled && providedApis.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Provided APIs ({providedApis.length})</h2>
                <p className="text-xs text-slate-500 mt-0.5">Custom resources managed by this operator — create instances to configure it</p>
              </div>
              <div className="divide-y divide-slate-800">
                {providedApis.map((crd: any) => {
                  const gvrUrl = `${crd.name.split('.').slice(1).join('.')}~${crd.version}~${crd.name.split('.')[0]}`;
                  return (
                    <div key={`${crd.kind}-${crd.version}`} className="px-4 py-3 flex items-start gap-3">
                      <Package className="w-4 h-4 text-blue-400 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200">{crd.kind}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{crd.description || crd.name}</div>
                        <div className="text-xs text-slate-600 font-mono mt-0.5">{crd.name} ({crd.version})</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => go(`/r/${gvrUrl}`, crd.kind)} className="px-2.5 py-1 text-xs text-slate-300 border border-slate-700 rounded hover:border-slate-600 hover:text-slate-200">
                          Browse
                        </button>
                        <button onClick={() => go(`/create/${gvrUrl}`, `Create ${crd.kind}`)} className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 flex items-center gap-1">
                          Create <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Subscription & Install Details (installed only) */}
          {isInstalled && selectedSub && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">Subscription Details</h2>
                <button
                  onClick={() => setShowUninstallDialog(true)}
                  disabled={uninstalling}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {uninstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {uninstalling ? 'Uninstalling...' : 'Uninstall'}
                </button>
              </div>
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div><span className="text-slate-500">Channel</span><div className="text-slate-200 font-mono mt-0.5">{selectedSub.spec?.channel}</div></div>
                <div><span className="text-slate-500">Source</span><div className="text-slate-200 mt-0.5">{selectedSub.spec?.source}</div></div>
                <div><span className="text-slate-500">Approval</span><div className="text-slate-200 mt-0.5">{selectedSub.spec?.installPlanApproval}</div></div>
                <div><span className="text-slate-500">Namespace</span><div className="text-slate-200 font-mono mt-0.5">{selectedSub.metadata?.namespace}</div></div>
                <div><span className="text-slate-500">CSV</span><div className="text-slate-200 font-mono mt-0.5">{selectedSub.status?.installedCSV || '—'}</div></div>
                <div><span className="text-slate-500">CSV Phase</span><div className={cn('mt-0.5', installedCsv?.status?.phase === 'Succeeded' ? 'text-green-400' : 'text-yellow-400')}>{installedCsv?.status?.phase || '—'}</div></div>
                <div>
                  <span className="text-slate-500">InstallPlan</span>
                  <div className="text-slate-200 font-mono mt-0.5">
                    {selectedSub.status?.installPlanRef?.name ? (
                      <button onClick={() => go(`/r/operators.coreos.com~v1alpha1~installplans/${installedCsvNs}/${selectedSub.status.installPlanRef.name}`, 'InstallPlan')} className="text-blue-400 hover:text-blue-300">
                        {selectedSub.status.installPlanRef.name}
                      </button>
                    ) : '—'}
                  </div>
                </div>
                <div><span className="text-slate-500">State</span><div className={cn('mt-0.5', selectedSub.status?.state === 'AtLatestKnown' ? 'text-green-400' : 'text-yellow-400')}>{selectedSub.status?.state || '—'}</div></div>
              </div>
            </Card>
          )}

          {/* Operator Components (deployments + pods) */}
          {isInstalled && csvDeploymentNames.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Operator Components</h2>
                <p className="text-xs text-slate-500 mt-0.5">{csvDeploymentNames.length} deployment{csvDeploymentNames.length !== 1 ? 's' : ''}, {operatorPods.length} pod{operatorPods.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="divide-y divide-slate-800">
                {csvDeploymentNames.map((depName: string) => {
                  const depPods = operatorPods.filter((p: any) => p.metadata.name.startsWith(depName));
                  return (
                    <div key={depName} className="px-4 py-3">
                      <button onClick={() => go(`/r/apps~v1~deployments/${installedCsvNs}/${depName}`, depName)}
                        className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center gap-2">
                        <Package className="w-3.5 h-3.5" /> {depName}
                      </button>
                      {depPods.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {depPods.map((pod: any) => {
                            const phase = pod.status?.phase || 'Pending';
                            const cs = pod.status?.containerStatuses || [];
                            const ready = cs.filter((c: any) => c.ready).length;
                            const total = cs.length || 1;
                            return (
                              <button key={pod.metadata.uid} onClick={() => go(`/r/v1~pods/${installedCsvNs}/${pod.metadata.name}`, pod.metadata.name)}
                                className="w-full flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/50 text-left">
                                <div className="flex items-center gap-2">
                                  <div className={cn('w-1.5 h-1.5 rounded-full', phase === 'Running' && ready === total ? 'bg-green-500' : 'bg-yellow-500')} />
                                  <span className="text-xs text-slate-300 font-mono">{pod.metadata.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500 font-mono">{ready}/{total}</span>
                                  <span className={cn('text-xs px-1.5 py-0.5 rounded', phase === 'Running' ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300')}>{phase}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Service Accounts & RBAC */}
          {isInstalled && csvServiceAccounts.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Service Accounts & RBAC</h2>
              </div>
              <div className="divide-y divide-slate-800">
                {csvServiceAccounts.map((sa: string) => (
                  <button key={sa} onClick={() => go(`/r/v1~serviceaccounts/${installedCsvNs}/${sa}`, sa)}
                    className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-slate-800/50 text-left">
                    <Shield className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-sm text-blue-400 hover:text-blue-300 font-mono">{sa}</span>
                    <span className="text-xs text-slate-500">{installedCsvNs}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Install modes */}
          <Card className="p-4">
            <h3 className="text-xs text-slate-400 mb-2">Install Modes</h3>
            <div className="flex flex-wrap gap-2">
              {desc?.installModes?.map((m: any) => (
                <span key={m.type} className={cn('text-xs px-2 py-1 rounded border', m.supported ? 'bg-green-900/30 text-green-300 border-green-800' : 'bg-slate-800 text-slate-500 border-slate-700')}>
                  {m.type}: {m.supported ? '✓' : '✗'}
                </span>
              ))}
            </div>
          </Card>
        </div>

        {/* Uninstall confirmation dialog */}
        <ConfirmDialog
          open={showUninstallDialog}
          onClose={() => setShowUninstallDialog(false)}
          onConfirm={handleUninstall}
          title={`Uninstall ${desc?.displayName || selectedOp.metadata.name}?`}
          description="This will remove the operator subscription and its ClusterServiceVersion. You'll be offered the option to clean up orphaned CRDs afterward."
          confirmLabel="Uninstall"
          variant="danger"
          loading={uninstalling}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Puzzle className="w-6 h-6 text-violet-500" /> Operator Catalog</h1>
          <p className="text-sm text-slate-400 mt-1">{dedupedPackages.length} operators available from {catalogs.length} sources</p>
        </div>

        {installProgressBanner}
        {whatNextPanel}

        {/* Orphaned CRDs banner */}
        {orphanedCrds.length > 0 && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
            <div className="flex items-start gap-3">
              <Trash2 className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-amber-200">
                  {orphanedCrds.length} orphaned CRD{orphanedCrds.length !== 1 ? 's' : ''} left behind
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  These Custom Resource Definitions were owned by the uninstalled operator.
                  Removing them will also delete any existing custom resources of these types.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {orphanedCrds.map((crd) => (
                    <span key={crd.name} className="text-xs font-mono px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700">
                      {crd.kind}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={handleCleanupCrds}
                    disabled={cleaningCrds}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
                  >
                    {cleaningCrds ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    {cleaningCrds ? 'Cleaning...' : 'Delete CRDs'}
                  </button>
                  <button
                    onClick={() => setOrphanedCrds([])}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Keep them
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search operators..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1" role="tablist" aria-label="Catalog filter">
            <button role="tab" aria-selected={catalogFilter === 'installed'} onClick={() => setCatalogFilter('installed')} className={cn('px-3 py-1.5 text-xs rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', catalogFilter === 'installed' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              Installed ({installedNames.size})
            </button>
            <button role="tab" aria-selected={catalogFilter === 'all'} onClick={() => setCatalogFilter('all')} className={cn('px-3 py-1.5 text-xs rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', catalogFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              All ({dedupedPackages.length})
            </button>
            {catalogs.map(([name, count]) => {
              const info = CATALOG_LABELS[name];
              return (
                <button key={name} role="tab" aria-selected={catalogFilter === name} onClick={() => setCatalogFilter(name)}
                  className={cn('px-3 py-1.5 text-xs rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', catalogFilter === name ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                  {info?.label || name} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" /><p className="text-sm text-slate-500 mt-3">Loading operator catalog...</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.slice(0, visibleCount).map((pkg) => {
              const desc = pkg.status.channels?.find(c => c.name === pkg.status.defaultChannel)?.currentCSVDesc || pkg.status.channels?.[0]?.currentCSVDesc;
              const isInstalled = installedNames.has(pkg.metadata.name);
              const catalogBase = pkg.status.catalogSource.replace(/-4\.\d+$/, '');
              const catalogInfo = CATALOG_LABELS[catalogBase];
              const isPopular = POPULAR_OPERATORS.includes(pkg.metadata.name);

              return (
                <button key={pkg.metadata.name} onClick={() => setSelectedOp(pkg)}
                  className={cn('flex items-start gap-3 p-4 bg-slate-900 rounded-lg border text-left transition-colors hover:border-blue-600',
                    isInstalled ? 'border-green-800' : 'border-slate-800')}>
                  {desc?.icon?.[0]?.base64data ? (
                    <img src={`data:${desc.icon[0].mediatype};base64,${desc.icon[0].base64data}`} className="w-10 h-10 rounded shrink-0" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center shrink-0"><Puzzle className="w-5 h-5 text-slate-600" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">{desc?.displayName || pkg.metadata.name}</span>
                      {isInstalled && <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{desc?.description?.slice(0, 100) || 'No description'}</div>
                    <div className="flex items-center gap-2 mt-2">
                      {catalogInfo && <span className={cn('text-xs px-1.5 py-0.5 rounded border', catalogInfo.color)}>{catalogInfo.label}</span>}
                      <span className="text-xs text-slate-500">v{desc?.version}</span>
                      {isPopular && <Star className="w-3 h-3 text-yellow-500" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {filtered.length > visibleCount && (
          <div className="text-center pt-3">
            <button
              onClick={() => setVisibleCount(c => c + 60)}
              className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
            >
              Show more ({filtered.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
