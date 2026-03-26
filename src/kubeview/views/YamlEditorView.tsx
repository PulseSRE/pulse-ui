import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { buildApiPath } from '../hooks/useResourceUrl';
import { getImpersonationHeaders } from '../engine/query';
import YamlEditor from '../components/yaml/YamlEditor';
import { DryRunPanel } from '../components/yaml/DryRunPanel';
import { resourceToYaml } from '../engine/yamlUtils';
import { ArrowLeft, Save, RotateCcw, AlertCircle, ShieldCheck, GitBranch } from 'lucide-react';
import { showErrorToast } from '../engine/errorToast';
import { useArgoSyncInfo } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { GitOpsActionDialog } from '../components/GitOpsActionDialog';

interface YamlEditorViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

export default function YamlEditorView({ gvrKey, namespace, name }: YamlEditorViewProps) {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const apiPath = buildApiPath(gvrKey, namespace, name);
  const fetchUrl = `/api/kubernetes${apiPath}`;

  const { data: resource, isLoading, error } = useQuery({
    queryKey: ['k8s', 'get', apiPath],
    queryFn: async () => {
      const res = await fetch(fetchUrl, { headers: getImpersonationHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
  });

  const [originalYaml, setOriginalYaml] = useState('');
  const [currentYaml, setCurrentYaml] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDryRun, setShowDryRun] = useState(false);
  const [showGitOpsDialog, setShowGitOpsDialog] = useState(false);
  const hasChanges = currentYaml !== originalYaml;

  // ArgoCD awareness
  const argoCDAvailable = useArgoCDStore((s) => s.available);
  const actualKindForArgo = resource?.kind || '';
  const syncInfo = useArgoSyncInfo(actualKindForArgo, namespace, name);
  const isArgoManaged = argoCDAvailable && !!syncInfo;

  useEffect(() => {
    if (resource) {
      const yaml = resourceToYaml(resource);
      setOriginalYaml(yaml);
      setCurrentYaml(yaml);
    }
  }, [resource]);

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Re-inject resourceVersion — stripped by resourceToYaml for clean display,
      // but required by K8s API for update (optimistic concurrency control)
      let yamlToSend = currentYaml;
      const rv = resource?.metadata?.resourceVersion;
      if (rv && !currentYaml.includes('resourceVersion:')) {
        yamlToSend = currentYaml.replace(
          /^(metadata:\n(?:[ \t]+\S.*\n)*)/m,
          `$1  resourceVersion: "${rv}"\n`,
        );
      }

      const res = await fetch(fetchUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/yaml', ...getImpersonationHeaders() },
        body: yamlToSend,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `${res.status}: ${res.statusText}`);
      }
      const updated = await res.json();
      const newYaml = resourceToYaml(updated);
      setOriginalYaml(newYaml);
      setCurrentYaml(newYaml);
      addToast({ type: 'success', title: `${name} saved` });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'get', apiPath] });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      showErrorToast(err, 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [fetchUrl, currentYaml, hasChanges, saving, name, apiPath, addToast, queryClient, resource]);

  const handleDiscard = useCallback(() => {
    setCurrentYaml(originalYaml);
    setSaveError(null);
  }, [originalYaml]);

  const gvrUrl = gvrKey.replace(/\//g, '~');
  const backPath = namespace ? `/r/${gvrUrl}/${namespace}/${name}` : `/r/${gvrUrl}/_/${name}`;
  const gvrParts = gvrKey.split('/');
  const kind = gvrParts[gvrParts.length - 1];

  // Build GVK for schema panel — use the actual Kind from the fetched resource (not guessed from plural)
  const actualKind = resource?.kind || kind.replace(/s$/, '').replace(/^./, c => c.toUpperCase());
  const resourceGvk = gvrParts.length === 3
    ? { group: gvrParts[0], version: gvrParts[1], kind: actualKind }
    : { group: '', version: gvrParts[0], kind: actualKind };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="kv-skeleton w-12 h-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950 text-red-400">
        <AlertCircle className="w-5 h-5 mr-2" />
        Failed to load: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header — same style as CreateView */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => go(backPath, name)} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200">
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-medium text-slate-200">Edit {name}</span>
          <span className="text-xs text-slate-500">{kind} · {gvrParts.length === 3 ? `${gvrParts[0]}/${gvrParts[1]}` : gvrParts[0]}</span>
          {namespace && <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-300 rounded">{namespace}</span>}
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button onClick={handleDiscard} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300">
              <RotateCcw size={12} /> Discard
            </button>
          )}
          {hasChanges && (
            <button
              onClick={() => setShowDryRun(!showDryRun)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-colors', showDryRun ? 'bg-emerald-700 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300')}
            >
              <ShieldCheck size={12} /> Validate
            </button>
          )}
          <button
            onClick={isArgoManaged ? () => setShowGitOpsDialog(true) : handleSave}
            disabled={!hasChanges || saving}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md font-medium transition-colors',
              hasChanges
                ? isArgoManaged ? 'bg-violet-600 hover:bg-violet-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            {isArgoManaged ? <GitBranch size={12} /> : <Save size={12} />}
            {saving ? 'Saving...' : isArgoManaged ? 'Save (GitOps)' : 'Save'}
          </button>
        </div>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-950/50 border-b border-red-900 text-sm">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-red-300 text-xs flex-1">{saveError}</div>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
        </div>
      )}

      {/* Editor with all features */}
      <div className="flex-1 overflow-hidden">
        <YamlEditor
          value={currentYaml}
          onChange={setCurrentYaml}
          onSave={handleSave}
          originalValue={originalYaml}
          showDiff={true}
          height="100%"
          resourceGvk={resourceGvk}
        />
      </div>
      {showDryRun && hasChanges && (
        <DryRunPanel yaml={currentYaml} apiPath={apiPath} method="PUT" onClose={() => setShowDryRun(false)} />
      )}
      {showGitOpsDialog && syncInfo && (
        <GitOpsActionDialog
          open={showGitOpsDialog}
          resourceKind={actualKindForArgo}
          resourceName={name}
          resourceNamespace={namespace}
          yamlContent={currentYaml}
          syncInfo={syncInfo}
          onApply={handleSave}
          onClose={() => setShowGitOpsDialog(false)}
        />
      )}
    </div>
  );
}
