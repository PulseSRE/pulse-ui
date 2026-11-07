import { useActiveClusterId } from '../hooks/useClusterBase';
import React, { useState, useEffect, useCallback } from 'react';
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
import { SubpageHeader } from '../components/primitives/SubpageHeader';
import { ReadFailure, onCluster } from '../components/primitives/NotFound';
import { isNotFoundError } from '../engine/readError';
import { listPath, pluralLabel } from '../engine/subpageLinks';
import { kindFromPlural } from '../engine/topologyLinks';
import YamlEditor from '../components/yaml/YamlEditor';
import { DryRunPanel } from '../components/yaml/DryRunPanel';
import { resourceToYaml } from '../engine/yamlUtils';
import { Save, RotateCcw, AlertCircle, ShieldCheck, GitBranch, Lock, Ship } from 'lucide-react';
import { showErrorToast } from '../engine/errorToast';
import { useArgoSyncInfo } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { GitOpsActionDialog } from '../components/GitOpsActionDialog';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { helmReleasePath } from '../engine/helmOwnership';
import { useHelmOwnership, helmOwnerSentence, HelmClaimNote } from '../components/HelmOwnership';
import { SavedConsumersOffer } from './detail/ConfigConsumers';

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

  // Helm awareness: the release overwrites hand edits on its next upgrade or
  // rollback, so the editor stays read-only until the user chooses to edit
  // here anyway.
  // Counted as the release's only if the release lists it (labels can be copied or stale).
  const helm = useHelmOwnership(resource, clusterId);
  const helmOwner = helm.owner;
  const helmRelease = { data: helm.release, isError: !!helm.releaseError };
  const [helmEditAnyway, setHelmEditAnyway] = useState(false);
  const helmLocked = !!helmOwner && !helmEditAnyway;
  // Set after a ConfigMap/Secret save: offers restarting the consumers.
  const [savedConfig, setSavedConfig] = useState(false);

  useEffect(() => {
    if (resource) {
      const yaml = resourceToYaml(resource);
      setOriginalYaml(yaml);
      setCurrentYaml(yaml);
    }
  }, [resource]);

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving || readOnly || helmLocked) return;
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
      if (updated?.kind === 'ConfigMap' || updated?.kind === 'Secret') setSavedConfig(true);
      queryClient.invalidateQueries({ queryKey: ['k8s', 'get', apiPath, clusterId] });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      showErrorToast(err, 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [clusterId, currentYaml, hasChanges, saving, readOnly, helmLocked, name, apiPath, addToast, queryClient]);

  // Every save path — the header button, ⌘S and the diff preview's Apply —
  // goes through here, so an Argo-managed resource always gets the GitOps
  // dialog instead of a direct write that Argo would revert.
  const requestSave = useCallback(() => {
    if (readOnly || !hasChanges || helmLocked) return;
    if (isArgoManaged) setShowGitOpsDialog(true);
    else void handleSave();
  }, [readOnly, hasChanges, helmLocked, isArgoManaged, handleSave]);

  const handleDiscard = useCallback(() => {
    setCurrentYaml(originalYaml);
    setSaveError(null);
  }, [originalYaml]);

  const gvrUrl = gvrKey.replace(/\//g, '~');
  const gvrParts = gvrKey.split('/');
  const kind = gvrParts[gvrParts.length - 1];

  // Build GVK for schema panel — use the actual Kind from the fetched resource (not guessed from plural)
  const actualKind = resource?.kind || kindFromPlural(kind);
  const resourceGvk = gvrParts.length === 3
    ? { group: gvrParts[0], version: gvrParts[1], kind: actualKind }
    : { group: '', version: gvrParts[0], kind: actualKind };

  const header = (actions?: React.ReactNode, meta?: React.ReactNode, missing = false) => (
    <SubpageHeader
      subpage="YAML"
      resource={{ gvrUrl, kind: actualKind, namespace, name }}
      go={go}
      // The cluster the YAML was loaded from, which a save writes to.
      clusterId={clusterId}
      title={`${readOnly ? 'View' : 'Edit'} YAML: ${name}`}
      missing={missing}
      meta={meta}
      actions={actions}
    />
  );

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-slate-950">
        {header()}
        <div className="flex-1 flex items-center justify-center" role="status" aria-label={`Loading ${name}`}>
          <div className="kv-skeleton w-12 h-12 rounded-full" />
        </div>
      </div>
    );
  }

  if (error) {
    const kinds = pluralLabel(actualKind);
    return (
      <div className="flex flex-col h-full bg-slate-950">
        {header(undefined, undefined, isNotFoundError(error))}
        <div className="p-6">
          <ReadFailure
            error={error}
            title={`Could not load ${name}`}
            onRetry={() => { void refetch(); }}
            notFound={{
              what: `${actualKind} ${name}`,
              where: `${onCluster(clusterId)}${namespace ? ` in namespace ${namespace}` : ''}`,
              reason: `It may have been deleted or renamed.`,
              variant: 'inline',
              actions: [
                { label: `Go to ${kinds}${namespace ? ` in ${namespace}` : ''}`, href: listPath(gvrUrl, namespace), onClick: () => go(listPath(gvrUrl, namespace), kinds) },
              ],
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {header(
        !readOnly ? <>
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
            disabled={!hasChanges || saving || clusterChanged || helmLocked}
            title={helmLocked ? `Managed by Helm release ${helmOwner?.release}: choose "Edit here anyway" first` : undefined}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md font-medium transition-colors',
              hasChanges && !clusterChanged && !helmLocked
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            {isArgoManaged ? <GitBranch size={12} /> : <Save size={12} />}
            {saving ? 'Saving...' : isArgoManaged ? 'Save (GitOps)' : 'Save'}
          </button>
        </> : undefined,
        <>
          {readOnly && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 text-slate-400 rounded-sm" title="You do not have permission to update this resource">
              <Lock size={10} aria-hidden="true" /> Read-only
            </span>
          )}
          <span className="text-slate-500">{gvrParts.length === 3 ? `${gvrParts[0]}/${gvrParts[1]}` : gvrParts[0]}</span>
        </>,
      )}

      {clusterChanged && (
        <div role="alert" className="flex items-start gap-2 px-4 py-2 bg-amber-950/40 border-b border-amber-900 text-xs text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            This YAML was loaded from <strong>{clusterName(clusterId)}</strong>; the active cluster is now <strong>{clusterName(activeClusterId)}</strong>. Saving is disabled until you switch back, and the links above open the object on <strong>{clusterName(activeClusterId)}</strong>.
          </span>
        </div>
      )}

      {helm.claimed && helm.verified === false && (
        <div className="px-4 py-2 border-b border-slate-800"><HelmClaimNote claimed={helm.claimed} /></div>
      )}
      {helmOwner && (
        <div role="note" aria-label="Helm ownership" className="px-4 py-3 border-b border-sky-900 bg-sky-950/30 text-xs">
          <div className="flex items-start gap-2">
            <Ship className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 space-y-1">
              <p className="text-sky-100 font-medium">
                Managed by Helm release {helmOwner.release}{helmOwner.namespace !== namespace ? ` (in ${helmOwner.namespace})` : ''}; hand edits are overwritten on the next upgrade.
              </p>
              <p className="text-sky-200/70">
                {helmOwnerSentence(helmOwner, helmRelease.data)}
                {helmRelease.isError && ' The release record could not be read, so its revision and status are unknown.'}
                {' '}A workload-level rollback is reverted by Helm in the same way.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={() => go(helmReleasePath(helmOwner, 'values'), `Helm ${helmOwner.release}`)} className="px-2.5 py-1 rounded-sm bg-sky-700 hover:bg-sky-600 text-white">Edit release values</button>
                <button type="button" onClick={() => go(helmReleasePath(helmOwner, 'rollback'), `Helm ${helmOwner.release}`)} className="px-2.5 py-1 rounded-sm bg-slate-700 hover:bg-slate-600 text-slate-100">Roll back the release…</button>
                {!readOnly && !helmEditAnyway && (
                  <button type="button" onClick={() => setHelmEditAnyway(true)} className="px-2.5 py-1 rounded-sm border border-amber-700 text-amber-300 hover:bg-amber-950/40">Edit here anyway</button>
                )}
              </div>
              {!readOnly && (helmEditAnyway
                ? <p className="text-amber-300" role="alert">Editing here creates drift: the live object no longer matches release {helmOwner.release}, and the next helm upgrade or rollback reverts this edit.</p>
                : <p className="text-slate-400">Read-only until you choose &quot;Edit here anyway&quot;. Editing here creates drift that the next helm upgrade reverts.</p>)}
            </div>
          </div>
        </div>
      )}

      {savedConfig && namespace && (resource?.kind === 'ConfigMap' || resource?.kind === 'Secret') && (
        <SavedConsumersOffer kind={resource.kind} namespace={namespace} name={name} clusterId={clusterId} onRestarted={() => setSavedConfig(false)} />
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
          readOnly={readOnly || helmLocked}
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
