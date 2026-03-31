import { Sparkles, ArrowRight, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getResourceIcon } from '../engine/iconRegistry';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { saveQuery } from '../engine/mockData/askPulseMocks';
import type { AskPulseResponse } from '../engine/mockData/askPulseMocks';

interface AskPulsePanelProps {
  query: string;
  response: AskPulseResponse | null;
  isLoading: boolean;
  onSuggestionClick: (suggestion: string) => void;
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5 py-4 px-3">
      <Sparkles className="h-4 w-4 text-violet-400 animate-pulse" />
      <span className="text-sm text-slate-400">Thinking</span>
      <span className="flex gap-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );
}

export function AskPulsePanel({ query, response, isLoading, onSuggestionClick }: AskPulsePanelProps) {
  const go = useNavigateTab();
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);

  const handleAction = (route: string, label: string) => {
    saveQuery(query);
    closeCommandPalette();
    go(route, label);
  };

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3 px-1">
        <Sparkles className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
          Ask Pulse
        </span>
      </div>

      {isLoading && <LoadingDots />}

      {response && !isLoading && (
        <div className="space-y-3">
          <div className="rounded-md bg-slate-700/50 px-3 py-2.5">
            <div className="flex gap-2">
              <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-violet-400" />
              <p className="text-sm text-slate-200 leading-relaxed">{response.text}</p>
            </div>
          </div>

          {response.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {response.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSuggestionClick(suggestion)}
                  className={cn(
                    'rounded-full border border-slate-600 px-3 py-1 text-xs',
                    'text-slate-300 hover:bg-slate-700 hover:border-violet-500/50 transition-colors',
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {response.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1">
              {response.actions.map((action) => {
                const Icon = getResourceIcon(action.icon, ArrowRight);
                return (
                  <button
                    key={action.route}
                    onClick={() => handleAction(action.route, action.label)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md bg-violet-600/20 border border-violet-500/30',
                      'px-3 py-1.5 text-xs font-medium text-violet-300',
                      'hover:bg-violet-600/30 hover:border-violet-500/50 transition-colors',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
