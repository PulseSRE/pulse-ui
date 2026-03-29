import { useEffect, useState } from 'react';
import { X, CheckCircle2, XCircle, AlertTriangle, Undo2, ShieldX, WifiOff, ServerCrash, Bot } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { cn } from '@/lib/utils';

interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'warning' | 'undo';
  title: string;
  detail?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  category?: string;
  suggestions?: string[];
  onClose: () => void;
}

function Toast({ id: _id, type, title, detail, duration, action, category, suggestions, onClose }: ToastProps) {
  const [progress, setProgress] = useState(100);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (type === 'undo' && duration && duration > 0) {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
        setProgress(remaining);
        if (remaining === 0) {
          clearInterval(interval);
        }
      }, 50);
      return () => clearInterval(interval);
    }
  }, [type, duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const copyError = () => {
    const errorText = `${title}${detail ? '\n' + detail : ''}`;
    navigator.clipboard.writeText(errorText);
  };

  const errorIcon = category === 'permission'
    ? <ShieldX className="h-5 w-5 text-red-500" />
    : category === 'network'
    ? <WifiOff className="h-5 w-5 text-red-500" />
    : category === 'server'
    ? <ServerCrash className="h-5 w-5 text-red-500" />
    : <XCircle className="h-5 w-5 text-red-500" />;

  const icon = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: errorIcon,
    warning: <AlertTriangle className="h-5 w-5 text-amber-500" />,
    undo: <Undo2 className="h-5 w-5 text-blue-500" />,
  }[type];

  const handleAskAI = () => {
    useUIStore.getState().openDock('agent');
    useAgentStore.getState().connectAndSend(
      `I got this error: "${title}". ${detail || ''}. What does this mean and how can I fix it?`
    );
    handleClose();
  };

  const borderColor = {
    success: 'border-emerald-500',
    error: 'border-red-500',
    warning: 'border-amber-500',
    undo: 'border-blue-500',
  }[type];

  return (
    <div
      className={cn(
        'flex w-full max-w-[380px] flex-col gap-2 rounded-lg border-l-4 bg-slate-800 p-4 shadow-lg transition-all duration-200',
        borderColor,
        isExiting ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
      )}
    >
      {/* Progress bar for undo toasts */}
      {type === 'undo' && (
        <div className="absolute left-0 top-0 h-1 w-full overflow-hidden rounded-t-lg bg-slate-700">
          <div
            className="h-full bg-blue-500 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-0.5">{icon}</div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-medium text-slate-100">{title}</div>
          {detail && (
            <div className="text-sm text-slate-400 break-all line-clamp-3">{detail}</div>
          )}
        </div>

        <button
          onClick={handleClose}
          className="flex-shrink-0 text-slate-400 transition-colors hover:text-slate-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Suggestions */}
      {suggestions && suggestions.length > 0 && (
        <ul className="pl-8 space-y-0.5">
          {suggestions.slice(0, 3).map((s, i) => (
            <li key={i} className="text-xs text-slate-400">
              &bull; {s}
            </li>
          ))}
        </ul>
      )}

      {/* Action buttons */}
      {(type === 'error' || action) && (
        <div className="flex gap-2 pl-8">
          {type === 'error' && (
            <button
              onClick={copyError}
              className="rounded px-3 py-1 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
            >
              Copy Error
            </button>
          )}
          {type === 'error' && (
            <button
              onClick={handleAskAI}
              className="flex items-center gap-1 rounded px-3 py-1 text-sm text-violet-300 transition-colors hover:bg-violet-900/40 hover:text-violet-200"
            >
              <Bot className="h-3.5 w-3.5" />
              Ask AI
            </button>
          )}
          {action && (
            <button
              onClick={() => {
                action.onClick();
                handleClose();
              }}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                type === 'undo'
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-slate-100'
              )}
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto" role={toast.type === 'error' ? 'alert' : undefined}>
          <Toast
            id={toast.id}
            type={toast.type}
            title={toast.title}
            detail={toast.detail}
            duration={toast.duration}
            action={toast.action}
            category={toast.category}
            suggestions={toast.suggestions}
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
}
