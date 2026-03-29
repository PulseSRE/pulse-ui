/**
 * AmbientInsight — one-shot agent query rendered as an insight card.
 *
 * Creates a temporary AgentClient, sends a prompt with resource context,
 * and displays the result using MarkdownRenderer + AgentComponentRenderer.
 * Results are cached in-memory with a configurable staleTime.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, RefreshCw } from 'lucide-react';
import { AIIconStatic, AI_ACCENT } from './AIBranding';

import { AgentClient, type ResourceContext, type AgentEvent } from '../../engine/agentClient';
import type { ComponentSpec } from '../../engine/agentComponents';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentComponentRenderer } from './AgentComponentRenderer';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------------------
 * Props
 * --------------------------------------------------------------------------- */

export interface AmbientInsightProps {
  context: ResourceContext;
  prompt: string;
  trigger?: 'auto' | 'manual';
  staleTime?: number;
  className?: string;
}

/* ---------------------------------------------------------------------------
 * Module-level cache
 * --------------------------------------------------------------------------- */

interface CacheEntry {
  result: string;
  components: ComponentSpec[];
  timestamp: number;
}

const MAX_CACHE_ENTRIES = 50;
const insightCache = new Map<string, CacheEntry>();

function cacheKey(ctx: ResourceContext, prompt: string): string {
  return `${ctx.kind}/${ctx.namespace ?? ''}/${ctx.name}/${prompt}`;
}

function cacheSet(key: string, entry: CacheEntry) {
  // Evict oldest entries if cache is full
  if (insightCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = insightCache.keys().next().value;
    if (firstKey) insightCache.delete(firstKey);
  }
  insightCache.set(key, entry);
}

/** Exported for testing — clears all cached insights. */
export function clearInsightCache() {
  insightCache.clear();
}

/* ---------------------------------------------------------------------------
 * Component
 * --------------------------------------------------------------------------- */

type InsightState = 'idle' | 'loading' | 'result' | 'error';

export function AmbientInsight({
  context,
  prompt,
  trigger = 'manual',
  staleTime = 300_000,
  className,
}: AmbientInsightProps) {
  const [state, setState] = useState<InsightState>('idle');
  const [result, setResult] = useState('');
  const [components, setComponents] = useState<ComponentSpec[]>([]);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  const clientRef = useRef<AgentClient | null>(null);
  const mountedRef = useRef(true);

  // Check cache on mount / prop change
  const key = cacheKey(context, prompt);
  const cached = insightCache.get(key);
  const isCacheValid = cached != null && Date.now() - cached.timestamp < staleTime;

  // Show cached result immediately
  useEffect(() => {
    if (isCacheValid && cached && state === 'idle') {
      setResult(cached.result);
      setComponents(cached.components);
      setState('result');
      // Trigger fade-in on next frame
      requestAnimationFrame(() => setVisible(true));
    }
  }, [isCacheValid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clientRef.current?.disconnect();
    };
  }, []);

  const runQuery = useCallback(() => {
    // If cache is valid, just show it
    const entry = insightCache.get(key);
    if (entry && Date.now() - entry.timestamp < staleTime) {
      setResult(entry.result);
      setComponents(entry.components);
      setState('result');
      requestAnimationFrame(() => setVisible(true));
      return;
    }

    setState('loading');
    setResult('');
    setComponents([]);
    setError('');
    setVisible(false);

    const client = new AgentClient('sre');
    clientRef.current = client;

    const collectedComponents: ComponentSpec[] = [];

    const unsub = client.on((event: AgentEvent) => {
      if (!mountedRef.current) return;

      switch (event.type) {
        case 'connected':
          client.send(prompt, context);
          break;
        case 'component':
          collectedComponents.push(event.spec);
          break;
        case 'done':
          cacheSet(key, {
            result: event.full_response,
            components: [...collectedComponents],
            timestamp: Date.now(),
          });
          setResult(event.full_response);
          setComponents([...collectedComponents]);
          setState('result');
          requestAnimationFrame(() => setVisible(true));
          unsub();
          client.disconnect();
          clientRef.current = null;
          break;
        case 'error':
          setError(event.message);
          setState('error');
          unsub();
          client.disconnect();
          clientRef.current = null;
          break;
        case 'disconnected':
          // If we didn't get a done/error, treat unexpected disconnect as error
          if (state === 'loading') {
            setError('Connection to agent lost');
            setState('error');
          }
          break;
      }
    });

    client.connect();
  }, [key, prompt, context, staleTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-trigger on mount
  useEffect(() => {
    if (trigger === 'auto' && state === 'idle' && !isCacheValid) {
      runQuery();
    }
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setState('idle');
  }, []);

  /* ---- Idle state: show trigger button ---- */
  if (state === 'idle') {
    return (
      <div className={cn('rounded-lg border bg-slate-800 p-4', AI_ACCENT.border, className)}>
        <button
          onClick={runQuery}
          className={cn('flex items-center gap-2 text-sm transition-colors', AI_ACCENT.text, AI_ACCENT.textHover)}
        >
          <AIIconStatic size={16} />
          Analyze with AI
        </button>
        <p className="text-xs text-slate-500 mt-1">
          {context.kind ? `Get an AI analysis of this ${context.kind.toLowerCase()}` : 'Get an AI-powered analysis'}
        </p>
      </div>
    );
  }

  /* ---- Loading state: shimmer skeleton ---- */
  if (state === 'loading') {
    return (
      <div className={cn('rounded-lg border border-slate-700 bg-slate-800 p-4', className)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing...
          </div>
          <button
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-slate-700 rounded w-3/4" />
          <div className="h-3 bg-slate-700 rounded w-1/2" />
          <div className="h-3 bg-slate-700 rounded w-5/6" />
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (state === 'error') {
    return (
      <div className={cn('rounded-lg border border-red-800 bg-slate-800 p-4', className)}>
        <p className="text-sm text-red-400 mb-2">{error}</p>
        <button
          onClick={runQuery}
          className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  /* ---- Result state ---- */
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-700 bg-slate-800 p-4 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200 mb-3">
        <AIIconStatic size={16} />
        <span className={AI_ACCENT.text}>AI Insight</span>
      </div>
      <div className="text-sm text-slate-300">
        <MarkdownRenderer content={result} />
      </div>
      {components.map((spec, i) => (
        <AgentComponentRenderer key={i} spec={spec} />
      ))}
    </div>
  );
}
