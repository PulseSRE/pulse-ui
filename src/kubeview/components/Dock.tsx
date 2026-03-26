import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Minus, X, GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useAgentStore } from '../store/agentStore';
import { AIIconStatic, AIBadge, AI_ACCENT, aiActiveClass } from './agent/AIBranding';
import { cn } from '@/lib/utils';

const DockAgentPanel = lazy(() => import('./agent/DockAgentPanel').then(m => ({ default: m.DockAgentPanel })));
const LogStream = lazy(() => import('./logs/LogStream'));
const PodTerminal = lazy(() => import('./PodTerminal'));

export function Dock() {
  const dockPanel = useUIStore((s) => s.dockPanel);
  const dockWidth = useUIStore((s) => s.dockWidth);
  const dockFullscreen = useUIStore((s) => s.dockFullscreen);
  const setDockWidth = useUIStore((s) => s.setDockWidth);
  const toggleDockFullscreen = useUIStore((s) => s.toggleDockFullscreen);
  const openDock = useUIStore((s) => s.openDock);
  const closeDock = useUIStore((s) => s.closeDock);
  const dockContext = useUIStore((s) => s.dockContext);
  const terminalContext = useUIStore((s) => s.terminalContext);
  const hasUnreadInsight = useAgentStore((s) => s.hasUnreadInsight);
  const clearUnread = useAgentStore((s) => s.setUnreadInsight);

  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = dockWidth;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX.current - e.clientX;
      setDockWidth(startWidth.current + delta);
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setDockWidth]);

  const tabs = [
    { id: 'logs' as const, label: 'Logs', active: dockPanel === 'logs' },
    { id: 'terminal' as const, label: 'Terminal', active: dockPanel === 'terminal' },
    { id: 'events' as const, label: 'Events', active: dockPanel === 'events' },
  ];

  return (
    <div
      className={cn(
        'flex flex-col border-l border-slate-700 bg-slate-850',
        dockFullscreen ? 'absolute inset-0 z-40' : 'relative',
      )}
      style={dockFullscreen ? undefined : { width: dockWidth }}
    >
      {/* Resize handle (left edge) */}
      {!dockFullscreen && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 transition-colors hover:bg-violet-500/50',
            isResizing && 'bg-violet-500',
          )}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1 text-xs" role="tablist" aria-label="Dock panels">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.active}
              onClick={() => openDock(t.id)}
              className={cn(
                'px-2 py-1 rounded transition-colors',
                t.active
                  ? 'bg-slate-700 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={dockPanel === 'agent'}
            onClick={() => { openDock('agent'); clearUnread(false); }}
            className={cn(
              'relative flex items-center gap-1 px-2 py-1 rounded transition-colors',
              dockPanel === 'agent'
                ? cn('bg-slate-700', aiActiveClass)
                : 'text-slate-400 hover:text-violet-300',
            )}
          >
            <AIIconStatic size={13} className={dockPanel === 'agent' ? '' : 'text-slate-400'} />
            Agent
            <AIBadge className="ml-0.5" />
            {hasUnreadInsight && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleDockFullscreen}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title={dockFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {dockFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={closeDock}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-slate-900">
        {dockPanel === 'logs' && (
          dockContext ? (
            <Suspense fallback={<div className="text-xs text-slate-500 p-3">Loading logs...</div>}>
              <div className="h-full flex flex-col">
                <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-800 flex items-center gap-2">
                  <span>{dockContext.namespace}/{dockContext.podName}</span>
                  {dockContext.containerName && <span className="text-slate-600">({dockContext.containerName})</span>}
                </div>
                <div className="flex-1 overflow-hidden">
                  <LogStream
                    key={`${dockContext.namespace}/${dockContext.podName}/${dockContext.containerName || ''}`}
                    namespace={dockContext.namespace}
                    podName={dockContext.podName}
                    containerName={dockContext.containerName}
                    tailLines={500}
                  />
                </div>
              </div>
            </Suspense>
          ) : (
            <div className="p-4 font-mono text-xs text-slate-500">
              Navigate to a pod or workload to see logs here
            </div>
          )
        )}

        {dockPanel === 'terminal' && (
          terminalContext ? (
            <Suspense fallback={<div className="text-xs text-slate-500 p-3">Loading terminal...</div>}>
              <div className="h-full">
                <PodTerminal
                  key={`${terminalContext.namespace}/${terminalContext.podName}/${terminalContext.containerName}`}
                  namespace={terminalContext.namespace}
                  podName={terminalContext.podName}
                  containerName={terminalContext.containerName}
                  isNode={terminalContext.isNode}
                  onClose={closeDock}
                  inline
                />
              </div>
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-500">
              Open a terminal from a pod or node detail view
            </div>
          )
        )}

        {dockPanel === 'events' && (
          <div className="p-4 text-sm text-slate-500">No events</div>
        )}

        {dockPanel === 'agent' && (
          <Suspense fallback={<div className="text-sm text-slate-500 p-4">Loading agent...</div>}>
            <DockAgentPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
