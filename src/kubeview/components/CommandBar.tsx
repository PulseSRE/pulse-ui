import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, Layers, Bell, User, Server, Plus, LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../store/uiStore';
import { k8sList } from '../engine/query';
import { getPodStatus } from '../engine/renderers/statusUtils';
import { cn } from '@/lib/utils';

export function CommandBar() {
  const navigate = useNavigate();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [showNsDropdown, setShowNsDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [nsFilter, setNsFilter] = useState('');

  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const setSelectedNamespace = useUIStore((s) => s.setSelectedNamespace);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const addTab = useUIStore((s) => s.addTab);

  // Fetch cluster name
  const { data: clusterInfo } = useQuery({
    queryKey: ['toolbar', 'cluster'],
    queryFn: async () => {
      const res = await fetch('/api/kubernetes/apis/config.openshift.io/v1/infrastructures/cluster');
      if (!res.ok) return { name: 'cluster', platform: '' };
      const data = await res.json();
      return {
        name: data.status?.infrastructureName || 'cluster',
        platform: data.status?.platform || data.status?.platformStatus?.type || '',
      };
    },
    staleTime: 300000,
  });

  // Fetch issue count for notification bell
  const { data: issueCount = 0 } = useQuery({
    queryKey: ['toolbar', 'issues'],
    queryFn: async () => {
      const pods = await k8sList<any>('/api/v1/pods');
      return pods.filter((p: any) => {
        const s = getPodStatus(p);
        return s.reason === 'CrashLoopBackOff' || s.reason === 'ImagePullBackOff' || s.phase === 'Failed';
      }).length;
    },
    refetchInterval: 60000,
  });

  // Fetch namespaces
  useEffect(() => {
    fetch('/api/kubernetes/api/v1/namespaces')
      .then((res) => res.json())
      .then((data) => {
        if (data.items) setNamespaces(data.items.map((i: any) => i.metadata.name).sort());
      })
      .catch(() => {});
  }, []);

  function go(path: string, title: string) {
    addTab({ title, path, pinned: false, closable: true });
    navigate(path);
  }

  return (
    <div className="flex h-11 items-center justify-between border-b border-slate-700/50 bg-gradient-to-r from-slate-800 to-slate-800/95 px-4">
      {/* Left section: Logo + Search */}
      <div className="flex items-center gap-4">
        {/* Logo */}
        <button
          onClick={() => navigate('/welcome')}
          className="flex items-center gap-2 group"
          title="Home"
        >
          <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
            <Layers className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors hidden md:inline">
            OpenShift<span className="text-blue-400">View</span>
          </span>
        </button>

        {/* Divider */}
        <div className="h-5 border-l border-slate-700" />

        {/* Search */}
        <button
          onClick={openCommandPalette}
          className="flex h-7 w-72 items-center gap-2 rounded-md border border-slate-600/50 bg-slate-900/50 px-3 text-sm text-slate-500 transition-all hover:border-slate-500 hover:bg-slate-900 hover:text-slate-400"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-xs">Search resources, pages...</span>
          <kbd className="rounded bg-slate-700/70 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">⌘K</kbd>
        </button>

        {/* Quick create */}
        <button
          onClick={() => go('/create/v1~pods', 'Create')}
          className="flex h-7 items-center gap-1.5 rounded-md bg-blue-600/80 hover:bg-blue-600 px-2.5 text-xs font-medium text-white transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span className="hidden lg:inline">Create</span>
        </button>
      </div>

      {/* Right section: Context + Actions */}
      <div className="flex items-center gap-2">
        {/* Cluster indicator */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-900/50 border border-slate-700/50">
          <Server className="w-3 h-3 text-slate-500" />
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-xs text-slate-300 font-medium max-w-[140px] truncate">
            {clusterInfo?.name || 'cluster'}
          </span>
          {clusterInfo?.platform && (
            <span className="text-[10px] text-slate-500 hidden xl:inline">{clusterInfo.platform}</span>
          )}
        </div>

        {/* Namespace selector */}
        <div className="relative">
          <button
            onClick={() => setShowNsDropdown(!showNsDropdown)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition-colors',
              selectedNamespace === '*'
                ? 'border-slate-700/50 bg-slate-900/50 text-slate-400'
                : 'border-blue-700/50 bg-blue-950/30 text-blue-300'
            )}
          >
            <Layers className="w-3 h-3" />
            <span className="text-xs font-medium max-w-[120px] truncate">
              {selectedNamespace === '*' ? 'All Namespaces' : selectedNamespace}
            </span>
            <ChevronDown className="h-3 w-3 text-slate-500" />
          </button>

          {showNsDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setShowNsDropdown(false); setNsFilter(''); }} />
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-600 bg-slate-800 shadow-2xl flex flex-col max-h-96">
                <div className="p-2 border-b border-slate-700">
                  <input
                    type="text"
                    value={nsFilter}
                    onChange={(e) => setNsFilter(e.target.value)}
                    placeholder="Filter namespaces..."
                    className="w-full px-2.5 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div className="overflow-auto py-1">
                  <button
                    onClick={() => { setSelectedNamespace('*'); setShowNsDropdown(false); setNsFilter(''); }}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-700 flex items-center gap-2',
                      selectedNamespace === '*' ? 'text-blue-400' : 'text-slate-300'
                    )}
                  >
                    <Layers className="w-3 h-3 text-slate-500" />
                    All Namespaces
                    {selectedNamespace === '*' && <span className="ml-auto text-xs text-blue-400">✓</span>}
                  </button>
                  {namespaces
                    .filter((ns) => !nsFilter || ns.toLowerCase().includes(nsFilter.toLowerCase()))
                    .map((ns) => (
                      <button
                        key={ns}
                        onClick={() => { setSelectedNamespace(ns); setShowNsDropdown(false); setNsFilter(''); }}
                        className={cn(
                          'w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-700 flex items-center gap-2',
                          selectedNamespace === ns ? 'text-blue-400' : 'text-slate-300'
                        )}
                      >
                        <span className="w-3" />
                        {ns}
                        {selectedNamespace === ns && <span className="ml-auto text-xs text-blue-400">✓</span>}
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Notification bell */}
        <button
          onClick={() => go('/pulse', 'Pulse')}
          className="relative p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
          title={issueCount > 0 ? `${issueCount} issues need attention` : 'No issues'}
        >
          <Bell className="w-4 h-4" />
          {issueCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
              {issueCount > 9 ? '9+' : issueCount}
            </span>
          )}
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center">
              <User className="w-3.5 h-3.5" />
            </div>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-slate-600 bg-slate-800 shadow-2xl py-1">
                <div className="px-3 py-2 border-b border-slate-700">
                  <div className="text-sm font-medium text-slate-200">admin</div>
                  <div className="text-xs text-slate-500">Cluster Administrator</div>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); go('/welcome', 'Welcome'); }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Getting Started
                </button>
                <button
                  onClick={async () => {
                    setShowUserMenu(false);
                    try {
                      const res = await fetch('/api/kubernetes/apis/oauth.openshift.io/v1/oauthaccesstokens?limit=1');
                      if (res.ok) {
                        const text = 'Use "oc whoami -t" to get your API token';
                        navigator.clipboard.writeText(text);
                      }
                    } catch {}
                    addToast({ type: 'success', title: 'Run "oc whoami -t" to get your API token' });
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Copy API Token
                </button>
                <div className="border-t border-slate-700 mt-1 pt-1">
                  <button className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-700 transition-colors flex items-center gap-2">
                    <LogOut className="w-3.5 h-3.5" />
                    Log out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
