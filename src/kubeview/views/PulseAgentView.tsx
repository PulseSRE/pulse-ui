import { useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot, List, BarChart3, History,
  Puzzle, Layers, Cable, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OverviewTab } from './pulse-agent/OverviewTab';
import { CatalogTab } from './toolbox/CatalogTab';
import { SkillsTab } from './toolbox/SkillsTab';
import { PlansTab } from './toolbox/PlansTab';
import { ConnectionsTab } from './toolbox/ConnectionsTab';
import { ComponentsTab } from './toolbox/ComponentsTab';
import { UsageTab } from './toolbox/UsageTab';
import { AnalyticsTab } from './toolbox/AnalyticsTab';

type AgentTab = 'overview' | 'tools' | 'skills' | 'plans' | 'mcp' | 'components' | 'usage' | 'analytics';

const TABS: Array<{ id: AgentTab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Bot className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'tools', label: 'Tools', icon: <List className="w-3.5 h-3.5 text-fuchsia-400" />, activeIcon: <List className="w-3.5 h-3.5" /> },
  { id: 'skills', label: 'Skills', icon: <Puzzle className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Puzzle className="w-3.5 h-3.5" /> },
  { id: 'plans', label: 'SkillPlan', icon: <Target className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Target className="w-3.5 h-3.5" /> },
  { id: 'mcp', label: 'MCP', icon: <Cable className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Cable className="w-3.5 h-3.5" /> },
  { id: 'components', label: 'Components', icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />, activeIcon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'usage', label: 'Usage', icon: <History className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <History className="w-3.5 h-3.5" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <BarChart3 className="w-3.5 h-3.5" /> },
];

const TAB_IDS = TABS.map((t) => t.id);

export default function PulseAgentView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as AgentTab)
    || (sessionStorage.getItem('agent-tab') as AgentTab)
    || 'overview';
  const [activeTab, setActiveTabState] = useState<AgentTab>(
    TAB_IDS.includes(initialTab) ? initialTab : 'overview',
  );

  const setActiveTab = (tab: AgentTab) => {
    setActiveTabState(tab);
    sessionStorage.setItem('agent-tab', tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % TAB_IDS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
    if (nextIndex !== null) {
      e.preventDefault();
      setActiveTab(TAB_IDS[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  }, []);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-violet-400" />
          <h1 className="text-lg font-semibold text-slate-100">Pulse Agent</h1>
        </div>

        <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1" role="tablist" aria-label="Pulse Agent tabs">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={activeTab === t.id}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => handleTabKeyDown(e, i)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'tools' && <CatalogTab />}
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'plans' && <PlansTab />}
        {activeTab === 'mcp' && <ConnectionsTab />}
        {activeTab === 'components' && <ComponentsTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
