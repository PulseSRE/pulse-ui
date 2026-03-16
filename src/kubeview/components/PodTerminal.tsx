import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PodTerminalProps {
  namespace: string;
  podName: string;
  containerName: string;
  onClose: () => void;
}

interface TerminalLine {
  type: 'input' | 'output' | 'error';
  text: string;
}

const BASE = '/api/kubernetes';

export default function PodTerminal({ namespace, podName, containerName, onClose }: PodTerminalProps) {
  const [command, setCommand] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'output', text: `Terminal: ${podName}/${containerName} in ${namespace}` },
    { type: 'output', text: '' },
    { type: 'output', text: 'Note: exec requires WebSocket. Commands are sent via HTTP POST.' },
    { type: 'output', text: 'For a full interactive shell, copy and run locally:' },
    { type: 'input', text: `$ oc exec -it ${podName} -n ${namespace} -c ${containerName} -- /bin/sh` },
    { type: 'output', text: '' },
    { type: 'output', text: 'Try simple commands like: ls, cat /etc/hostname, env, whoami' },
    { type: 'output', text: '' },
  ]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const execCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || running) return;

    setLines((prev) => [...prev, { type: 'input', text: `$ ${cmd}` }]);
    setRunning(true);
    setHistory((prev) => [cmd, ...prev.slice(0, 50)]);
    setHistoryIndex(-1);

    try {
      // Use exec endpoint with command
      const args = cmd.split(/\s+/);
      const params = new URLSearchParams();
      params.set('container', containerName);
      params.set('stdout', 'true');
      params.set('stderr', 'true');
      for (const arg of args) {
        params.append('command', arg);
      }

      const url = `${BASE}/api/v1/namespaces/${namespace}/pods/${podName}/exec?${params}`;

      // Try regular HTTP exec (won't work for interactive, but works for simple commands)
      // Fall back to using the log endpoint for read-only commands
      const res = await fetch(url, { method: 'POST' });

      if (res.ok) {
        const text = await res.text();
        const outputLines = text.split('\n');
        setLines((prev) => [...prev, ...outputLines.map((l) => ({ type: 'output' as const, text: l }))]);
      } else {
        // Exec requires WebSocket upgrade. Use a workaround: run via the exec subresource
        // For now, show the oc command the user can run locally
        const status = res.status;
        if (status === 400 || status === 403 || status === 101) {
          setLines((prev) => [
            ...prev,
            { type: 'error', text: `Exec requires WebSocket (status ${status}). Run locally:` },
            { type: 'output', text: `  oc exec -it ${podName} -n ${namespace} -c ${containerName} -- ${cmd}` },
          ]);
        } else {
          const body = await res.text().catch(() => res.statusText);
          setLines((prev) => [...prev, { type: 'error', text: `Error ${status}: ${body.slice(0, 200)}` }]);
        }
      }
    } catch (err) {
      setLines((prev) => [...prev, { type: 'error', text: `Failed: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setRunning(false);
      setCommand('');
    }
  }, [namespace, podName, containerName, running]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      execCommand(command);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        const newIdx = historyIndex + 1;
        setHistoryIndex(newIdx);
        setCommand(history[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setCommand(history[newIdx]);
      } else {
        setHistoryIndex(-1);
        setCommand('');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-[400px] bg-slate-950 border border-slate-700 rounded-t-lg shadow-2xl flex flex-col z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-900 rounded-t-lg">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-xs text-slate-400 font-mono ml-2">
              {podName}/{containerName} — {namespace}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Output */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed" onClick={() => inputRef.current?.focus()}>
          {lines.map((line, i) => (
            <div key={i} className={cn(
              line.type === 'input' ? 'text-green-400 font-semibold' :
              line.type === 'error' ? 'text-red-400' :
              'text-slate-300'
            )}>
              {line.text || '\u00A0'}
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Running...
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-700 bg-slate-900">
          <span className="text-green-400 text-xs font-mono">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type command..."
            disabled={running}
            className="flex-1 bg-transparent text-xs font-mono text-slate-200 placeholder-slate-600 outline-none"
            autoFocus
          />
          <button
            onClick={() => execCommand(command)}
            disabled={running || !command.trim()}
            className="text-slate-400 hover:text-slate-200 disabled:opacity-30"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
