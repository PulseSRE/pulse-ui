import { useLocation, useNavigate } from 'react-router-dom';
import {
  HeartPulse, Package, Globe, Server, HardDrive, Shield, Bell,
  Settings, Activity, Clock, Puzzle, FilePlus, ChevronLeft, ChevronRight,
  Search, Zap,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  path: string;
  icon: any;
  color: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Pulse', path: '/pulse', icon: HeartPulse, color: 'text-blue-400', section: 'Monitor' },
  { label: 'Troubleshoot', path: '/troubleshoot', icon: Zap, color: 'text-orange-400', section: 'Monitor' },
  { label: 'Alerts', path: '/alerts', icon: Bell, color: 'text-red-400', section: 'Monitor' },
  { label: 'Timeline', path: '/timeline', icon: Clock, color: 'text-blue-400', section: 'Monitor' },

  { label: 'Workloads', path: '/workloads', icon: Package, color: 'text-blue-400', section: 'Resources' },
  { label: 'Networking', path: '/networking', icon: Globe, color: 'text-cyan-400', section: 'Resources' },
  { label: 'Compute', path: '/compute', icon: Server, color: 'text-blue-400', section: 'Resources' },
  { label: 'Storage', path: '/storage', icon: HardDrive, color: 'text-orange-400', section: 'Resources' },
  { label: 'Access Control', path: '/access-control', icon: Shield, color: 'text-indigo-400', section: 'Resources' },

  { label: 'Operators', path: '/operatorhub', icon: Puzzle, color: 'text-violet-400', section: 'Manage' },
  { label: 'Administration', path: '/admin', icon: Settings, color: 'text-slate-400', section: 'Manage' },
  { label: 'Create', path: '/create/v1~pods', icon: FilePlus, color: 'text-amber-400', section: 'Manage' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const addTab = useUIStore((s) => s.addTab);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  function go(path: string, title: string) {
    addTab({ title, path, pinned: false, closable: true });
    navigate(path);
  }

  const isActive = (path: string) => {
    if (path === '/pulse' && location.pathname === '/') return true;
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  // Group by section
  const sections: Array<{ title: string; items: NavItem[] }> = [];
  for (const item of NAV_ITEMS) {
    const section = item.section || 'Other';
    let group = sections.find(s => s.title === section);
    if (!group) {
      group = { title: section, items: [] };
      sections.push(group);
    }
    group.items.push(item);
  }

  return (
    <div className={cn(
      'flex flex-col bg-slate-900/50 border-r border-slate-800 transition-all duration-200 shrink-0',
      collapsed ? 'w-12' : 'w-48'
    )}>
      {/* Search shortcut */}
      <button
        onClick={openCommandPalette}
        className={cn(
          'flex items-center gap-2 mx-2 mt-2 mb-1 px-2 py-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors',
          collapsed && 'justify-center mx-1'
        )}
        title="Search (⌘K)"
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        {!collapsed && <span className="text-xs">Search</span>}
        {!collapsed && <kbd className="ml-auto text-[10px] text-slate-600 font-mono">⌘K</kbd>}
      </button>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {sections.map((section) => (
          <div key={section.title} className="mb-2">
            {!collapsed && (
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => go(item.path, item.label)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors',
                    collapsed && 'justify-center px-0',
                    active
                      ? 'text-white bg-blue-600/20 border-r-2 border-blue-500'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-blue-400' : item.color)} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center py-2 border-t border-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
