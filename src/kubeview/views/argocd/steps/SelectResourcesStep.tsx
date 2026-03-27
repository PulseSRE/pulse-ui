import React, { useState, useEffect, useMemo } from 'react';
import { Package, Search, ArrowRight, GitPullRequest, GitCommit, Loader2 } from 'lucide-react';
import { useGitOpsSetupStore } from '../../../store/gitopsSetupStore';
import { useClusterStore } from '../../../store/clusterStore';
import { k8sList, k8sGet } from '../../../engine/query';
import { RESOURCE_CATEGORIES, isUserNamespace } from '../../../engine/gitopsExport';
import type { K8sResource } from '../../../engine/renderers/index';
import { cn } from '@/lib/utils';

interface Props {
  onComplete: () => void;
}

export function SelectResourcesStep({ onComplete }: Props) {
  const { exportSelections, setExportSelections, markStepComplete } = useGitOpsSetupStore();
  const clusterVersion = useClusterStore((s) => s.clusterVersion);

  const [clusterName, setClusterName] = useState(exportSelections.clusterName || '');
  const [categoryIds, setCategoryIds] = useState<string[]>(exportSelections.categoryIds);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(exportSelections.namespaces);
  const [exportMode, setExportMode] = useState<'pr' | 'direct'>(exportSelections.exportMode);
  const [nsSearch, setNsSearch] = useState('');
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const [loadingNs, setLoadingNs] = useState(true);

  // Auto-detect cluster name from ClusterVersion
  useEffect(() => {
    if (clusterName) return;
    (async () => {
      try {
        const cv = await k8sGet<K8sResource>('/apis/config.openshift.io/v1/clusterversions/version');
        const id = cv.spec?.clusterID as string;
        if (id) setClusterName(id.slice(0, 8));
      } catch {
        // Fall back to cluster version string
        if (clusterVersion) {
          setClusterName(`ocp-${clusterVersion.replace(/\./g, '-')}`);
        }
      }
    })();
  }, [clusterName, clusterVersion]);

  // Fetch namespaces
  useEffect(() => {
    (async () => {
      setLoadingNs(true);
      try {
        const nsList = await k8sList<K8sResource>('/api/v1/namespaces');
        const userNs = nsList
          .map((ns) => ns.metadata.name)
          .filter(isUserNamespace)
          .sort();
        setAllNamespaces(userNs);
        // Pre-select all if none selected
        if (selectedNamespaces.length === 0) {
          setSelectedNamespaces(userNs);
        }
      } catch {
        setAllNamespaces([]);
      }
      setLoadingNs(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredNamespaces = useMemo(() => {
    if (!nsSearch) return allNamespaces;
    const lower = nsSearch.toLowerCase();
    return allNamespaces.filter((ns) => ns.toLowerCase().includes(lower));
  }, [allNamespaces, nsSearch]);

  const toggleCategory = (id: string) => {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const toggleNamespace = (ns: string) => {
    setSelectedNamespaces((prev) =>
      prev.includes(ns) ? prev.filter((n) => n !== ns) : [...prev, ns],
    );
  };

  const selectAllNamespaces = () => setSelectedNamespaces([...allNamespaces]);
  const clearAllNamespaces = () => setSelectedNamespaces([]);

  const canContinue = clusterName.trim() && categoryIds.length > 0 && selectedNamespaces.length > 0;

  const handleContinue = () => {
    setExportSelections({
      clusterName: clusterName.trim(),
      categoryIds,
      namespaces: selectedNamespaces,
      exportMode,
    });
    markStepComplete('select-resources');
    onComplete();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-slate-100">Select Resources to Export</h3>
        <p className="text-sm text-slate-400 mt-1">
          Choose which cluster resources to export to your Git repository.
        </p>
      </div>

      {/* Cluster name */}
      <div>
        <label className="text-xs text-slate-400 block mb-1">Cluster Name</label>
        <input
          type="text"
          value={clusterName}
          onChange={(e) => setClusterName(e.target.value)}
          placeholder="my-cluster"
          className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none"
        />
        <p className="text-xs text-slate-500 mt-1">Used as the folder name in your Git repository.</p>
      </div>

      {/* Resource categories */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">Resource Categories</label>
        <div className="grid grid-cols-2 gap-3">
          {RESOURCE_CATEGORIES.map((cat) => {
            const selected = categoryIds.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className={cn(
                  'p-3 rounded-lg border text-left transition-colors',
                  selected
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={selected}
                    readOnly
                    className="accent-violet-500"
                  />
                  <Package className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                </div>
                <p className="text-xs text-slate-500 ml-6">
                  {cat.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Namespace picker */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-slate-400">
            Namespaces ({selectedNamespaces.length} of {allNamespaces.length} selected)
          </label>
          <div className="flex gap-2">
            <button onClick={selectAllNamespaces} className="text-xs text-blue-400 hover:text-blue-300">
              Select all
            </button>
            <button onClick={clearAllNamespaces} className="text-xs text-slate-500 hover:text-slate-400">
              Clear
            </button>
          </div>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={nsSearch}
            onChange={(e) => setNsSearch(e.target.value)}
            placeholder="Search namespaces..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none"
          />
        </div>
        <div className="max-h-40 overflow-y-auto border border-slate-700 rounded bg-slate-800/50 p-1.5 space-y-0.5">
          {loadingNs ? (
            <div className="flex items-center gap-2 p-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading namespaces...
            </div>
          ) : filteredNamespaces.length === 0 ? (
            <p className="text-sm text-slate-500 p-2">No namespaces found</p>
          ) : (
            filteredNamespaces.map((ns) => (
              <label
                key={ns}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedNamespaces.includes(ns)}
                  onChange={() => toggleNamespace(ns)}
                  className="accent-violet-500"
                />
                <span className="text-sm text-slate-300">{ns}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Export mode */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">Export Mode</label>
        <div className="flex gap-3">
          <button
            onClick={() => setExportMode('pr')}
            className={cn(
              'flex-1 flex items-center gap-2 p-3 rounded-lg border text-left transition-colors',
              exportMode === 'pr'
                ? 'border-violet-500 bg-violet-500/10'
                : 'border-slate-700 bg-slate-800/50 hover:border-slate-600',
            )}
          >
            <GitPullRequest className={cn('w-4 h-4', exportMode === 'pr' ? 'text-violet-400' : 'text-slate-500')} />
            <div>
              <div className="text-sm font-medium text-slate-200">Pull Request</div>
              <div className="text-xs text-slate-500">Create a branch and open a PR for review</div>
            </div>
          </button>
          <button
            onClick={() => setExportMode('direct')}
            className={cn(
              'flex-1 flex items-center gap-2 p-3 rounded-lg border text-left transition-colors',
              exportMode === 'direct'
                ? 'border-violet-500 bg-violet-500/10'
                : 'border-slate-700 bg-slate-800/50 hover:border-slate-600',
            )}
          >
            <GitCommit className={cn('w-4 h-4', exportMode === 'direct' ? 'text-violet-400' : 'text-slate-500')} />
            <div>
              <div className="text-sm font-medium text-slate-200">Direct Commit</div>
              <div className="text-xs text-slate-500">Commit directly to the base branch</div>
            </div>
          </button>
        </div>
      </div>

      <button
        onClick={handleContinue}
        disabled={!canContinue}
        className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        <ArrowRight className="w-4 h-4" />
        Continue
      </button>
    </div>
  );
}
