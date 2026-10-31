import { useActiveClusterId } from '../hooks/useClusterBase';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { buildApiPath } from '../hooks/useResourceUrl';
import { k8sFetch, k8sGet } from '../engine/query';
import { getActiveClusterId } from '../engine/clusterConnection';
import { clusterChangedMessage, clusterDisplayName as clusterName } from '../engine/pendingCluster';
import type { K8sResource } from '../engine/renderers';
import { useCanI } from '../hooks/useCanI';
import { LoadError } from '../components/primitives/LoadError';
import YamlEditor from '../components/yaml/YamlEditor';
import { DryRunPanel } from '../components/yaml/DryRunPanel';
import { resourceToYaml } from '../engine/yamlUtils';
import { ArrowLeft, Save, RotateCcw, AlertCircle, ShieldCheck, GitBranch, Lock } from 'lucide-react';
import { showErrorToast } from '../engine/errorToast';
import { useArgoSyncInfo } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { GitOpsActionDialog } from '../components/GitOpsActionDialog';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';

interface YamlEditorViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

export default function YamlEditorView({ gvrKey, namespace, name }: YamlEditorViewProps) {
  // Pin the cluster when the editor opens. The YAML on screen belongs to this
  // cluster; saving it anywhere else would overwrite a different object.
  const [clusterId] = useState(() => getActiveClusterId());
  const activeClusterId = useActiveClusterId();
  const clusterChanged = activeClusterId !== clusterId;
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const apiPath = buildApiPath(gvrKey, namespace, name);
  const gvrSegments = gvrKey.split('/');
  // Read-only users can still open the YAML; they just cannot save it.
  const { allowed: canUpdate } = useCanI('update', gvrSegments.length === 3 ? gvrSegments[0] : '', gvrSegments[gvrSegments.length - 1], namespace);
  const readOnly = !canUpdate;

  const { data: resource, isLoading, error, refetch } = useQuery({
    // The cluster is part of the key: another cluster's cached copy must never be shown, or saved over.
    queryKey: ['k8s', 'get', apiPath, clusterId],
    queryFn: () => k8sGet<K8sResource>(apiPath, clusterId),
  });

  const [originalYaml, setOriginalYaml] = useState('');
  const [currentYaml, setCurrentYaml] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDryRun, setShowDryRun] = useState(false);
  const [showGitOpsDialog, setShowGitOpsDialog] = useState(false);
  const hasChanges = currentYaml !== originalYaml;

  const { showConfirm, confirmNavigation, cancelNavigation } = useUnsavedChanges(hasChanges);

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
    if (!hasChanges || saving || readOnly) return;
    // Read the live registry, not render state: the switch may have happened
    // after this callback was created.
    const active = getActiveClusterId();
    if (active !== clusterId) {
      setSaveError(clusterChangedMessage(clusterId, active, 'Saving this YAML'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await k8sFetch(clusterId, apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/yaml' },
        body: currentYaml,
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
      queryClient.invalidateQueries({ queryKey: ['k8s', 'get', apiPath, clusterId] });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      showErrorToast(err, 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [clusterId, currentYaml, hasChanges, saving, readOnly, name, apiPath, addToast, queryClient]);

  // Every save path — the header button, ⌘S and the diff preview's Apply —
  // goes through here, so an Argo-managed resource always gets the GitOps
  // dialog instead of a direct write that Argo would revert.
  const requestSave = useCallback(() => {
    if (readOnly || !hasChanges) return;
    if (isArgoManaged) setShowGitOpsDialog(true);
    else void handleSave();
  }, [readOnly, hasChanges, isArgoManaged, handleSave]);

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
      <div className="h-full bg-slate-950 p-6 space-y-3">
        <LoadError title={`Could not load ${name}`} error={error} onRetry={() => refetch()} />
        <button onClick={() => go(backPath, name)} className="text-xs text-blue-400 hover:text-blue-300">Back to {name}</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header — same style as CreateView */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => go(backPath, name)} className="p-1 rounded-sm hover:bg-slate-700 text-slate-400 hover:text-slate-200" aria-label="Go back">
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-medium text-slate-200">{readOnly ? 'View' : 'Edit'} {name}</span>
          {readOnly && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-slate-800 text-slate-400 rounded-sm" title="You do not have permission to update this resource">
              <Lock size={10} /> Read-only
            </span>
          )}
          <span className="text-xs text-slate-500">{kind} · {gvrParts.length === 3 ? `${gvrParts[0]}/${gvrParts[1]}` : gvrParts[0]}</span>
          {namespace && <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-300 rounded-sm">{namespace}</span>}
        </div>
        {!readOnly && <div className="flex items-center gap-2">
          {hasChanges && (
            <button onClick={handleDiscard} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-sm bg-slate-700 hover:bg-slate-600 text-slate-300">
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
            onClick={requestSave}
            disabled={!hasChanges || saving || clusterChanged}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md font-medium transition-colors',
              hasChanges && !clusterChanged
                ? isArgoManaged ? 'bg-violet-600 hover:bg-violet-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            {isArgoManaged ? <GitBranch size={12} /> : <Save size={12} />}
            {saving ? 'Saving...' : isArgoManaged ? 'Save (GitOps)' : 'Save'}
          </button>
        </div>}
      </div>

      {clusterChanged && (
        <div role="alert" className="flex items-start gap-2 px-4 py-2 bg-amber-950/40 border-b border-amber-900 text-xs text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            This YAML was loaded from <strong>{clusterName(clusterId)}</strong>; the active cluster is now <strong>{clusterName(activeClusterId)}</strong>. Saving is disabled until you switch back.
          </span>
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-950/50 border-b border-red-900 text-sm">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="text-red-300 text-xs flex-1">{saveError}</div>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
        </div>
      )}

      {/* Editor with all features */}
      <div className="flex-1 overflow-hidden">
        <YamlEditor
          value={currentYaml}
          onChange={setCurrentYaml}
          onSave={requestSave}
          readOnly={readOnly}
          hideStatusBarSave
          originalValue={originalYaml}
          showDiff={true}
          height="100%"
          resourceGvk={resourceGvk}
        />
      </div>
      {showDryRun && hasChanges && (
        <DryRunPanel yaml={currentYaml} apiPath={apiPath} method="PUT" clusterId={clusterId} onClose={() => setShowDryRun(false)} />
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
