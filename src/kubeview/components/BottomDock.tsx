import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';

const LogStream = lazy(() => import('./logs/LogStream'));
const PodTerminal = lazy(() => import('./PodTerminal'));

type BottomDockTab = 'logs' | 'terminal' | 'events';

export function BottomDock() {
  const panel = useUIStore((s) => s.bottomDockPanel);
  const height = useUIStore((s) => s.bottomDockHeight);
  const setHeight = useUIStore((s) => s.setBottomDockHeight);
  const openBottomDock = useUIStore((s) => s.openBottomDock);
  const closeBottomDock = useUIStore((s) => s.closeBottomDock);
  const dockContext = useUIStore((s) => s.dockContext);
  const terminalContext = useUIStore((s) => s.terminalContext);

  const [isResizing, setIsResizing] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    startY.current = e.clientY;
    startHeight.current = height;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY.current - e.clientY;
      setHeight(startHeight.current + delta);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setHeight]);

  if (!panel) return null;

  const tabs: { id: BottomDockTab; label: string }[] = [
    { id: 'logs', label: 'Logs' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'events', label: 'Events' },
  ];

  return (
    <div className="border-t border-slate-700 bg-slate-900 flex flex-col shrink-0" style={{ height }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'h-1 cursor-ns-resize transition-colors hover:bg-violet-500/50 shrink-0',
          isResizing && 'bg-violet-500',
        )}
      />

      {/* Header with tabs */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-1 text-xs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={panel === t.id}
              onClick={() => openBottomDock(t.id)}
              onDoubleClick={closeBottomDock}
              className={cn(
                'px-2 py-1 rounded transition-colors',
                panel === t.id ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={closeBottomDock}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {panel === 'logs' && (
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

        {panel === 'terminal' && (
          terminalContext ? (
            <Suspense fallback={<div className="text-xs text-slate-500 p-3">Loading terminal...</div>}>
              <div className="h-full">
                <PodTerminal
                  key={`${terminalContext.namespace}/${terminalContext.podName}/${terminalContext.containerName}`}
                  namespace={terminalContext.namespace}
                  podName={terminalContext.podName}
                  containerName={terminalContext.containerName}
                  isNode={terminalContext.isNode}
                  onClose={closeBottomDock}
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

        {panel === 'events' && (
          <div className="p-4 text-sm text-slate-500">No events</div>
        )}
      </div>
    </div>
  );
}
