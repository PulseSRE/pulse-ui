import React, { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot, List, BarChart3, History, Brain,
  Puzzle, Layers, Cable, Target, Workflow,
} from 'lucide-react';
import { Tabs, TabsList, TabsGroup, TabsTrigger, TabsContent } from '../components/primitives/Tabs';
import { OverviewTab } from './pulse-agent/OverviewTab';
import { CatalogTab } from './toolbox/CatalogTab';
import { SkillsTab } from './toolbox/SkillsTab';
import { PlansTab } from './toolbox/PlansTab';
import { RunsTab } from './toolbox/RunsTab';
import { ConnectionsTab } from './toolbox/ConnectionsTab';
import { ComponentsTab } from './toolbox/ComponentsTab';
import { UsageTab } from './toolbox/UsageTab';
import { AnalyticsTab } from './toolbox/AnalyticsTab';

const MemoryView = lazy(() => import('./MemoryView'));

type AgentTab = 'overview' | 'tools' | 'skills' | 'plans' | 'runs' | 'mcp' | 'components' | 'usage' | 'analytics' | 'memory';

interface TabDef { id: AgentTab; label: string; icon: React.ReactNode }

/**
 * Ten flat tabs read as one undifferentiated strip. Grouped by what a person
 * is doing: running the agent, shaping what it can do, and learning from what
 * it did. Grouping is presentation only: the tab ids are unchanged, so every
 * existing `?tab=` link still opens its tab.
 */
const TAB_GROUPS: Array<{ label: string; tabs: TabDef[] }> = [
  {
    label: 'Operate',
    tabs: [
      { id: 'overview', label: 'Overview', icon: <Bot className="w-3.5 h-3.5 text-violet-400" /> },
      { id: 'runs', label: 'Runs', icon: <Workflow className="w-3.5 h-3.5 text-cyan-400" /> },
    ],
  },
  {
    label: 'Configure',
    tabs: [
      { id: 'skills', label: 'Skills', icon: <Puzzle className="w-3.5 h-3.5 text-violet-400" /> },
      { id: 'plans', label: 'Plans', icon: <Target className="w-3.5 h-3.5 text-cyan-400" /> },
      { id: 'tools', label: 'Tools', icon: <List className="w-3.5 h-3.5 text-fuchsia-400" /> },
      { id: 'mcp', label: 'MCP', icon: <Cable className="w-3.5 h-3.5 text-cyan-400" /> },
      { id: 'components', label: 'Components', icon: <Layers className="w-3.5 h-3.5 text-emerald-400" /> },
    ],
  },
  {
    label: 'Insights',
    tabs: [
      { id: 'usage', label: 'Usage', icon: <History className="w-3.5 h-3.5 text-amber-400" /> },
      { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> },
      { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5 text-pink-400" /> },
    ],
  },
];

const TAB_IDS: AgentTab[] = TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id));

const LAST_TAB_KEY = 'agent-tab';

function readLastTab(): AgentTab | null {
  try {
    const v = sessionStorage.getItem(LAST_TAB_KEY);
    return v && (TAB_IDS as string[]).includes(v) ? (v as AgentTab) : null;
  } catch {
    return null;
  }
}

function rememberTab(tab: string) {
  try { sessionStorage.setItem(LAST_TAB_KEY, tab); } catch { /* storage unavailable */ }
}

export default function PulseAgentView() {
  // `?tab=` wins. Without it, reopen the tab last used in this session.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    // A `?drawer=` link (e.g. an Overview card) means Overview, not the last tab.
    if (searchParams.has('tab') || searchParams.has('drawer')) return;
    const last = readLastTab();
    if (last && last !== 'overview') {
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', last); return next; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on arrival
  }, []);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-violet-400" />
          <h1 className="text-lg font-semibold text-slate-100">Pulse Agent</h1>
        </div>

        <Tabs defaultValue="overview" urlSync={{ values: TAB_IDS }} onValueChange={rememberTab} className="space-y-6">
          <TabsList aria-label="Pulse Agent tabs" className="flex flex-wrap">
            {TAB_GROUPS.map((group, gi) => (
              <TabsGroup key={group.label} label={group.label} divider={gi > 0}>
                {group.tabs.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="font-normal data-[state=active]:[&_svg]:text-white">
                    {t.icon}{t.label}
                  </TabsTrigger>
                ))}
              </TabsGroup>
            ))}
          </TabsList>

          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="tools"><CatalogTab /></TabsContent>
          <TabsContent value="skills"><SkillsTab /></TabsContent>
          <TabsContent value="plans"><PlansTab /></TabsContent>
          <TabsContent value="runs"><RunsTab /></TabsContent>
          <TabsContent value="mcp"><ConnectionsTab /></TabsContent>
          <TabsContent value="components"><ComponentsTab /></TabsContent>
          <TabsContent value="usage"><UsageTab /></TabsContent>
          <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
          <TabsContent value="memory">
            <Suspense fallback={<div className="text-slate-500 text-sm p-4">Loading...</div>}><MemoryView embedded /></Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
