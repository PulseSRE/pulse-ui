import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Siren, Zap, Search, Clock, Bell, Settings, GitPullRequest, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMonitorStore } from '../store/monitorStore';
import { NowTab } from './incidents/NowTab';
import { InvestigateTab } from './incidents/InvestigateTab';
import { HistoryTab } from './incidents/HistoryTab';

const AlertsView = lazy(() => import('./AlertsView'));
const ActionsTab = lazy(() => import('./incidents/ActionsTab').then(m => ({ default: m.ActionsTab })));
const PostmortemsTab = lazy(() => import('./incidents/PostmortemsTab').then(m => ({ default: m.PostmortemsTab })));

type IncidentTab = 'now' | 'investigate' | 'actions' | 'postmortems' | 'history' | 'alerts';

const TABS = [
  { id: 'now' as IncidentTab, label: 'Active', icon: Zap, color: 'text-amber-400' },
  { id: 'investigate' as IncidentTab, label: 'Timeline', icon: Search, color: 'text-blue-400' },
  { id: 'actions' as IncidentTab, label: 'Review Queue', icon: GitPullRequest, color: 'text-violet-400' },
  { id: 'postmortems' as IncidentTab, label: 'Postmortems', icon: FileText, color: 'text-teal-400' },
  { id: 'history' as IncidentTab, label: 'History', icon: Clock, color: 'text-slate-400' },
  { id: 'alerts' as IncidentTab, label: 'Alerts', icon: Bell, color: 'text-red-400' },
] as const;


export default function IncidentCenterView() {
  const urlTab = new URLSearchParams(window.location.search).get('tab') as IncidentTab | null;
  const [activeTab, setActiveTabState] = useState<IncidentTab>(
    urlTab && ['now', 'investigate', 'actions', 'postmortems', 'history', 'alerts'].includes(urlTab) ? urlTab : 'now',
  );
  const setActiveTab = (tab: IncidentTab) => {
    setActiveTabState(tab);
    const params = new URLSearchParams(window.location.search);
    if (tab === 'now') params.delete('tab'); else params.set('tab', tab);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  };
  const navigate = useNavigate();
  const connected = useMonitorStore((s) => s.connected);


  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Siren className="w-6 h-6 text-violet-500" />
              Incident Center
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Real-time incidents, correlation analysis, and automated remediation
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg border',
                connected
                  ? 'bg-green-900/30 border-green-800'
                  : 'bg-slate-900 border-slate-700',
              )}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  connected ? 'bg-green-400 animate-pulse' : 'bg-slate-500',
                )}
              />
              <span className={cn('text-sm font-medium', connected ? 'text-green-300' : 'text-slate-400')}>
                {connected ? 'Live' : 'Disconnected'}
              </span>
            </div>
            <button
              onClick={() => navigate('/agent')}
              className="p-2 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 transition-colors"
              title="Mission Control"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 bg-slate-900 rounded-lg p-1"
          role="tablist"
          aria-label="Incident Center tabs"
          onKeyDown={(e) => {
            const ids = TABS.map((t) => t.id);
            const idx = ids.indexOf(activeTab);
            if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(ids[(idx + 1) % ids.length]); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab(ids[(idx - 1 + ids.length) % ids.length]); }
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`incident-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-xs rounded-md transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                activeTab === tab.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              <tab.icon className={cn('w-3.5 h-3.5', activeTab !== tab.id && tab.color)} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'now' && <div id="incident-panel-now" role="tabpanel"><NowTab /></div>}
        {activeTab === 'investigate' && <div id="incident-panel-investigate" role="tabpanel"><InvestigateTab /></div>}
        {activeTab === 'actions' && (
          <div id="incident-panel-actions" role="tabpanel">
            <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>}>
              <ActionsTab />
            </Suspense>
          </div>
        )}
        {activeTab === 'postmortems' && (
          <div id="incident-panel-postmortems" role="tabpanel">
            <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>}>
              <PostmortemsTab />
            </Suspense>
          </div>
        )}
        {activeTab === 'history' && <div id="incident-panel-history" role="tabpanel"><HistoryTab /></div>}
        {activeTab === 'alerts' && (
          <div id="incident-panel-alerts" role="tabpanel">
            <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>}>
              <AlertsView />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
