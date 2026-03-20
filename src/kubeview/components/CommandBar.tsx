import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, Layers, Bell, User, Server, Plus, LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../store/uiStore';
import { useClusterStore } from '../store/clusterStore';
import { k8sList } from '../engine/query';
import { getPodStatus } from '../engine/renderers/statusUtils';
import { cn } from '@/lib/utils';

export function CommandBar() {
  const navigate = useNavigate();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [showNsDropdown, setShowNsDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [nsFilter, setNsFilter] = useState('');
  const [showImpersonateInput, setShowImpersonateInput] = useState(false);
  const [impersonateInput, setImpersonateInput] = useState('');
  const impersonateUser = useUIStore((s) => s.impersonateUser);

  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const setSelectedNamespace = useUIStore((s) => s.setSelectedNamespace);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const addTab = useUIStore((s) => s.addTab);
  const addToast = useUIStore((s) => s.addToast);

  // Fetch cluster name and user identity
  const { data: clusterInfo } = useQuery({
    queryKey: ['toolbar', 'cluster'],
    queryFn: async () => {
      const [infraRes, userRes] = await Promise.allSettled([
        fetch('/api/kubernetes/apis/config.openshift.io/v1/infrastructures/cluster'),
        fetch('/api/kubernetes/apis/user.openshift.io/v1/users/~'),
      ]);
      let name = 'cluster', platform = '', controlPlaneTopology = '';
      if (infraRes.status === 'fulfilled' && infraRes.value.ok) {
        const data = await infraRes.value.json();
        name = data.status?.infrastructureName || 'cluster';
        platform = data.status?.platform || data.status?.platformStatus?.type || '';
        controlPlaneTopology = data.status?.controlPlaneTopology || '';
      }
      let username = 'admin', role = 'Cluster Administrator';
      if (userRes.status === 'fulfilled' && userRes.value.ok) {
        const userData = await userRes.value.json();
        username = userData.metadata?.name || 'admin';
        const groups = userData.groups || [];
        role = groups.includes('cluster-admins') || groups.includes('system:cluster-admins')
          ? 'Cluster Administrator' : 'User';
      }
      // Populate cluster store with topology info
      useClusterStore.getState().setClusterInfo({ platform, controlPlaneTopology });
      return { name, platform, username, role, controlPlaneTopology };
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
          <svg className="w-6 h-6 shrink-0" viewBox="0 0 32 32">
            <defs><linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2563eb"/><stop offset="100%" stopColor="#1d4ed8"/></linearGradient></defs>
            <rect width="32" height="32" rx="8" fill="url(#logo-g)"/>
            <text x="7" y="24" fontFamily="system-ui,-apple-system,sans-serif" fontWeight="800" fontSize="22" fill="white">P</text>
            <path d="M23 5l0.8-2.4L26.2 2l-2.4-0.8L23-1.2 22.2 1.2 19.8 2l2.4 0.8Z" fill="#93c5fd"/>
            <path d="M27 9l0.5-1.5L29 7l-1.5-0.5L27 5l-0.5 1.5L25 7l1.5 0.5Z" fill="#93c5fd" opacity="0.7"/>
          </svg>
          <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors hidden md:inline">
            OpenShift<span className="text-blue-400"> Pulse</span>
          </span>
        </button>

        {/* Divider */}
        <div className="h-5 border-l border-slate-700" />

        {/* Search */}
        <button
          onClick={openCommandPalette}
          className="flex h-7 w-48 md:w-72 items-center gap-2 rounded-md border border-slate-600/50 bg-slate-900/50 px-3 text-sm text-slate-500 transition-all hover:border-slate-500 hover:bg-slate-900 hover:text-slate-400"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-xs">Search resources, pages...</span>
          <kbd className="rounded bg-slate-700/70 px-1.5 py-0.5 text-xs font-mono text-slate-400">⌘K</kbd>
        </button>

        {/* Quick create */}
        <button
          onClick={() => go('/create/v1~pods', 'Software')}
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
            <span className="text-xs text-slate-500 hidden xl:inline">{clusterInfo.platform}</span>
          )}
        </div>

        {/* Namespace selector — compact inline with keyboard shortcut */}
        <div className="relative">
          <button
            onClick={() => setShowNsDropdown(!showNsDropdown)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors h-7',
              selectedNamespace === '*'
                ? 'border-slate-700/50 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                : 'border-blue-600/50 bg-blue-950/40 text-blue-300 hover:border-blue-500'
            )}
            title="Switch namespace (⌘N)"
          >
            <Layers className="w-3 h-3" />
            <span className="text-xs font-medium max-w-[130px] truncate">
              {selectedNamespace === '*' ? 'All' : selectedNamespace}
            </span>
            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
          </button>

          {showNsDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setShowNsDropdown(false); setNsFilter(''); }} onKeyDown={(e) => { if (e.key === 'Escape') { setShowNsDropdown(false); setNsFilter(''); } }} />
              <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-600 bg-slate-800 shadow-2xl flex flex-col max-h-[420px]">
                <div className="p-2 border-b border-slate-700">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={nsFilter}
                      onChange={(e) => setNsFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setShowNsDropdown(false); setNsFilter(''); }
                        if (e.key === 'Enter') {
                          const filtered = namespaces.filter((ns) => !nsFilter || ns.toLowerCase().includes(nsFilter.toLowerCase()));
                          if (filtered.length === 1) { setSelectedNamespace(filtered[0]); setShowNsDropdown(false); setNsFilter(''); }
                        }
                      }}
                      placeholder="Type to filter..."
                      className="w-full pl-8 pr-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="overflow-auto py-1">
                  <button
                    onClick={() => { setSelectedNamespace('*'); setShowNsDropdown(false); setNsFilter(''); }}
                    className={cn('w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-700 flex items-center gap-2', selectedNamespace === '*' ? 'text-blue-400 bg-blue-950/30' : 'text-slate-300')}
                  >
                    <Layers className="w-3.5 h-3.5 text-slate-500" />
                    <span className="flex-1">All Namespaces</span>
                    <span className="text-xs text-slate-500">{namespaces.length} total</span>
                    {selectedNamespace === '*' && <span className="text-blue-400 text-xs">✓</span>}
                  </button>
                  <div className="border-t border-slate-700/50 my-1" />
                  {namespaces
                    .filter((ns) => !nsFilter || ns.toLowerCase().includes(nsFilter.toLowerCase()))
                    .map((ns) => (
                      <button
                        key={ns}
                        onClick={() => { setSelectedNamespace(ns); setShowNsDropdown(false); setNsFilter(''); }}
                        className={cn('w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-700 flex items-center gap-2', selectedNamespace === ns ? 'text-blue-400 bg-blue-950/30' : 'text-slate-300')}
                      >
                        <span className="w-3.5" />
                        <span className="flex-1 truncate">{ns}</span>
                        {selectedNamespace === ns && <span className="text-blue-400 text-xs">✓</span>}
                      </button>
                    ))}
                  {nsFilter && namespaces.filter((ns) => ns.toLowerCase().includes(nsFilter.toLowerCase())).length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-slate-500">No namespaces match "{nsFilter}"</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Notification bell */}
        <button
          onClick={() => go('/alerts', 'Alerts')}
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
                  <div className="text-sm font-medium text-slate-200">{clusterInfo?.username || 'admin'}</div>
                  <div className="text-xs text-slate-500">{clusterInfo?.role || 'Cluster Administrator'}</div>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); go('/welcome', 'Welcome'); }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Getting Started
                </button>
                <button
                  onClick={() => { setShowUserMenu(false); go('/users', 'Users'); }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  User Management
                </button>
                {impersonateUser ? (
                  <button
                    onClick={() => {
                      useUIStore.getState().clearImpersonation();
                      addToast({ type: 'success', title: 'Impersonation cleared' });
                      setShowUserMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-amber-400 hover:bg-slate-700 transition-colors"
                  >
                    Stop impersonating {impersonateUser}
                  </button>
                ) : showImpersonateInput ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <input
                      type="text"
                      value={impersonateInput}
                      onChange={(e) => setImpersonateInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && impersonateInput.trim()) {
                          useUIStore.getState().setImpersonation(impersonateInput.trim());
                          addToast({ type: 'warning', title: `Impersonating ${impersonateInput.trim()}`, detail: 'All API requests now use this identity' });
                          setShowImpersonateInput(false);
                          setImpersonateInput('');
                          setShowUserMenu(false);
                        }
                        if (e.key === 'Escape') { setShowImpersonateInput(false); setImpersonateInput(''); }
                      }}
                      placeholder="username or system:serviceaccount:ns:name"
                      className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="text-xs text-slate-500">Enter to apply, Esc to cancel</div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowImpersonateInput(true)}
                    className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Impersonate User
                  </button>
                )}
                <button
                  onClick={async () => {
                    setShowUserMenu(false);
                    // Use the API server URL from cluster info, fallback to current origin
                    let server = window.location.origin;
                    try {
                      const infraRes = await fetch('/api/kubernetes/apis/config.openshift.io/v1/infrastructures/cluster');
                      if (infraRes.ok) {
                        const infraData = await infraRes.json();
                        server = infraData.status?.apiServerURL || server;
                      }
                    } catch {}
                    const loginCmd = `oc login --server=${server}`;
                    try {
                      await navigator.clipboard.writeText(loginCmd);
                      addToast({ type: 'success', title: 'Login command copied', detail: loginCmd });
                    } catch {
                      addToast({ type: 'success', title: 'Copy this command:', detail: loginCmd });
                    }
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Copy Login Command
                </button>
                <div className="border-t border-slate-700 mt-1 pt-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      window.location.href = '/oauth/sign_out';
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-700 transition-colors flex items-center gap-2"
                  >
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
