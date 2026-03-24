import React from 'react';
import {
  Download, Upload, XCircle, GitCompare, Loader2, Database,
  CheckCircle, Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../../store/uiStore';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { Panel } from '../../components/primitives/Panel';
import { Card } from '../../components/primitives/Card';
import { type ClusterSnapshot, type DiffRow, loadSnapshots, saveSnapshots, captureSnapshot, compareSnapshots } from '../../engine/snapshot';

export function SnapshotsTab() {
  const addToast = useUIStore((s) => s.addToast);

  const [savedSnapshots, setSavedSnapshots] = React.useState<ClusterSnapshot[]>(loadSnapshots);
  const [capturing, setCapturing] = React.useState(false);
  const [compareLeft, setCompareLeft] = React.useState<string>('');
  const [compareRight, setCompareRight] = React.useState<string>('');
  const [diff, setDiff] = React.useState<DiffRow[] | null>(null);
  const [showOnlyChanges, setShowOnlyChanges] = React.useState(true);

  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string; description: string; confirmLabel: string;
    variant: 'danger' | 'warning'; onConfirm: () => void;
  } | null>(null);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const label = `Snapshot ${savedSnapshots.length + 1}`;
      const snap = await captureSnapshot(label);
      const updated = [snap, ...savedSnapshots].slice(0, 20);
      setSavedSnapshots(updated);
      saveSnapshots(updated);
      addToast({ type: 'success', title: 'Snapshot captured', detail: `v${snap.clusterVersion} \u00b7 ${snap.nodes.count} nodes \u00b7 ${snap.crds.length} CRDs` });
    } catch (err) {
      addToast({ type: 'error', title: 'Capture failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setCapturing(false);
  };

  const handleDeleteSnapshot = (id: string) => {
    const snap = savedSnapshots.find(s => s.id === id);
    if (!snap) return;
    setConfirmDialog({
      title: `Delete snapshot "${snap.label}"?`,
      description: 'This snapshot will be permanently removed. This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        setConfirmDialog(null);
        const updated = savedSnapshots.filter(s => s.id !== id);
        setSavedSnapshots(updated);
        saveSnapshots(updated);
        if (compareLeft === id) { setCompareLeft(''); setDiff(null); }
        if (compareRight === id) { setCompareRight(''); setDiff(null); }
        addToast({ type: 'success', title: 'Snapshot deleted', detail: snap.label });
      },
    });
  };

  const handleExportSnapshot = (snap: ClusterSnapshot) => {
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cluster-snapshot-${snap.timestamp.slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Snapshot exported', detail: snap.label });
  };

  const handleImportSnapshot = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        if (!raw.timestamp || !raw.nodes || !Array.isArray(raw.clusterOperators) || !Array.isArray(raw.crds)) {
          addToast({ type: 'error', title: 'Invalid snapshot format', detail: 'Missing required fields (timestamp, nodes, clusterOperators, crds)' });
          return;
        }
        const snap: ClusterSnapshot = {
          id: raw.id || `snap-${Date.now()}`,
          label: raw.label || file.name.replace('.json', ''),
          timestamp: raw.timestamp,
          clusterVersion: raw.clusterVersion || '',
          platform: raw.platform || '',
          nodes: { count: raw.nodes?.count || 0, versions: raw.nodes?.versions || [] },
          clusterOperators: raw.clusterOperators,
          crds: raw.crds,
          storageClasses: raw.storageClasses || [],
          namespaceCount: raw.namespaceCount || 0,
        };
        const updated = [snap, ...savedSnapshots].slice(0, 20);
        setSavedSnapshots(updated);
        saveSnapshots(updated);
        addToast({ type: 'success', title: 'Snapshot imported', detail: snap.label });
      } catch {
        addToast({ type: 'error', title: 'Invalid snapshot file', detail: 'Could not parse JSON' });
      }
    };
    input.click();
  };

  React.useEffect(() => {
    if (compareLeft && compareRight) {
      const l = savedSnapshots.find(s => s.id === compareLeft);
      const r = savedSnapshots.find(s => s.id === compareRight);
      if (l && r) setDiff(compareSnapshots(l, r));
    } else {
      setDiff(null);
    }
  }, [compareLeft, compareRight, savedSnapshots]);

  const changedCount = diff?.filter(r => r.changed).length ?? 0;
  const displayRows = diff && showOnlyChanges ? diff.filter(r => r.changed) : diff;

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center gap-3">
        <button onClick={handleCapture} disabled={capturing} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
          {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Capture Snapshot
        </button>
        <button onClick={handleImportSnapshot} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded">
          <Upload className="w-3.5 h-3.5" /> Import
        </button>
      </div>

      {/* Saved snapshots */}
      {savedSnapshots.length === 0 ? (
        <Card className="p-12 text-center">
          <GitCompare className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No Snapshots Yet</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Capture a snapshot to record your cluster's current state. Take another after maintenance to see what changed.
          </p>
        </Card>
      ) : (
        <Panel title={`Saved Snapshots (${savedSnapshots.length})`} icon={<Database className="w-4 h-4 text-slate-400" />}>
          <div className="space-y-2">
            {savedSnapshots.map((snap) => (
              <div key={snap.id} className="flex items-center gap-3 p-2 rounded hover:bg-slate-800/50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 font-medium">{snap.label}</div>
                  <div className="text-xs text-slate-500">{new Date(snap.timestamp).toLocaleString()} \u00b7 v{snap.clusterVersion} \u00b7 {snap.nodes.count} nodes \u00b7 {snap.crds.length} CRDs</div>
                </div>
                <select value={compareLeft === snap.id ? 'left' : compareRight === snap.id ? 'right' : ''} onChange={(e) => {
                  if (e.target.value === 'left') { setCompareLeft(snap.id); if (compareRight === snap.id) setCompareRight(''); }
                  else if (e.target.value === 'right') { setCompareRight(snap.id); if (compareLeft === snap.id) setCompareLeft(''); }
                  else { if (compareLeft === snap.id) setCompareLeft(''); if (compareRight === snap.id) setCompareRight(''); }
                }} className="px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-300">
                  <option value="">\u2014</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
                <button onClick={() => handleExportSnapshot(snap)} className="p-1 text-slate-500 hover:text-slate-300" title="Export"><Download className="w-3.5 h-3.5" /></button>
                <button onClick={() => handleDeleteSnapshot(snap.id)} className="p-1 text-slate-500 hover:text-red-400" title="Delete"><XCircle className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Diff table */}
      {diff && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Comparison \u2014 {changedCount} change{changedCount !== 1 ? 's' : ''}</h2>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showOnlyChanges} onChange={(e) => setShowOnlyChanges(e.target.checked)} className="rounded" />
              Show only changes
            </label>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium w-10"></th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Field</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Left</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Right</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(displayRows || []).map((row, idx) => (
                  <tr key={idx} className={row.changed ? 'bg-yellow-950/20' : ''}>
                    <td className="px-4 py-2">
                      {row.changed ? (
                        row.left && !row.right ? <Minus className="w-3.5 h-3.5 text-red-400" /> :
                        !row.left && row.right ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> :
                        <GitCompare className="w-3.5 h-3.5 text-yellow-400" />
                      ) : <CheckCircle className="w-3.5 h-3.5 text-slate-600" />}
                    </td>
                    <td className="px-4 py-2 text-slate-300 font-medium"><span className="text-xs text-slate-500 mr-2">{row.category}</span>{row.field}</td>
                    <td className={cn('px-4 py-2 font-mono text-xs', row.changed ? 'text-red-300' : 'text-slate-400')}>{row.left || '\u2014'}</td>
                    <td className={cn('px-4 py-2 font-mono text-xs', row.changed ? 'text-green-300' : 'text-slate-400')}>{row.right || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirmDialog && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
        />
      )}
    </div>
  );
}
