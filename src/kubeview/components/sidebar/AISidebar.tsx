import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { PanelRightClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { useMonitorStore } from '../../store/monitorStore';
import { CollapsedRail } from './CollapsedRail';
import { DashboardMode } from './DashboardMode';
import { DegradedBanner } from '../primitives/DegradedBanner';
import { useIsPhone, PHONE_QUERY } from '../../hooks/useIsPhone';
import { AIChatSheet } from './AIChatSheet';

const DockAgentPanel = lazy(() => import('../agent/DockAgentPanel').then(m => ({ default: m.DockAgentPanel })));

function AgentDegradedBanner() {
  const degradedReasons = useUIStore((s) => s.degradedReasons);
  if (!degradedReasons.has('agent_unreachable')) return null;
  return <DegradedBanner reason="agent_unreachable" />;
}

export function AISidebar() {
  const expanded = useUIStore((s) => s.aiSidebarExpanded);
  const mode = useUIStore((s) => s.aiSidebarMode);
  const width = useUIStore((s) => s.aiSidebarWidth);
  const setWidth = useUIStore((s) => s.setAISidebarWidth);
  const setMode = useUIStore((s) => s.setAISidebarMode);
  const collapseAISidebar = useUIStore((s) => s.collapseAISidebar);

  const streaming = useAgentStore((s) => s.streaming);
  const activeSkill = useMonitorStore((s) => s.activeSkill);
  // Phones: no rail (it took 48px of a 390px screen); chat opens as a bottom sheet.
  const isPhone = useIsPhone();
  // On a phone the sheet mounts only for an expand that happens after this
  // component mounted. A stale "expanded" (set before mount, or by a viewport
  // that just shrank) would otherwise open a modal and take focus on load.
  const [phoneSheetOpen, setPhoneSheetOpen] = useState(false);
  useEffect(() => useUIStore.subscribe((s, prev) => {
    if (s.aiSidebarExpanded && !prev.aiSidebarExpanded) setPhoneSheetOpen(true);
    else if (!s.aiSidebarExpanded) setPhoneSheetOpen(false);
  }), []);

  // Auto-collapse on small screens
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1200px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) useUIStore.getState().collapseAISidebar();
    };
    if (mq.matches) useUIStore.getState().collapseAISidebar();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Resize
  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = width;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX.current - e.clientX;
      setWidth(startWidth.current + delta);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setWidth]);

  // Auto-transition to chat when agent starts investigating
  const prevActiveSkill = useRef(activeSkill);
  useEffect(() => {
    // Not on a phone: there the sheet would cover the page the user is reading.
    if (activeSkill && !prevActiveSkill.current && !window.matchMedia?.(PHONE_QUERY).matches) {
      useUIStore.getState().expandAISidebar();
      setMode('chat');
    }
    prevActiveSkill.current = activeSkill;
  }, [activeSkill, setMode]);

  // Auto-return to dashboard after 5 min of inactivity post-conversation
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
    }, 300_000);
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [mode, streaming, setMode]);

  const content = mode === 'dashboard' ? (
    <DashboardMode />
  ) : (
    <>
      <AgentDegradedBanner />
      <Suspense fallback={<div className="text-sm text-faint p-4">Loading agent...</div>}>
        <DockAgentPanel />
      </Suspense>
    </>
  );

  if (isPhone) {
    if (!expanded || !phoneSheetOpen) return null;
    return (
      <AIChatSheet
        onClose={collapseAISidebar}
        actions={mode === 'chat' ? (
          <button type="button" onClick={() => setMode('dashboard')} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Dashboard</button>
        ) : undefined}
      >
        {content}
      </AIChatSheet>
    );
  }

  if (!expanded) {
    return <CollapsedRail />;
  }

  return (
    <aside
      className="relative h-full flex flex-col border-l border-slate-800 bg-slate-900 shrink-0"
      style={{ width }}
      aria-label="AI Sidebar"
    >
      {/* Resize handle (left edge) */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 transition-colors hover:bg-violet-500/50',
          isResizing && 'bg-violet-500',
        )}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
        <span className="text-xs font-semibold text-slate-300">Pulse AI</span>
        <div className="flex items-center gap-1">
          {mode === 'chat' && (
            <button
              onClick={() => setMode('dashboard')}
              className="text-[10px] text-faint hover:text-slate-300 transition-colors px-2 py-0.5"
            >
              Dashboard
            </button>
          )}
          <button
            onClick={collapseAISidebar}
            className="p-1 text-faint hover:text-slate-300 transition-colors rounded-sm"
            title="Collapse sidebar"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{content}</div>
    </aside>
  );
}
