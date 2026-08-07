import { useState, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Plus, Package, FileText,
  AlertCircle, Box, Loader2, Upload, Puzzle, Ship, ShieldCheck,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { buildApiPath } from '../hooks/useResourceUrl';
import { useNavigateTab } from '../hooks/useNavigateTab';
import YamlEditor from '../components/yaml/YamlEditor';
import { DryRunPanel } from '../components/yaml/DryRunPanel';
import { resolveSnippet, getSnippetSuggestions, type Snippet } from '../components/yaml/SnippetEngine';
import { K8S_BASE as BASE } from '../engine/gvr';
import { showErrorToast } from '../engine/errorToast';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { InstalledTab } from './create/InstalledTab';
import { QuickDeployTab } from './create/QuickDeployTab';
import { HelmTab } from './create/HelmTab';
import { TemplatesTab } from './create/TemplatesTab';
import { ImportYamlTab } from './create/ImportYamlTab';

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
  const [showDryRun, setShowDryRun] = useState(false);

  const initialYamlRef = useRef('');
  const hasYamlChanges = editMode && yaml !== '' && yaml !== initialYamlRef.current;
  const { showConfirm, confirmNavigation, cancelNavigation } = useUnsavedChanges(hasYamlChanges);

  const gvrParts = activeGvr.split('/');
  const resourcePlural = gvrParts[gvrParts.length - 1];
  const resourceType = registry?.get(activeGvr) ?? (activeGvr.split('/').length === 2 ? registry?.get(`core/${activeGvr}`) : undefined);
  const kind = resourceType?.kind || resourcePlural.replace(/s$/, '').replace(/^./, (c) => c.toUpperCase());

  // If we came with a specific GVR (not the default catalog) or ?tab=yaml, go straight to YAML editor
  useMemo(() => {
    if (gvrKey !== 'v1/pods' || urlTab === 'yaml') {
      const shortName = resourcePlural.replace(/s$/, '').toLowerCase();
      const snips = getSnippetSuggestions(shortName);
      if (snips.length > 0) {
        const resolved = resolveSnippet(snips[0]);
        const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';
        const content = resolved.replace(/namespace: default/, `namespace: ${ns}`);
        setYaml(content);
        initialYamlRef.current = content;
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
    const content = resolved.replace(/namespace: default/, `namespace: ${ns}`);
    setYaml(content);
    initialYamlRef.current = content;
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

    const rt = registry?.get(gvr) ?? (parts.length === 2 ? registry?.get(`core/${gvr}`) : undefined);
    const kindName = rt?.kind || plural.replace(/s$/, '').replace(/^./, c => c.toUpperCase());

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
      } catch (err) { console.warn('Failed to fetch CRD schema:', err); }
    }

    const content = [
      `apiVersion: ${apiVersion}`,
      `kind: ${kindName}`,
      'metadata:',
      `  name: my-${kindName.toLowerCase()}`,
      rt?.namespaced !== false ? `  namespace: ${ns}` : null,
      schemaYaml ? `spec:\n${schemaYaml}` : 'spec: {}',
    ].filter(Boolean).join('\n');
    setYaml(content);
    initialYamlRef.current = content;
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
      showErrorToast(err, 'Failed to create resource');
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
            <button onClick={() => { if (window.history.length > 1) window.history.back(); else setEditMode(false); }} className="p-1 rounded-sm hover:bg-slate-700 text-slate-400 hover:text-slate-200" aria-label="Back"><ArrowLeft size={16} /></button>
            <span className="text-sm font-medium text-slate-200">Create {kind}</span>
            <span className="text-xs text-slate-500">{gvrParts.length === 3 ? `${gvrParts[0]}/${gvrParts[1]}` : gvrParts[0]}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDryRun(!showDryRun)}
              disabled={!yaml.trim()}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-colors', !yaml.trim() ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : showDryRun ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300')}
            >
              <ShieldCheck size={12} /> Validate
            </button>
            <button onClick={handleCreate} disabled={creating || !yaml.trim()} className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md font-medium transition-colors', creating || !yaml.trim() ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white')}>
              <Plus size={12} /> {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 px-4 py-2 bg-red-950/50 border-b border-red-900 text-sm">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="text-red-300 text-xs flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <YamlEditor value={yaml} onChange={setYaml} onSave={handleCreate} height="100%" />
        </div>
        {showDryRun && yaml.trim() && (() => {
          const nsMatch = yaml.match(/namespace:\s*(\S+)/);
          const ns = nsMatch?.[1] || (resourceType?.namespaced ? (selectedNamespace !== '*' ? selectedNamespace : 'default') : undefined);
          const dryRunPath = buildApiPath(activeGvr, ns);
          return <DryRunPanel yaml={yaml} apiPath={dryRunPath} method="POST" onClose={() => setShowDryRun(false)} />;
        })()}
        <ConfirmDialog
          open={showConfirm}
          onClose={cancelNavigation}
          onConfirm={confirmNavigation}
          title="Unsaved changes"
          description="You have unsaved changes in the YAML editor. If you leave now, your changes will be lost."
          confirmLabel="Discard changes"
          variant="warning"
        />
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
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1" role="tablist" aria-label="Software tabs">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
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
            onImport={(text) => { setYaml(text); initialYamlRef.current = text; setActiveGvr('v1/pods'); setEditMode(true); }}
          />
        )}
      </div>
    </div>
  );
}
