import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Loader2, Terminal, Copy, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PodTerminalProps {
  namespace: string;
  podName: string;
  containerName: string;
  onClose: () => void;
  isNode?: boolean;
}

interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'system';
  text: string;
  timestamp?: string;
}

import { K8S_BASE as BASE } from '../engine/gvr';

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function PodTerminal({ namespace, podName, containerName, onClose, isNode }: PodTerminalProps) {
  const [command, setCommand] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'system', text: isNode ? `node/${podName}` : `${namespace}/${podName}`, timestamp: timestamp() },
    { type: 'system', text: `container: ${containerName}`, timestamp: timestamp() },
    { type: 'system', text: isNode ? 'Suggestions: cat /etc/os-release, df -h, free -m, uptime, ps aux' : 'Suggestions: whoami, ls, env, cat /etc/hostname, ps aux', timestamp: timestamp() },
  ]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const handleCopyOutput = () => {
    const text = lines.filter(l => l.type !== 'system').map(l => l.text).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setLines([{ type: 'system', text: 'Terminal cleared', timestamp: timestamp() }]);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const execCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || running) return;

    const ts = timestamp();
    setLines((prev) => [...prev, { type: 'input', text: `$ ${cmd}`, timestamp: ts }]);
    setRunning(true);
    setHistory((prev) => {
      if (prev[0] === cmd) return prev;
      return [cmd, ...prev.slice(0, 50)];
    });
    setHistoryIndex(-1);

    // Handle built-in commands
    if (cmd.trim() === 'clear') {
      handleClear();
      setRunning(false);
      setCommand('');
      return;
    }

    try {
      const args = cmd.split(/\s+/);
      const params = new URLSearchParams();
      params.set('container', containerName);
      params.set('stdout', 'true');
      params.set('stderr', 'true');
      for (const arg of args) {
        params.append('command', arg);
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${BASE}/api/v1/namespaces/${namespace}/pods/${podName}/exec?${params}`;

      const output = await new Promise<string>((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const ws = new WebSocket(wsUrl, ['v4.channel.k8s.io']);
        ws.binaryType = 'arraybuffer';

        const timeout = setTimeout(() => {
          timedOut = true;
          ws.close();
          resolve(stdout || stderr || '(no output)');
        }, 10000);

        ws.onmessage = (event) => {
          const data = new Uint8Array(event.data as ArrayBuffer);
          if (data.length < 2) return;
          const channel = data[0];
          const text = new TextDecoder().decode(data.slice(1));
          if (channel === 1) stdout += text;
          else if (channel === 2) stderr += text;
          else if (channel === 3) {
            try {
              const status = JSON.parse(text);
              if (status.status === 'Success') return;
              stderr += status.message || text;
            } catch {
              stderr += text;
            }
          }
        };

        ws.onclose = () => {
          if (timedOut) return;
          clearTimeout(timeout);
          if (stderr && !stdout) reject(new Error(stderr.trim()));
          else resolve((stdout + stderr).trim() || '(no output)');
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };
      });

      const outputLines = output.split('\n');
      setLines((prev) => [...prev, ...outputLines.map((l) => ({ type: 'output' as const, text: l }))]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLines((prev) => [
        ...prev,
        { type: 'error', text: msg },
        { type: 'system', text: `Run locally: oc exec -it ${podName} -n ${namespace} -c ${containerName} -- ${cmd}` },
      ]);
    } finally {
      setRunning(false);
      setCommand('');
      setTimeout(() => inputRef.current?.focus(), 0);
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
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      handleClear();
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
      if (running) {
        setRunning(false);
        setLines((prev) => [...prev, { type: 'system', text: '^C' }]);
      }
    }
  };

  const commandCount = lines.filter(l => l.type === 'input').length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl h-[480px] bg-[var(--kv-term-bg)] border border-slate-700 rounded-t-xl shadow-2xl flex flex-col z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-[var(--kv-term-surface)] rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors" title="Close" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <div className="flex items-center gap-2 ml-2">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-300 font-mono font-medium">{containerName}</span>
              <span className="text-xs text-slate-600">in</span>
              <span className="text-xs text-slate-400 font-mono">{podName}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 font-mono">{namespace}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {commandCount > 0 && (
              <span className="text-[10px] text-slate-600 mr-2">{commandCount} command{commandCount !== 1 ? 's' : ''}</span>
            )}
            <button
              onClick={handleCopyOutput}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
              title="Copy output"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
              title="Clear (Ctrl+L)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors" title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Output */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 font-mono text-[13px] leading-[1.6] select-text" onClick={() => inputRef.current?.focus()}>
          {lines.map((line, i) => (
            <div key={i} className="flex gap-2 group">
              {line.timestamp && (
                <span className="text-[10px] text-slate-700 tabular-nums w-16 shrink-0 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {line.timestamp}
                </span>
              )}
              <div className={cn(
                'flex-1 min-w-0',
                line.type === 'input' ? 'text-[var(--kv-term-prompt)] font-medium' :
                line.type === 'error' ? 'text-[var(--kv-term-error)]' :
                line.type === 'system' ? 'text-slate-600 italic text-xs' :
                'text-[var(--kv-term-text)]'
              )}>
                {line.text || '\u00A0'}
              </div>
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-slate-600 mt-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-xs">Executing...</span>
              <span className="text-[10px] text-slate-700">(Ctrl+C to cancel)</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-800 bg-[var(--kv-term-surface)]">
          <span className="text-[var(--kv-term-prompt)] text-sm font-mono font-bold">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={running ? 'Waiting...' : 'Enter command...'}
            disabled={running}
            className="flex-1 bg-transparent text-[13px] font-mono text-[var(--kv-term-text)] placeholder-slate-700 outline-none caret-[var(--kv-term-prompt)]"
            autoFocus
          />
          {history.length > 0 && !running && (
            <span className="text-[10px] text-slate-700 hidden sm:block">
              {history.length} in history
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
