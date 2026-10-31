import { useState, useCallback, useMemo, useRef } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Plus, Package, FileText,
  AlertCircle, Box, Upload, Puzzle, Ship, ShieldCheck, CheckCircle, XCircle,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import YamlEditor from '../components/yaml/YamlEditor';
import { DryRunPanel } from '../components/yaml/DryRunPanel';
import { resolveSnippet, getSnippetSuggestions, type Snippet } from '../components/yaml/SnippetEngine';
import { k8sFetch } from '../engine/query';
import { parseManifest, describeManifest, type ManifestDocument } from '../engine/manifest';
import { useFleetStore } from '../store/fleetStore';
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
const CREATE_TABS: CreateTab[] = ['installed', 'operators', 'deploy', 'helm', 'templates', 'yaml'];

interface CreateResult {
  label: string;
  ok: boolean;
  message?: string;
}



export default function CreateView({ gvrKey }: CreateViewProps) {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const storeNamespace = useUIStore((s) => s.selectedNamespace);
  // `?namespace=<ns>` (e.g. StorageView's "add quota" link) names the target
  // namespace; without it the global selector decides.
  const location = useLocation();
  const urlNamespace = new URLSearchParams(location.search).get('namespace');
  const selectedNamespace = urlNamespace && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(urlNamespace) ? urlNamespace : storeNamespace;
  const registry = useClusterStore((s) => s.resourceRegistry);
  // The cluster this screen shows; creates go there, not to whichever is local.
  const clusterId = useFleetStore((s) => s.activeClusterId);

  // The tab is read from the URL on every render: links within the page
  // (e.g. Installed → "Browse operators", `?tab=operators&q=…`) used to change
  // the URL without switching tabs, because the tab was only read at mount.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as CreateTab | null;
  const activeTab: CreateTab = urlTab && CREATE_TABS.includes(urlTab) ? urlTab : 'installed';
  const setActiveTab = (tab: CreateTab) => {
    if (tab === 'operators') { go('/operators', 'Operators'); return; }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'installed') next.delete('tab'); else next.set('tab', tab);
      next.delete('q');
      return next;
    }, { replace: true });
  };
  const [editMode, setEditMode] = useState(false);
  const [activeGvr, setActiveGvr] = useState(gvrKey);
  const [yaml, setYaml] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDryRun, setShowDryRun] = useState(false);
  const [results, setResults] = useState<CreateResult[] | null>(null);

  const initialYamlRef = useRef('');
  const hasYamlChanges = editMode && yaml !== '' && yaml !== initialYamlRef.current;
  const { showConfirm, confirmNavigation, cancelNavigation } = useUnsavedChanges(hasYamlChanges);

  const gvrParts = activeGvr.split('/');
  const resourcePlural = gvrParts[gvrParts.length - 1];
  const resourceType = registry?.get(activeGvr) ?? (activeGvr.split('/').length === 2 ? registry?.get(`core/${activeGvr}`) : undefined);
  const fallbackKind = resourceType?.kind || resourcePlural.replace(/s$/, '').replace(/^./, (c) => c.toUpperCase());
  const defaultNs = selectedNamespace !== '*' ? selectedNamespace : 'default';
  // What the editor actually holds, parsed structurally: the header, create and
  // validate all follow the documents, not the route the editor was opened from.
  const manifest = useMemo(() => parseManifest(yaml, defaultNs), [yaml, defaultNs]);
  const kind = manifest.documents.length > 0 ? describeManifest(manifest.documents) : fallbackKind;
  const headerGroupVersion = manifest.documents.length === 1
    ? manifest.documents[0].apiVersion
    : manifest.documents.length > 1 ? '' : (gvrParts.length === 3 ? `${gvrParts[0]}/${gvrParts[1]}` : gvrParts[0]);

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
        const crd = await k8sFetch(clusterId, `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${plural}.${group}`).then(r => r.ok ? r.json() : null);
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
    setError(null);
    setResults(null);
    const { documents, errors } = parseManifest(yaml, defaultNs);
    if (errors.length > 0 || documents.length === 0) {
      setError(errors.join('; ') || 'Nothing to create');
      return;
    }
    setCreating(true);
    const outcome: CreateResult[] = [];
    const created: Array<{ doc: ManifestDocument; name: string; namespace?: string }> = [];
    // Each document goes to its own collection, one at a time, and each result
    // is reported; a failure does not hide what was already created.
    for (const doc of documents) {
      const label = `${doc.kind} ${doc.namespace ? `${doc.namespace}/` : ''}${doc.name}`;
      try {
        const res = await k8sFetch(clusterId, doc.createPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc.object),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error(body.message || `${res.status}: ${res.statusText}`);
        }
        const obj = await res.json().catch(() => ({}));
        created.push({ doc, name: obj.metadata?.name || doc.name, namespace: obj.metadata?.namespace || doc.namespace });
        outcome.push({ label, ok: true });
      } catch (err) {
        outcome.push({ label, ok: false, message: err instanceof Error ? err.message : String(err) });
      }
    }
    setCreating(false);

    const failed = outcome.filter((r) => !r.ok);
    if (documents.length === 1 && failed.length === 0) {
      const { doc, name, namespace } = created[0];
      addToast({ type: 'success', title: `${doc.kind} "${name}" created` });
      go(namespace ? `/r/${doc.gvrUrl}/${namespace}/${name}` : `/r/${doc.gvrUrl}/_/${name}`, name);
      return;
    }
    setResults(outcome);
    if (failed.length === 0) {
      addToast({ type: 'success', title: `Created ${outcome.length} resources` });
      initialYamlRef.current = yaml;
    } else {
      const msg = `${failed.length} of ${outcome.length} failed`;
      setError(documents.length === 1 ? failed[0].message ?? msg : msg);
      addToast({ type: 'error', title: documents.length === 1 ? 'Failed to create resource' : `Created ${outcome.length - failed.length} of ${outcome.length} resources`, detail: failed[0].message });
    }
  }, [yaml, defaultNs, creating, addToast, go, clusterId]);

  // YAML edit mode — full screen editor
  if (editMode) {
    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => { if (window.history.length > 1) window.history.back(); else setEditMode(false); }} className="p-1 rounded-sm hover:bg-slate-700 text-slate-400 hover:text-slate-200" aria-label="Back"><ArrowLeft size={16} /></button>
            <span className="text-sm font-medium text-slate-200">Create {kind}</span>
            {headerGroupVersion && <span className="text-xs text-slate-500">{headerGroupVersion}</span>}
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
        {results && (
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900 text-xs space-y-1" data-testid="create-results">
            {results.map((r) => (
              <div key={r.label} className="flex items-start gap-2">
                {r.ok ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
                <span className={r.ok ? 'text-slate-300' : 'text-red-300'}>{r.label}{r.ok ? ' created' : `: ${r.message}`}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <YamlEditor value={yaml} onChange={setYaml} onSave={handleCreate} height="100%" />
        </div>
        {showDryRun && yaml.trim() && (
          manifest.errors.length > 0 ? (
            <div className="border-t border-slate-700 bg-slate-900 px-4 py-3 text-xs text-red-300" role="alert">
              {manifest.errors.join('; ')}
            </div>
          ) : (
            <div className="max-h-[50vh] overflow-auto">
              {manifest.documents.map((doc) => (
                <DryRunPanel
                  key={`${doc.index}-${doc.createPath}-${doc.name}`}
                  title={manifest.documents.length > 1 ? `${doc.kind} ${doc.name}` : undefined}
                  yaml={doc.yaml}
                  apiPath={doc.createPath}
                  method="POST"
                  onClose={() => setShowDryRun(false)}
                />
              ))}
            </div>
          )
        )}
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
        {/* The operator catalog is one page, /operators. Old
            `?tab=operators&q=…` links land there with their search. */}
        {activeTab === 'operators' && (
          <Navigate to={`/operators${searchParams.get('q') ? `?q=${encodeURIComponent(searchParams.get('q')!)}` : ''}`} replace />
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
            onImport={(text) => { setYaml(text); initialYamlRef.current = text; setResults(null); setError(null); setEditMode(true); }}
          />
        )}
      </div>
    </div>
  );
}
