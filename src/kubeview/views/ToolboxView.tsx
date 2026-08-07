import { useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench, List, BarChart3, History,
  Puzzle, Layers, Cable, TrendingUp, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CatalogTab } from './toolbox/CatalogTab';
import { SkillsTab } from './toolbox/SkillsTab';
import { PlansTab } from './toolbox/PlansTab';
import { SLOTab } from './toolbox/SLOTab';
import { ConnectionsTab } from './toolbox/ConnectionsTab';
import { ComponentsTab } from './toolbox/ComponentsTab';
import { UsageTab } from './toolbox/UsageTab';
import { AnalyticsTab } from './toolbox/AnalyticsTab';

type ToolboxTab = 'catalog' | 'skills' | 'plans' | 'slo' | 'connections' | 'components' | 'usage' | 'analytics';

export default function ToolboxView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ToolboxTab)
    || (sessionStorage.getItem('toolbox-tab') as ToolboxTab)
    || 'catalog';
  const [activeTab, setActiveTabState] = useState<ToolboxTab>(initialTab);

  const setActiveTab = (tab: ToolboxTab) => {
    setActiveTabState(tab);
    sessionStorage.setItem('toolbox-tab', tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'catalog') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabs: Array<{ id: ToolboxTab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
    { id: 'catalog', label: 'Catalog', icon: <List className="w-3.5 h-3.5 text-fuchsia-400" />, activeIcon: <List className="w-3.5 h-3.5" /> },
    { id: 'skills', label: 'Skills', icon: <Puzzle className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'plans', label: 'Plans', icon: <Target className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Target className="w-3.5 h-3.5" /> },
    { id: 'slo', label: 'SLOs', icon: <TrendingUp className="w-3.5 h-3.5 text-teal-400" />, activeIcon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: 'connections', label: 'Connections', icon: <Cable className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Cable className="w-3.5 h-3.5" /> },
    { id: 'components', label: 'Components', icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />, activeIcon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'usage', label: 'Usage Log', icon: <History className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <History className="w-3.5 h-3.5" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  const tabIds = tabs.map((t) => t.id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabIds.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabIds.length) % tabIds.length;
    }
    if (nextIndex !== null) {
      e.preventDefault();
      setActiveTab(tabIds[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  }, [tabIds]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-fuchsia-400" />
            Toolbox
          </h1>
          <p className="text-sm text-slate-400 mt-1">Tools, skills, connections, and analytics</p>
        </div>

        <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1" role="tablist" aria-label="Toolbox tabs">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={activeTab === t.id}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => handleTabKeyDown(e, i)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === 'catalog' && <CatalogTab />}
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'plans' && <PlansTab />}
        {activeTab === 'slo' && <SLOTab />}
        {activeTab === 'connections' && <ConnectionsTab />}
        {activeTab === 'components' && <ComponentsTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
