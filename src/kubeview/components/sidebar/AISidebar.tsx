import { useEffect, useRef, lazy, Suspense } from 'react';
import { PanelRightClose } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { useMonitorStore } from '../../store/monitorStore';
import { CollapsedRail } from './CollapsedRail';
import { DashboardMode } from './DashboardMode';
import { DegradedBanner } from '../primitives/DegradedBanner';

const DockAgentPanel = lazy(() => import('../agent/DockAgentPanel').then(m => ({ default: m.DockAgentPanel })));

function AgentDegradedBanner() {
  const degradedReasons = useUIStore((s) => s.degradedReasons);
  if (!degradedReasons.has('agent_unreachable')) return null;
  return <DegradedBanner reason="agent_unreachable" />;
}

export function AISidebar() {
  const expanded = useUIStore((s) => s.aiSidebarExpanded);
  const mode = useUIStore((s) => s.aiSidebarMode);
  const setMode = useUIStore((s) => s.setAISidebarMode);
  const collapseAISidebar = useUIStore((s) => s.collapseAISidebar);

  const streaming = useAgentStore((s) => s.streaming);
  const messages = useAgentStore((s) => s.messages);
  const activeSkill = useMonitorStore((s) => s.activeSkill);

  // Auto-transition to chat when agent starts investigating
  const prevActiveSkill = useRef(activeSkill);
  useEffect(() => {
    if (activeSkill && !prevActiveSkill.current) {
      useUIStore.getState().expandAISidebar();
      setMode('chat');
    }
    prevActiveSkill.current = activeSkill;
  }, [activeSkill, setMode]);

  // Auto-return to dashboard after 30s of inactivity post-conversation
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mode !== 'chat' || streaming) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }
    idleTimerRef.current = setTimeout(() => {
      if (!useAgentStore.getState().streaming) {
        setMode('dashboard');
      }
    }, 30_000);
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [mode, streaming, messages.length, setMode]);

  if (!expanded) {
    return <CollapsedRail />;
  }

  return (
    <div className="w-[360px] h-full flex flex-col border-l border-slate-800 bg-slate-900 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
        <span className="text-xs font-semibold text-slate-300">Pulse AI</span>
        <div className="flex items-center gap-1">
          {mode === 'chat' && (
            <button
              onClick={() => setMode('dashboard')}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-0.5"
            >
              Dashboard
            </button>
          )}
          <button
            onClick={collapseAISidebar}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors rounded"
            title="Collapse sidebar"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'dashboard' ? (
          <DashboardMode />
        ) : (
          <>
            <AgentDegradedBanner />
            <Suspense fallback={<div className="text-sm text-slate-500 p-4">Loading agent...</div>}>
              <DockAgentPanel />
            </Suspense>
          </>
        )}
      </div>
    </div>
  );
}
