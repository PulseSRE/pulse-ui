import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Minus, X, GripHorizontal, Bot } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { cn } from '@/lib/utils';

const DockAgentPanel = lazy(() => import('./agent/DockAgentPanel').then(m => ({ default: m.DockAgentPanel })));
const LogStream = lazy(() => import('./logs/LogStream'));

export function Dock() {
  const dockPanel = useUIStore((s) => s.dockPanel);
  const dockHeight = useUIStore((s) => s.dockHeight);
  const setDockHeight = useUIStore((s) => s.setDockHeight);
  const openDock = useUIStore((s) => s.openDock);
  const closeDock = useUIStore((s) => s.closeDock);
  const dockContext = useUIStore((s) => s.dockContext);

  const [isResizing, setIsResizing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    startY.current = e.clientY;
    startHeight.current = dockHeight;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY.current - e.clientY;
      const newHeight = startHeight.current + delta;
      setDockHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setDockHeight]);

  if (isMinimized) {
    return (
      <div className="flex h-8 items-center justify-between border-t border-slate-700 bg-slate-800 px-4">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <button
            onClick={() => openDock('logs')}
            className={cn(
              'px-2 py-1 transition-colors',
              dockPanel === 'logs'
                ? 'text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Logs
          </button>
          <button
            onClick={() => openDock('terminal')}
            className={cn(
              'px-2 py-1 transition-colors',
              dockPanel === 'terminal'
                ? 'text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Terminal
          </button>
          <button
            onClick={() => openDock('events')}
            className={cn(
              'px-2 py-1 transition-colors',
              dockPanel === 'events'
                ? 'text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Events
          </button>
          <button
            onClick={() => openDock('agent')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 transition-colors',
              dockPanel === 'agent'
                ? 'text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            Agent
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(false)}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Restore"
          >
            <GripHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col border-t border-slate-700 bg-slate-850"
      style={{ height: dockHeight }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'group flex h-1 cursor-ns-resize items-center justify-center border-b border-slate-700 bg-slate-800 transition-colors hover:bg-slate-700',
          isResizing && 'bg-emerald-600'
        )}
      >
        <GripHorizontal className="h-3 w-3 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-slate-700 bg-slate-800 px-4">
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => openDock('logs')}
            className={cn(
              'px-2 py-1 transition-colors',
              dockPanel === 'logs'
                ? 'border-b-2 border-emerald-400 text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Logs
          </button>
          <button
            onClick={() => openDock('terminal')}
            className={cn(
              'px-2 py-1 transition-colors',
              dockPanel === 'terminal'
                ? 'border-b-2 border-emerald-400 text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Terminal
          </button>
          <button
            onClick={() => openDock('events')}
            className={cn(
              'px-2 py-1 transition-colors',
              dockPanel === 'events'
                ? 'border-b-2 border-emerald-400 text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Events
          </button>
          <button
            onClick={() => openDock('agent')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 transition-colors',
              dockPanel === 'agent'
                ? 'border-b-2 border-emerald-400 text-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            Agent
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(true)}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={closeDock}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-slate-900 p-4">
        {dockPanel === 'logs' && (
          dockContext ? (
            <Suspense fallback={<div className="text-xs text-slate-500 p-2">Loading logs...</div>}>
              <div className="h-full flex flex-col">
                <div className="px-2 py-1 text-[10px] text-slate-500 border-b border-slate-800 flex items-center gap-2">
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
            <div className="font-mono text-xs text-slate-500">
              Navigate to a pod or workload to see logs here
            </div>
          )
        )}

        {dockPanel === 'terminal' && (
          <div className="h-full rounded border border-slate-700 bg-black p-3 font-mono text-sm text-green-400">
            <div className="text-slate-500">$ _</div>
          </div>
        )}

        {dockPanel === 'events' && (
          <div className="text-sm text-slate-300">
            <div className="text-slate-500">No events</div>
          </div>
        )}

        {dockPanel === 'agent' && (
          <Suspense fallback={<div className="text-sm text-slate-500">Loading agent...</div>}>
            <DockAgentPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
