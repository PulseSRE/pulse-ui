import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Plus, Package, Network, Globe, HardDrive, FileText,
  Lock, Shield, Clock, TrendingUp, Folder, User, ShieldCheck,
  Clipboard, AlertCircle, Box, Search, Loader2, ExternalLink,
  Ship, Image, GitBranch, Upload, Database, ArrowRight, CheckCircle, XCircle, Puzzle,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { buildApiPath } from '../hooks/useResourceUrl';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import YamlEditor from '../components/yaml/YamlEditor';
import { snippets, resolveSnippet, getSnippetSuggestions, type Snippet } from '../components/yaml/SnippetEngine';
import { K8S_BASE as BASE } from '../engine/gvr';
import DeployProgress from '../components/DeployProgress';

// Generate YAML spec from OpenAPI schema (top-level required fields)
function generateSpecFromSchema(properties: Record<string, any>, indent = 2): string {
  const lines: string[] = [];
  const pad = ' '.repeat(indent);

  for (const [key, prop] of Object.entries(properties)) {
    if (key.startsWith('x-') || key === 'status') continue;
    const desc = prop.description ? ` # ${prop.description.slice(0, 60)}` : '';

    if (prop.type === 'object' && prop.properties) {
      lines.push(`${pad}${key}:${desc}`);
      lines.push(generateSpecFromSchema(prop.properties, indent + 2));
    } else if (prop.type === 'array') {
      lines.push(`${pad}${key}:${desc}`);
      if (prop.items?.properties) {
        lines.push(`${pad}- `);
        const itemLines = generateSpecFromSchema(prop.items.properties, indent + 4);
        lines.push(itemLines);
      } else {
        lines.push(`${pad}- ""`);
      }
    } else if (prop.type === 'integer' || prop.type === 'number') {
      lines.push(`${pad}${key}: ${prop.default ?? 0}${desc}`);
    } else if (prop.type === 'boolean') {
      lines.push(`${pad}${key}: ${prop.default ?? false}${desc}`);
    } else if (prop.enum) {
      lines.push(`${pad}${key}: ${prop.enum[0]}${desc} # options: ${prop.enum.join(', ')}`);
    } else {
      lines.push(`${pad}${key}: ""${desc}`);
    }

    // Only include first 15 fields to keep template manageable
    if (lines.length > 30) {
      lines.push(`${pad}# ... more fields available (see API docs)`);
      break;
    }
  }
  return lines.join('\n');
}

interface CreateViewProps {
  gvrKey: string;
}

type CreateTab = 'installed' | 'operators' | 'deploy' | 'helm' | 'templates' | 'yaml';

import { lazy, Suspense } from 'react';
const OperatorCatalogView = lazy(() => import('./OperatorCatalogView'));


