import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { cn } from '@/lib/utils';

export function CommandBar() {
  const [clusterName, setClusterName] = useState('cluster');
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [showNsDropdown, setShowNsDropdown] = useState(false);
  const [nsFilter, setNsFilter] = useState('');
  const nsInputRef = useRef<HTMLInputElement>(null);

  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const setSelectedNamespace = useUIStore((s) => s.setSelectedNamespace);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  // Fetch cluster name
  useEffect(() => {
    fetch('/api/kubernetes/apis/config.openshift.io/v1/infrastructures/cluster')
      .then((res) => res.json())
      .then((data) => {
        if (data.status?.infrastructureName) {
          setClusterName(data.status.infrastructureName);
        }
      })
      .catch(() => {
        // Fallback to default cluster name
      });
  }, []);

  // Fetch namespaces
  useEffect(() => {
    fetch('/api/kubernetes/api/v1/namespaces')
      .then((res) => res.json())
      .then((data) => {
        if (data.items) {
          const ns = data.items.map((item: any) => item.metadata.name);
          setNamespaces(ns.sort());
        }
      })
      .catch(() => {
        // Ignore errors
      });
  }, []);

  return (
    <div className="flex h-10 items-center justify-between border-b border-slate-700 bg-slate-800 px-4">
      {/* Left: Search input */}
      <button
        onClick={openCommandPalette}
        className="flex h-7 w-80 items-center gap-2 rounded border border-slate-600 bg-slate-900 px-3 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-300"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search anything...</span>
        <kbd className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">⌘K</kbd>
      </button>

      {/* Right: Cluster context and user */}
      <div className="flex items-center gap-4 text-sm">
        {/* Cluster indicator */}
        <div className="flex items-center gap-2 text-slate-300">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium">{clusterName}</span>
        </div>

        {/* Namespace selector */}
        <div className="relative">
          <button
            onClick={() => setShowNsDropdown(!showNsDropdown)}
            className="flex items-center gap-1.5 rounded border border-slate-600 bg-slate-900 px-2.5 py-1 text-slate-300 transition-colors hover:border-slate-500"
          >
            <span className="text-xs">
              {selectedNamespace === '*' ? 'All Namespaces' : selectedNamespace}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {showNsDropdown && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowNsDropdown(false)}
              />

              {/* Dropdown */}
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded border border-slate-600 bg-slate-800 shadow-xl flex flex-col max-h-96">
                {/* Search input */}
                <div className="p-2 border-b border-slate-700">
                  <input
                    ref={nsInputRef}
                    type="text"
                    value={nsFilter}
                    onChange={(e) => setNsFilter(e.target.value)}
                    placeholder="Filter namespaces..."
                    className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div className="overflow-auto">
                  <button
                    onClick={() => {
                      setSelectedNamespace('*');
                      setShowNsDropdown(false);
                      setNsFilter('');
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700',
                      selectedNamespace === '*'
                        ? 'bg-slate-700 text-emerald-400'
                        : 'text-slate-300'
                    )}
                  >
                    All Namespaces
                  </button>
                  {namespaces
                    .filter((ns) => !nsFilter || ns.toLowerCase().includes(nsFilter.toLowerCase()))
                    .map((ns) => (
                      <button
                        key={ns}
                        onClick={() => {
                          setSelectedNamespace(ns);
                          setShowNsDropdown(false);
                          setNsFilter('');
                        }}
                        className={cn(
                          'w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700',
                          selectedNamespace === ns
                            ? 'bg-slate-700 text-emerald-400'
                            : 'text-slate-300'
                        )}
                      >
                        {ns}
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User display */}
        <div className="text-slate-400">admin</div>
      </div>
    </div>
  );
}
