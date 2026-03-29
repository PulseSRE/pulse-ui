/**
 * NLFilterBar — natural language filter bar for resource tables.
 *
 * Sends a one-shot query to the Pulse Agent asking it to convert natural
 * language into structured column filters, then applies them via callback.
 */

import { useCallback, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { AgentClient, type AgentEvent } from '../../engine/agentClient';
import { AIIconStatic } from './AIBranding';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------------------
 * Props
 * --------------------------------------------------------------------------- */

interface NLFilterBarProps {
  resourceKind: string;
  columns: string[];
  onFiltersApplied: (filters: Record<string, string>) => void;
}

/* ---------------------------------------------------------------------------
 * Component
 * --------------------------------------------------------------------------- */

export function NLFilterBar({ resourceKind, columns, onFiltersApplied }: NLFilterBarProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<AgentClient | null>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);

    const client = new AgentClient('sre');
    clientRef.current = client;

    let responseText = '';
    let done = false;

    const unsub = client.on((event: AgentEvent) => {
      switch (event.type) {
        case 'text_delta':
          responseText += event.text;
          break;
        case 'done':
          responseText = event.full_response;
          done = true;
          tryParseAndApply(responseText);
          cleanup();
          break;
        case 'error':
          setError(event.message);
          setLoading(false);
          cleanup();
          break;
        case 'connected':
          // Send the filter query once connected
          client.send(
            `Convert this natural language filter to structured column filters for ${resourceKind}. Columns: ${columns.join(', ')}. Query: ${trimmed}. Respond with ONLY valid JSON mapping column names to filter strings, nothing else.`
          );
          break;
        case 'disconnected':
          if (!done) {
            if (responseText) {
              tryParseAndApply(responseText);
            } else {
              setError('Agent not available — is pulse-agent running?');
            }
            setLoading(false);
          }
          break;
      }
    });

    function cleanup() {
      unsub();
      client.disconnect();
      clientRef.current = null;
      setLoading(false);
    }

    function tryParseAndApply(text: string) {
      try {
        // Extract JSON from the response — agent may wrap it in markdown code fences
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          setError(text || 'No valid filter response received');
          return;
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          onFiltersApplied(parsed as Record<string, string>);
          setError(null);
        } else {
          setError('Unexpected response format');
        }
      } catch {
        setError(text || 'Failed to parse filter response');
      }
    }

    client.connect();
  }, [query, loading, resourceKind, columns, onFiltersApplied]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClear = () => {
    setQuery('');
    setError(null);
    onFiltersApplied({});
  };

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex items-center gap-2 rounded border transition-colors',
          'bg-slate-900 border-slate-700 focus-within:border-blue-500/50',
          'px-3 py-1.5'
        )}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
        ) : (
          <AIIconStatic size={16} className="shrink-0" />
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you're looking for..."
          disabled={loading}
          className={cn(
            'flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500',
            'outline-none border-none',
            'disabled:opacity-50'
          )}
        />
        {query && (
          <button
            onClick={handleClear}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Clear filter"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {error && (
        <div className="text-xs text-amber-400 px-3 py-1 truncate" title={error}>
          {error}
        </div>
      )}
    </div>
  );
}