export default function CreateView({ gvrKey }: CreateViewProps) {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const registry = useClusterStore((s) => s.resourceRegistry);

  const urlTab = new URLSearchParams(window.location.search).get('tab') as CreateTab;
  const [activeTab, setActiveTabState] = useState<CreateTab>(urlTab || 'installed');
  const setActiveTab = (tab: CreateTab) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'installed') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const [editMode, setEditMode] = useState(false);
  const [activeGvr, setActiveGvr] = useState(gvrKey);
  const [yaml, setYaml] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gvrParts = activeGvr.split('/');
  const resourcePlural = gvrParts[gvrParts.length - 1];
  const resourceType = registry?.get(activeGvr) ?? (activeGvr.split('/').length === 2 ? registry?.get(`core/${activeGvr}`) : undefined);
  const kind = resourceType?.kind || resourcePlural.replace(/s$/, '').replace(/^./, (c) => c.toUpperCase());

  // If we came with a specific GVR (not the default), go straight to YAML editor
  useMemo(() => {
    if (gvrKey !== 'v1/pods') {
      const shortName = resourcePlural.replace(/s$/, '').toLowerCase();
      const snips = getSnippetSuggestions(shortName);
      if (snips.length > 0) {
        const resolved = resolveSnippet(snips[0]);
        const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';
        setYaml(resolved.replace(/namespace: default/, `namespace: ${ns}`));
      } else {
        selectBlankYaml(gvrKey);
      }
      setEditMode(true);
      setActiveTab('yaml');
    }
  }, []);

  function selectTemplate(snippet: Snippet, gvr: string) {
    const resolved = resolveSnippet(snippet);
    const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';
    setYaml(resolved.replace(/namespace: default/, `namespace: ${ns}`));
    setActiveGvr(gvr);
    setEditMode(true);
    setError(null);
  }

  async function selectBlankYaml(gvr: string) {
    const parts = gvr.split('/');
    const group = parts.length === 3 ? parts[0] : '';
    const version = parts.length === 3 ? parts[1] : parts[0];
    const plural = parts[parts.length - 1];
    const apiVersion = group ? `${group}/${version}` : version;
    const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';

    // Look up kind from registry (handles CRD names correctly)
    const rt = registry?.get(gvr) ?? (parts.length === 2 ? registry?.get(`core/${gvr}`) : undefined);
    const kindName = rt?.kind || plural.replace(/s$/, '').replace(/^./, c => c.toUpperCase());

    // Try to fetch CRD schema for better template
    let schemaYaml = '';
    if (group) {
      try {
        const crd = await fetch(`${BASE}/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${plural}.${group}`).then(r => r.ok ? r.json() : null);
        if (crd) {
          const versionSpec = crd.spec?.versions?.find((v: any) => v.name === version) || crd.spec?.versions?.[0];
          const schema = versionSpec?.schema?.openAPIV3Schema?.properties?.spec?.properties;
          if (schema) {
            schemaYaml = generateSpecFromSchema(schema);
          }
        }
      } catch {}
    }

    setYaml([
      `apiVersion: ${apiVersion}`,
      `kind: ${kindName}`,
      'metadata:',
      `  name: my-${kindName.toLowerCase()}`,
      rt?.namespaced !== false ? `  namespace: ${ns}` : null,
      schemaYaml ? `spec:\n${schemaYaml}` : 'spec: {}',
    ].filter(Boolean).join('\n'));
    setActiveGvr(gvr);
    setEditMode(true);
    setError(null);
  }

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const nsMatch = yaml.match(/namespace:\s*(\S+)/);
      const ns = nsMatch?.[1] || (resourceType?.namespaced ? (selectedNamespace !== '*' ? selectedNamespace : 'default') : undefined);
      const apiPath = buildApiPath(activeGvr, ns);

      const res = await fetch(`${BASE}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/yaml' },
        body: yaml,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `${res.status}: ${res.statusText}`);
      }

      const created = await res.json();
      const createdName = created.metadata?.name || 'resource';
      const createdNs = created.metadata?.namespace;

      addToast({ type: 'success', title: `${kind} "${createdName}" created` });

      const gvrUrl = activeGvr.replace(/\//g, '~');
      const detailPath = createdNs ? `/r/${gvrUrl}/${createdNs}/${createdName}` : `/r/${gvrUrl}/_/${createdName}`;
      go(detailPath, createdName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addToast({ type: 'error', title: 'Failed to create resource', detail: msg });
    } finally {
      setCreating(false);
    }
  }, [yaml, activeGvr, kind, creating, selectedNamespace, resourceType, addToast, go]);

  // YAML edit mode — full screen editor
  if (editMode) {
    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setEditMode(false)} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200"><ArrowLeft size={16} /></button>
            <span className="text-sm font-medium text-slate-200">Create {kind}</span>
            <span className="text-xs text-slate-500">{gvrParts.length === 3 ? `${gvrParts[0]}/${gvrParts[1]}` : gvrParts[0]}</span>
          </div>
          <button onClick={handleCreate} disabled={creating || !yaml.trim()} className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md font-medium transition-colors', creating || !yaml.trim() ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white')}>
            <Plus size={12} /> {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
        {error && (
          <div className="flex items-start gap-2 px-4 py-2 bg-red-950/50 border-b border-red-900 text-sm">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-red-300 text-xs flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <YamlEditor value={yaml} onChange={setYaml} onSave={handleCreate} height="100%" />
        </div>
      </div>
    );
  }

  // Picker mode
  const tabs: Array<{ id: CreateTab; label: string; icon: React.ReactNode }> = [
    { id: 'installed', label: 'Installed', icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'operators', label: 'Operators', icon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'deploy', label: 'Quick Deploy', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'helm', label: 'Helm Charts', icon: <Ship className="w-3.5 h-3.5" /> },
    { id: 'templates', label: 'Templates', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'yaml', label: 'Import YAML', icon: <Upload className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-500" />
            Software
          </h1>
          <p className="text-sm text-slate-400 mt-1">Manage installed software, deploy applications, install operators, and create resources</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap', activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === 'installed' && <InstalledTab />}
        {activeTab === 'operators' && (
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-400 animate-spin" /></div>}>
            <OperatorCatalogView />
          </Suspense>
        )}
        {activeTab === 'deploy' && <QuickDeployTab />}
        {activeTab === 'helm' && <HelmTab />}
        {activeTab === 'templates' && (
          <TemplatesTab
            onSelectTemplate={selectTemplate}
            onSelectBlank={selectBlankYaml}
          />
        )}
        {activeTab === 'yaml' && (
          <ImportYamlTab
            onImport={(text) => { setYaml(text); setActiveGvr('v1/pods'); setEditMode(true); }}
          />
        )}
      </div>
    </div>
  );
}

// ===== Installed (Software Inventory) =====
function InstalledTab() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [search, setSearch] = useState('');

  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Fetch Operators (Subscriptions)
  const { data: subscriptions = [] } = useK8sListWatch({
    apiPath: '/apis/operators.coreos.com/v1alpha1/subscriptions',
    namespace: nsFilter,
  });

  // Fetch Helm Releases (secrets with owner=helm label)
  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';
  const { data: helmReleases = [] } = useQuery({
    queryKey: ['helm', 'releases', ns],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/v1/namespaces/${ns}/secrets?labelSelector=owner%3Dhelm`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((s: any) => {
        const name = s.metadata.labels?.['name'] || s.metadata.name;
        const version = s.metadata.labels?.['version'] || '1';
        return {
          name,
          version,
          status: s.metadata.labels?.['status'] || 'unknown',
          namespace: s.metadata.namespace,
        };
      }).filter((r: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.name === r.name) === i);
    },
    refetchInterval: 30000,
  });

  // Fetch Deployments
  const { data: deployments = [] } = useK8sListWatch({
    apiPath: '/apis/apps/v1/deployments',
    namespace: nsFilter,
  });

  // Fetch StatefulSets
  const { data: statefulsets = [] } = useK8sListWatch({
    apiPath: '/apis/apps/v1/statefulsets',
    namespace: nsFilter,
  });

  // Exclude platform namespaces
  const isUserNs = (ns: string) => !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift' && ns !== 'default';

  const userDeployments = (deployments as any[]).filter(d => isUserNs(d.metadata?.namespace || ''));
  const userStatefulSets = (statefulsets as any[]).filter(s => isUserNs(s.metadata?.namespace || ''));
  const userSubscriptions = (subscriptions as any[]).filter(s => {
    const ns = s.metadata?.namespace || '';
    // Keep operator subscriptions — they're intentional installs, even in openshift-* namespaces
    return true;
  });

  // Filter all sections by search
  const q = search.toLowerCase();
  const filteredSubscriptions = q
    ? userSubscriptions.filter((s: any) =>
        s.metadata?.name?.toLowerCase().includes(q) ||
        s.spec?.name?.toLowerCase().includes(q)
      )
    : userSubscriptions;

  const filteredHelmReleases = q
    ? helmReleases.filter((r: any) =>
        r.name?.toLowerCase().includes(q)
      )
    : helmReleases;

  const filteredDeployments = q
    ? userDeployments.filter((d: any) =>
        d.metadata?.name?.toLowerCase().includes(q) ||
        d.metadata?.namespace?.toLowerCase().includes(q)
      )
    : userDeployments;

  const filteredStatefulSets = q
    ? userStatefulSets.filter((s: any) =>
        s.metadata?.name?.toLowerCase().includes(q) ||
        s.metadata?.namespace?.toLowerCase().includes(q)
      )
    : userStatefulSets;

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search installed software..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-900 text-slate-100 border border-slate-800 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Operators Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-400" />
            Operators
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredSubscriptions.length}</span>
          </h3>
          <button
            onClick={() => go('/operatorhub')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {filteredSubscriptions.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No operators installed</p>
        ) : (
          <div className="space-y-2">
            {filteredSubscriptions.slice(0, 5).map((sub: any) => {
              const name = sub.metadata?.name || '';
              const ns = sub.metadata?.namespace || '';
              const channel = sub.spec?.channel || '';
              const installedCSV = sub.status?.installedCSV || '';
              const state = sub.status?.state || '';

              return (
                <div
                  key={`${ns}-${name}`}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => go(`/operatorhub?q=${sub.spec?.name || name}`)}
                      className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                    >
                      {sub.spec?.name || name}
                    </button>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {ns}
                      </span>
                      {channel && (
                        <span className="flex items-center gap-1">
                          <GitBranch className="w-3 h-3" />
                          {channel}
                        </span>
                      )}
                      {installedCSV && (
                        <span className="text-slate-500">{installedCSV}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {state === 'AtLatestKnown' ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : state === 'UpgradePending' ? (
                      <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                </div>
              );
            })}
            {filteredSubscriptions.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredSubscriptions.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* Helm Releases Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Ship className="w-4 h-4 text-blue-400" />
            Helm Releases
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredHelmReleases.length}</span>
          </h3>
        </div>
        {filteredHelmReleases.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No Helm releases installed</p>
        ) : (
          <div className="space-y-2">
            {filteredHelmReleases.slice(0, 5).map((release: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-100">{release.name}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Folder className="w-3 h-3" />
                      {release.namespace}
                    </span>
                    <span className="text-slate-500">v{release.version}</span>
                  </div>
                </div>
                <span className={cn(
                  'text-xs px-2 py-1 rounded',
                  release.status === 'deployed'
                    ? 'bg-green-900/50 text-green-300 border border-green-800'
                    : 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                )}>
                  {release.status}
                </span>
              </div>
            ))}
            {filteredHelmReleases.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredHelmReleases.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* Deployments Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Box className="w-4 h-4 text-blue-400" />
            Deployments
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredDeployments.length}</span>
          </h3>
          <button
            onClick={() => go('/workloads')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {filteredDeployments.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No deployments found</p>
        ) : (
          <div className="space-y-2">
            {filteredDeployments.slice(0, 5).map((deploy: any) => {
              const name = deploy.metadata?.name || '';
              const ns = deploy.metadata?.namespace || '';
              const replicas = deploy.spec?.replicas || 0;
              const available = deploy.status?.availableReplicas || 0;
              const image = deploy.spec?.template?.spec?.containers?.[0]?.image || '';
              const isReady = available === replicas && replicas > 0;

              return (
                <div
                  key={`${ns}-${name}`}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => go(`/r/apps.v1.deployments/${ns}/${name}`)}
                      className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                    >
                      {name}
                    </button>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {ns}
                      </span>
                      {image && (
                        <span className="flex items-center gap-1 truncate">
                          <Image className="w-3 h-3" />
                          {image.split('/').pop()?.split(':')[0] || image}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs px-2 py-1 rounded',
                      isReady
                        ? 'bg-green-900/50 text-green-300 border border-green-800'
                        : 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                    )}>
                      {available}/{replicas}
                    </span>
                    {isReady ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    )}
                  </div>
                </div>
              );
            })}
            {filteredDeployments.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredDeployments.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* StatefulSets Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            StatefulSets
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredStatefulSets.length}</span>
          </h3>
          <button
            onClick={() => go('/workloads')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {filteredStatefulSets.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No statefulsets found</p>
        ) : (
          <div className="space-y-2">
            {filteredStatefulSets.slice(0, 5).map((sts: any) => {
              const name = sts.metadata?.name || '';
              const ns = sts.metadata?.namespace || '';
              const replicas = sts.spec?.replicas || 0;
              const ready = sts.status?.readyReplicas || 0;
              const image = sts.spec?.template?.spec?.containers?.[0]?.image || '';
              const isReady = ready === replicas && replicas > 0;

              return (
                <div
                  key={`${ns}-${name}`}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => go(`/r/apps.v1.statefulsets/${ns}/${name}`)}
                      className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                    >
                      {name}
                    </button>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {ns}
                      </span>
                      {image && (
                        <span className="flex items-center gap-1 truncate">
                          <Image className="w-3 h-3" />
                          {image.split('/').pop()?.split(':')[0] || image}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs px-2 py-1 rounded',
                      isReady
                        ? 'bg-green-900/50 text-green-300 border border-green-800'
                        : 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                    )}>
                      {ready}/{replicas}
                    </span>
                    {isReady ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    )}
                  </div>
                </div>
              );
            })}
            {filteredStatefulSets.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredStatefulSets.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Quick Deploy =====
interface EnvVar { name: string; value: string }

function QuickDeployTab() {
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [port, setPort] = useState('');
  const [replicas, setReplicas] = useState('1');
  const [createRoute, setCreateRoute] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployedApp, setDeployedApp] = useState<{ name: string; ns: string } | null>(null);

  // Environment variables
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const addEnvVar = () => setEnvVars(prev => [...prev, { name: '', value: '' }]);
  const removeEnvVar = (idx: number) => setEnvVars(prev => prev.filter((_, i) => i !== idx));
  const updateEnvVar = (idx: number, field: 'name' | 'value', val: string) =>
    setEnvVars(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  // Resource limits
  const [cpuRequest, setCpuRequest] = useState('');
  const [cpuLimit, setCpuLimit] = useState('');
  const [memRequest, setMemRequest] = useState('');
  const [memLimit, setMemLimit] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';

  const handleDeploy = async () => {
    if (!name.trim() || !image.trim()) {
      addToast({ type: 'error', title: 'Name and image are required' });
      return;
    }
    setDeploying(true);
    try {
      // Build container spec
      const container: any = {
        name: name.trim(),
        image: image.trim(),
      };
      if (port) container.ports = [{ containerPort: parseInt(port) }];

      // Add env vars
      const validEnvVars = envVars.filter(e => e.name.trim());
      if (validEnvVars.length > 0) {
        container.env = validEnvVars.map(e => ({ name: e.name.trim(), value: e.value }));
      }

      // Add resource limits
      const resources: any = {};
      if (cpuRequest || memRequest) {
        resources.requests = {};
        if (cpuRequest) resources.requests.cpu = cpuRequest;
        if (memRequest) resources.requests.memory = memRequest;
      }
      if (cpuLimit || memLimit) {
        resources.limits = {};
        if (cpuLimit) resources.limits.cpu = cpuLimit;
        if (memLimit) resources.limits.memory = memLimit;
      }
      if (Object.keys(resources).length > 0) container.resources = resources;

      // Create Deployment
      const deployment = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: name.trim(), namespace: ns, labels: { app: name.trim() } },
        spec: {
          replicas: parseInt(replicas) || 1,
          selector: { matchLabels: { app: name.trim() } },
          template: {
            metadata: { labels: { app: name.trim() } },
            spec: {
              containers: [container],
            },
          },
        },
      };

      const depRes = await fetch(`${BASE}/apis/apps/v1/namespaces/${ns}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deployment),
      });
      if (!depRes.ok) {
        const err = await depRes.json().catch(() => ({ message: depRes.statusText }));
        throw new Error(err.message);
      }

      // Create Service if port specified
      if (port) {
        const service = {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: name.trim(), namespace: ns, labels: { app: name.trim() } },
          spec: {
            selector: { app: name.trim() },
            ports: [{ port: parseInt(port), targetPort: parseInt(port), protocol: 'TCP' }],
          },
        };
        await fetch(`${BASE}/api/v1/namespaces/${ns}/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(service),
        });

        // Create Route if requested (OpenShift)
        if (createRoute) {
          const route = {
            apiVersion: 'route.openshift.io/v1',
            kind: 'Route',
            metadata: { name: name.trim(), namespace: ns, labels: { app: name.trim() } },
            spec: {
              to: { kind: 'Service', name: name.trim() },
              port: { targetPort: parseInt(port) },
              tls: { termination: 'edge' },
            },
          };
          await fetch(`${BASE}/apis/route.openshift.io/v1/namespaces/${ns}/routes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(route),
          }).catch(() => {}); // Route creation is best-effort
        }
      }

      addToast({ type: 'success', title: `Application "${name}" created`, detail: `Watching rollout in ${ns}` });
      setDeployedApp({ name: name.trim(), ns });
    } catch (err) {
      addToast({ type: 'error', title: 'Deploy failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setDeploying(false);
  };

  return (
    <div className="space-y-6">
      {/* Deploy progress */}
      {deployedApp && (
        <DeployProgress
          type="deployment"
          name={deployedApp.name}
          namespace={deployedApp.ns}
          onClose={() => setDeployedApp(null)}
        />
      )}

      <div className="bg-slate-900 rounded-lg border border-slate-800 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Image className="w-4 h-4 text-blue-400" />
          Deploy from Container Image
        </h2>
        <p className="text-xs text-slate-500">Creates a Deployment, Service, and Route for your application</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Application Name" required value={name} onChange={setName} placeholder="my-app" />
          <FormField label="Container Image" required value={image} onChange={setImage} placeholder="nginx:latest or quay.io/org/image:tag" />
          <FormField label="Container Port" value={port} onChange={setPort} placeholder="8080 (optional — creates Service)" type="number" />
          <FormField label="Replicas" value={replicas} onChange={setReplicas} placeholder="1" type="number" />
        </div>

        {port && (
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={createRoute} onChange={(e) => setCreateRoute(e.target.checked)} className="rounded" />
            Create Route (expose externally via HTTPS)
          </label>
        )}

        {/* Environment Variables */}
        <div className="border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-slate-400">Environment Variables</label>
            <button onClick={addEnvVar} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Variable
            </button>
          </div>
          {envVars.length === 0 && (
            <p className="text-xs text-slate-600">No environment variables configured</p>
          )}
          {envVars.map((env, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-2">
              <input type="text" value={env.name} onChange={(e) => updateEnvVar(idx, 'name', e.target.value)} placeholder="NAME"
                className="flex-1 px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <span className="text-slate-600">=</span>
              <input type="text" value={env.value} onChange={(e) => updateEnvVar(idx, 'value', e.target.value)} placeholder="value"
                className="flex-1 px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={() => removeEnvVar(idx)} className="p-1 text-slate-500 hover:text-red-400" title="Remove">
                <AlertCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Advanced: Resource Limits */}
        <div className="border-t border-slate-800 pt-4">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs font-medium text-slate-400 hover:text-slate-300 flex items-center gap-1">
            {showAdvanced ? '▾' : '▸'} Resource Limits
            {(cpuRequest || cpuLimit || memRequest || memLimit) && <span className="text-blue-400 ml-1">(configured)</span>}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <FormField label="CPU Request" value={cpuRequest} onChange={setCpuRequest} placeholder="100m" />
              <FormField label="CPU Limit" value={cpuLimit} onChange={setCpuLimit} placeholder="500m" />
              <FormField label="Memory Request" value={memRequest} onChange={setMemRequest} placeholder="128Mi" />
              <FormField label="Memory Limit" value={memLimit} onChange={setMemLimit} placeholder="512Mi" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleDeploy} disabled={deploying || !name.trim() || !image.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
            {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Box className="w-4 h-4" />}
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
          <span className="text-xs text-slate-500">Namespace: <span className="text-slate-300">{ns}</span></span>
        </div>
      </div>

      {/* Quick examples */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Examples</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { name: 'nginx', image: 'nginxinc/nginx-unprivileged:latest', port: '8080', desc: 'Nginx web server (non-root)' },
            { name: 'httpd', image: 'registry.access.redhat.com/ubi9/httpd-24:latest', port: '8080', desc: 'Apache HTTP server (UBI)' },
            { name: 'redis', image: 'registry.access.redhat.com/rhel9/redis-7:latest', port: '6379', desc: 'Redis in-memory store (UBI)' },
          ].map((ex) => (
            <button key={ex.name} onClick={() => { setName(ex.name); setImage(ex.image); setPort(ex.port); }}
              className="flex items-start gap-3 p-3 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors text-left">
              <Package className="w-4 h-4 text-blue-400 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-200">{ex.name}</div>
                <div className="text-xs text-slate-500">{ex.desc}</div>
                <div className="text-xs text-slate-600 font-mono mt-1">{ex.image}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Helm Charts =====
interface HelmChart {
  name: string;
  version: string;
  appVersion: string;
  description: string;
  icon?: string;
}

function HelmTab() {
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [releaseName, setReleaseName] = useState('');
  const [selectedChart, setSelectedChart] = useState<HelmChart | null>(null);
  const [installedJob, setInstalledJob] = useState<{ name: string; ns: string } | null>(null);

  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';

  // Fetch Helm releases (secrets with owner=helm)
  const { data: helmReleases = [] } = useQuery({
    queryKey: ['helm', 'releases', ns],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/v1/namespaces/${ns}/secrets?labelSelector=owner%3Dhelm`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((s: any) => {
        const name = s.metadata.labels?.['name'] || s.metadata.name;
        const version = s.metadata.labels?.['version'] || '1';
        return { name, version, status: s.metadata.labels?.['status'] || 'unknown' };
      }).filter((r: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.name === r.name) === i);
    },
    refetchInterval: 30000,
  });

  // Featured charts (curated selection — full catalog requires a Helm repository backend)
  const chartCatalog: HelmChart[] = useMemo(() => [
    { name: 'postgresql', version: '16.4.3', appVersion: '17.4', description: 'PostgreSQL with replication and high availability' },
    { name: 'redis', version: '20.8.0', appVersion: '7.4', description: 'Redis in-memory data store with sentinel support' },
    { name: 'mysql', version: '12.3.0', appVersion: '8.4', description: 'MySQL database with primary-secondary replication' },
    { name: 'mongodb', version: '16.6.0', appVersion: '8.0', description: 'MongoDB NoSQL document database' },
    { name: 'nginx', version: '19.0.0', appVersion: '1.27', description: 'NGINX web server and reverse proxy' },
    { name: 'kafka', version: '31.3.0', appVersion: '3.9', description: 'Apache Kafka distributed event streaming' },
    { name: 'rabbitmq', version: '15.4.0', appVersion: '4.1', description: 'RabbitMQ open-source message broker' },
    { name: 'elasticsearch', version: '22.0.0', appVersion: '8.17', description: 'Elasticsearch distributed search and analytics' },
    { name: 'grafana', version: '8.12.0', appVersion: '11.5', description: 'Grafana observability dashboards' },
    { name: 'prometheus', version: '26.2.0', appVersion: '3.2', description: 'Prometheus monitoring and alerting' },
    { name: 'keycloak', version: '24.4.0', appVersion: '26.1', description: 'Keycloak identity and access management' },
    { name: 'minio', version: '14.10.0', appVersion: '2025', description: 'MinIO S3-compatible object storage' },
  ], []);

  const filteredCharts = search
    ? chartCatalog.filter(c => c.name.includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()))
    : chartCatalog;

  const handleInstall = async () => {
    if (!selectedChart || !releaseName.trim()) return;
    setInstalling(selectedChart.name);
    try {
      // Install via creating a Job that runs `helm install`
      // In a real setup, this would use a Helm operator or backend API
      const job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: `helm-install-${releaseName.trim()}`,
          namespace: ns,
          labels: { app: 'helm-install', chart: selectedChart.name },
        },
        spec: {
          backoffLimit: 0,
          template: {
            spec: {
              restartPolicy: 'Never',
              serviceAccountName: 'default',
              containers: [{
                name: 'helm',
                image: 'alpine/helm:latest',
                command: ['helm', 'install', releaseName.trim(), `oci://registry-1.docker.io/bitnamicharts/${selectedChart.name}`, '--namespace', ns, '--wait', '--timeout', '5m'],
              }],
            },
          },
        },
      };

      const res = await fetch(`${BASE}/apis/batch/v1/namespaces/${ns}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }

      addToast({ type: 'success', title: `Helm install started`, detail: `${selectedChart.name} as "${releaseName}" in ${ns}` });
      setInstalledJob({ name: `helm-install-${releaseName.trim()}`, ns });
      setSelectedChart(null);
      setReleaseName('');
    } catch (err) {
      addToast({ type: 'error', title: 'Helm install failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setInstalling(null);
  };

  return (
    <div className="space-y-6">
      {/* Install progress */}
      {installedJob && (
        <DeployProgress
          type="job"
          name={installedJob.name}
          namespace={installedJob.ns}
          onClose={() => setInstalledJob(null)}
        />
      )}

      {/* Installed releases */}
      {helmReleases.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
          <h3 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
            <Ship className="w-4 h-4 text-blue-400" />
            Installed Releases ({helmReleases.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {helmReleases.map((r: any, i: number) => (
              <span key={i} className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded border border-slate-700 flex items-center gap-2">
                <Ship className="w-3 h-3 text-blue-400" />
                {r.name}
                <span className="text-slate-500">v{r.version}</span>
                <span className={cn('text-xs px-1 py-0.5 rounded', r.status === 'deployed' ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300')}>{r.status}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search charts..." className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Install dialog */}
      {selectedChart && (
        <div className="bg-blue-950/30 rounded-lg border border-blue-800 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-200">Install {selectedChart.name}</h3>
          <p className="text-xs text-slate-400">{selectedChart.description}</p>
          <FormField label="Release Name" required value={releaseName} onChange={setReleaseName} placeholder={`my-${selectedChart.name}`} />
          <div className="flex items-center gap-2">
            <button onClick={handleInstall} disabled={!!installing || !releaseName.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
              {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ship className="w-4 h-4" />}
              {installing ? 'Installing...' : 'Install'}
            </button>
            <button onClick={() => setSelectedChart(null)} className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <span className="text-xs text-slate-500">Namespace: <span className="text-slate-300">{ns}</span></span>
          </div>
        </div>
      )}

      {/* Chart catalog */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-slate-400">Featured Charts</span>
        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">Curated selection</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredCharts.map((chart) => (
          <button key={chart.name} onClick={() => { setSelectedChart(chart); setReleaseName(`my-${chart.name}`); }}
            className="flex items-start gap-3 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-blue-600 transition-colors text-left">
            <Ship className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200">{chart.name}</span>
                <span className="text-xs text-slate-500 font-mono">{chart.version}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1 line-clamp-2">{chart.description}</div>
              {chart.appVersion && <div className="text-xs text-slate-600 mt-1">App: v{chart.appVersion}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ===== Templates =====

// Map snippet prefixes to categories for grouping
const SNIPPET_CATEGORIES: Record<string, { category: string; icon: any; color: string; gvr: string }> = {
  deploy: { category: 'Workloads', icon: Package, color: 'text-blue-400', gvr: 'apps/v1/deployments' },
  cj: { category: 'Workloads', icon: Clock, color: 'text-cyan-400', gvr: 'batch/v1/cronjobs' },
  hpa: { category: 'Workloads', icon: TrendingUp, color: 'text-pink-400', gvr: 'autoscaling/v2/horizontalpodautoscalers' },
  svc: { category: 'Networking', icon: Network, color: 'text-green-400', gvr: 'v1/services' },
  ing: { category: 'Networking', icon: Globe, color: 'text-purple-400', gvr: 'networking.k8s.io/v1/ingresses' },
  np: { category: 'Networking', icon: ShieldCheck, color: 'text-red-400', gvr: 'networking.k8s.io/v1/networkpolicies' },
  cm: { category: 'Config & Storage', icon: FileText, color: 'text-yellow-400', gvr: 'v1/configmaps' },
  secret: { category: 'Config & Storage', icon: Lock, color: 'text-red-400', gvr: 'v1/secrets' },
  pvc: { category: 'Storage', icon: HardDrive, color: 'text-orange-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-rwx': { category: 'Storage', icon: HardDrive, color: 'text-orange-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-block': { category: 'Storage', icon: HardDrive, color: 'text-purple-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-snapshot': { category: 'Storage', icon: HardDrive, color: 'text-blue-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-clone': { category: 'Storage', icon: HardDrive, color: 'text-cyan-400', gvr: 'v1/persistentvolumeclaims' },
  volumesnapshot: { category: 'Storage', icon: HardDrive, color: 'text-green-400', gvr: 'snapshot.storage.k8s.io/v1/volumesnapshots' },
  storageclass: { category: 'Storage', icon: Database, color: 'text-amber-400', gvr: 'storage.k8s.io/v1/storageclasses' },
  ns: { category: 'Access Control', icon: Folder, color: 'text-amber-400', gvr: 'v1/namespaces' },
  sa: { category: 'Access Control', icon: User, color: 'text-teal-400', gvr: 'v1/serviceaccounts' },
  rb: { category: 'Access Control', icon: Shield, color: 'text-indigo-400', gvr: 'rbac.authorization.k8s.io/v1/rolebindings' },
  clusterautoscaler: { category: 'Autoscaling', icon: TrendingUp, color: 'text-green-400', gvr: 'autoscaling.openshift.io/v1/clusterautoscalers' },
  machineautoscaler: { category: 'Autoscaling', icon: TrendingUp, color: 'text-emerald-400', gvr: 'autoscaling.openshift.io/v1beta1/machineautoscalers' },
  'sub-logging': { category: 'Operators', icon: Package, color: 'text-orange-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-loki': { category: 'Operators', icon: Package, color: 'text-purple-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-coo': { category: 'Operators', icon: Package, color: 'text-blue-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-externalsecrets': { category: 'Operators', icon: Lock, color: 'text-red-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-oadp': { category: 'Operators', icon: Package, color: 'text-teal-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-quay': { category: 'Operators', icon: Package, color: 'text-red-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-gitops': { category: 'Operators', icon: GitBranch, color: 'text-orange-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  lokistack: { category: 'Logging', icon: HardDrive, color: 'text-purple-400', gvr: 'loki.grafana.com/v1/lokistacks' },
  clusterlogforwarder: { category: 'Logging', icon: FileText, color: 'text-orange-400', gvr: 'observability.openshift.io/v1/clusterlogforwarders' },
};

const CATEGORY_ORDER = ['Workloads', 'Networking', 'Config & Storage', 'Storage', 'Access Control', 'Autoscaling', 'Operators', 'Logging'];

function TemplatesTab({ onSelectTemplate, onSelectBlank }: {
  onSelectTemplate: (snippet: Snippet, gvr: string) => void;
  onSelectBlank: (gvr: string) => void;
}) {
  const [search, setSearch] = useState('');

  const filteredSnippets = useMemo(() => {
    if (!search.trim()) return snippets;
    const q = search.toLowerCase();
    return snippets.filter(s =>
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.prefix.toLowerCase().includes(q) ||
      (SNIPPET_CATEGORIES[s.prefix]?.category || '').toLowerCase().includes(q)
    );
  }, [search]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, Snippet[]> = {};
    for (const snippet of filteredSnippets) {
      const cat = SNIPPET_CATEGORIES[snippet.prefix]?.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(snippet);
    }
    return CATEGORY_ORDER
      .filter(cat => groups[cat]?.length)
      .map(cat => ({ category: cat, snippets: groups[cat] }))
      .concat(
        Object.keys(groups)
          .filter(cat => !CATEGORY_ORDER.includes(cat))
          .map(cat => ({ category: cat, snippets: groups[cat] }))
      );
  }, [filteredSnippets]);

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates... (e.g., deployment, loki, network policy)"
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="text-xs text-slate-500">{filteredSnippets.length} of {snippets.length} templates</div>

      {grouped.map(({ category, snippets: catSnippets }) => (
        <div key={category}>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{category}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {catSnippets.map((snippet) => {
              const meta = SNIPPET_CATEGORIES[snippet.prefix];
              const Icon = meta?.icon || FileText;
              const color = meta?.color || 'text-slate-400';
              const gvr = meta?.gvr || 'v1/pods';
              return (
                <button key={snippet.prefix} onClick={() => onSelectTemplate(snippet, gvr)}
                  className="flex flex-col items-start gap-2 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors text-left">
                  <Icon className={cn('w-5 h-5', color)} />
                  <div>
                    <div className="text-sm font-medium text-slate-200">{snippet.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{snippet.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {filteredSnippets.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">No templates match "{search}"</div>
      )}

      <div>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Or start from scratch</h2>
        <button onClick={() => onSelectBlank('v1/pods')}
          className="flex items-center gap-3 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors">
          <FileText className="w-5 h-5 text-slate-400" />
          <div className="text-left">
            <div className="text-sm font-medium text-slate-200">Blank YAML</div>
            <div className="text-xs text-slate-500">Start with an empty editor</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ===== Import YAML =====

interface YamlValidation {
  valid: boolean;
  kind?: string;
  apiVersion?: string;
  name?: string;
  errors: string[];
  docCount: number;
}

function validateYaml(text: string): YamlValidation {
  const result: YamlValidation = { valid: false, errors: [], docCount: 0 };
  if (!text.trim()) {
    result.errors.push('Empty input');
    return result;
  }

  // Split on document separators
  const docs = text.split(/^---$/m).filter(d => d.trim());
  result.docCount = docs.length;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i].trim();
    const label = docs.length > 1 ? `Document ${i + 1}: ` : '';

    // Check for JSON
    if (doc.startsWith('{')) {
      try {
        const parsed = JSON.parse(doc);
        if (!parsed.apiVersion) result.errors.push(`${label}Missing apiVersion`);
        if (!parsed.kind) result.errors.push(`${label}Missing kind`);
        if (i === 0) { result.kind = parsed.kind; result.apiVersion = parsed.apiVersion; result.name = parsed.metadata?.name; }
      } catch {
        result.errors.push(`${label}Invalid JSON syntax`);
      }
      continue;
    }

    // YAML validation
    if (!doc.includes(':')) {
      result.errors.push(`${label}Does not look like YAML (no key: value pairs found)`);
      continue;
    }

    // Check indentation consistency
    const lines = doc.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    const hasTabs = lines.some(l => l.startsWith('\t'));
    if (hasTabs) {
      result.errors.push(`${label}YAML uses tabs for indentation (use spaces instead)`);
    }

    // Check required fields
    const hasApiVersion = lines.some(l => /^apiVersion\s*:/.test(l));
    const hasKind = lines.some(l => /^kind\s*:/.test(l));
    if (!hasApiVersion) result.errors.push(`${label}Missing apiVersion`);
    if (!hasKind) result.errors.push(`${label}Missing kind`);

    // Extract metadata for preview
    if (i === 0) {
      const avMatch = doc.match(/^apiVersion\s*:\s*(.+)$/m);
      const kindMatch = doc.match(/^kind\s*:\s*(.+)$/m);
      const nameMatch = doc.match(/^\s+name\s*:\s*(.+)$/m);
      if (avMatch) result.apiVersion = avMatch[1].trim();
      if (kindMatch) result.kind = kindMatch[1].trim();
      if (nameMatch) result.name = nameMatch[1].trim();
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

function ImportYamlTab({ onImport }: { onImport: (yaml: string) => void }) {
  const [text, setText] = useState('');
  const addToast = useUIStore((s) => s.addToast);

  const validation = useMemo(() => text.trim() ? validateYaml(text) : null, [text]);

  const handleValidatedImport = (content: string) => {
    const v = validateYaml(content);
    if (v.valid) {
      onImport(content);
    } else if (v.errors.length > 0 && (content.includes('apiVersion') || content.includes('kind'))) {
      // Has some K8s structure but with issues — let them edit it
      addToast({ type: 'warning', title: 'YAML has issues', detail: v.errors[0] });
      onImport(content);
    } else {
      setText(content);
      addToast({ type: 'error', title: 'Invalid YAML', detail: v.errors[0] || 'Does not appear to be a Kubernetes resource' });
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      handleValidatedImport(clip);
    } catch {
      addToast({ type: 'error', title: 'Clipboard access denied', detail: 'Paste directly into the text area instead' });
    }
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const content = await file.text();
      handleValidatedImport(content);
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={handlePaste} className="flex items-center gap-3 p-6 bg-slate-900 rounded-lg border border-dashed border-slate-700 hover:border-blue-600 transition-colors text-left">
          <Clipboard className="w-6 h-6 text-blue-400" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Paste from Clipboard</div>
            <div className="text-xs text-slate-500 mt-1">Paste a Kubernetes YAML or JSON resource</div>
          </div>
        </button>
        <button onClick={handleUpload} className="flex items-center gap-3 p-6 bg-slate-900 rounded-lg border border-dashed border-slate-700 hover:border-blue-600 transition-colors text-left">
          <Upload className="w-6 h-6 text-purple-400" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Upload File</div>
            <div className="text-xs text-slate-500 mt-1">Upload a .yaml, .yml, or .json file</div>
          </div>
        </button>
      </div>
      <div>
        <label className="text-xs text-slate-400 block mb-1">Or paste YAML here</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="apiVersion: v1&#10;kind: ConfigMap&#10;metadata:&#10;  name: my-config&#10;..." rows={12} className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-600 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />

        {/* Validation feedback */}
        {validation && (
          <div className={cn('mt-2 p-3 rounded-lg border text-xs', validation.valid ? 'bg-green-950/30 border-green-900' : 'bg-red-950/30 border-red-900')}>
            {validation.valid ? (
              <div className="flex items-center gap-2 text-green-300">
                <span>✓</span>
                <span>
                  Valid {validation.kind && <span className="font-medium">{validation.kind}</span>}
                  {validation.apiVersion && <span className="text-green-500 ml-1">({validation.apiVersion})</span>}
                  {validation.name && <span className="text-green-500 ml-1">"{validation.name}"</span>}
                  {validation.docCount > 1 && <span className="text-green-500 ml-1">— {validation.docCount} documents</span>}
                </span>
              </div>
            ) : (
              <div className="space-y-1">
                {validation.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-300">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {text.trim() && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => handleValidatedImport(text)} disabled={!validation?.valid && !text.includes('apiVersion')}
              className={cn('flex items-center gap-1.5 px-4 py-2 text-sm rounded transition-colors',
                validation?.valid ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200')}>
              <Plus className="w-4 h-4" /> {validation?.valid ? 'Open in Editor' : 'Open Anyway'}
            </button>
            {!validation?.valid && validation?.errors.length ? (
              <span className="text-xs text-amber-400">Has {validation.errors.length} issue{validation.errors.length !== 1 ? 's' : ''} — you can still edit</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Shared =====
function FormField({ label, value, onChange, placeholder, required, type }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      <input type={type || 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
    </div>
  );
}
