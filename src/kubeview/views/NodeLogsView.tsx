import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Search, Download, RefreshCw, FileText, Shield, Server, Box } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

import { K8S_BASE as BASE } from '../engine/gvr';

type LogSource = 'audit' | 'journal' | 'crio' | 'containers' | 'ovn';

const LOG_SOURCES: Array<{ id: LogSource; label: string; icon: React.ReactNode; path: string; description: string }> = [
  { id: 'audit', label: 'Audit Logs', icon: <Shield className="w-4 h-4" />, path: 'audit/', description: 'API server audit events' },
  { id: 'journal', label: 'Journal', icon: <Server className="w-4 h-4" />, path: 'journal/', description: 'System journal (kubelet, crio)' },
  { id: 'crio', label: 'CRI-O', icon: <Box className="w-4 h-4" />, path: 'crio/', description: 'Container runtime logs' },
  { id: 'containers', label: 'Containers', icon: <Box className="w-4 h-4" />, path: 'containers/', description: 'Container stdout/stderr' },
  { id: 'ovn', label: 'OVN/Network', icon: <Server className="w-4 h-4" />, path: 'ovn/', description: 'OVN networking logs' },
];

export default function NodeLogsView() {
  const { name } = useParams<{ name: string }>();
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);

  const [activeSource, setActiveSource] = useState<LogSource>('audit');
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [logContent, setLogContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const source = LOG_SOURCES.find((s) => s.id === activeSource)!;

  // Fetch file list for active source
  useEffect(() => {
    if (!name) return;
    setFiles([]);
    setSelectedFile(null);
    setLogContent('');

    const fetchFiles = async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/nodes/${name}/proxy/logs/${source.path}`);
        if (!res.ok) { setFiles([]); return; }
        const html = await res.text();
        // Parse file links from HTML directory listing
        const links = [...html.matchAll(/href="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((f) => !f.startsWith('/') && f !== '../' && !f.endsWith('/'))
          .sort()
          .reverse();
        setFiles(links);
        if (links.length > 0) setSelectedFile(links[0]);
      } catch {
        setFiles([]);
      }
    };
    fetchFiles();
  }, [name, source.path]);

  // Fetch log content for selected file
  useEffect(() => {
    if (!name || !selectedFile) { setLogContent(''); return; }
    setLoading(true);

    const fetchLog = async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/nodes/${name}/proxy/logs/${source.path}${selectedFile}`);
        if (!res.ok) { setLogContent(`Error: ${res.status} ${res.statusText}`); return; }
        const text = await res.text();
        // Limit to last 500 lines for performance
        const lines = text.split('\n');
        setLogContent(lines.length > 500 ? lines.slice(-500).join('\n') : text);
      } catch (err) {
        setLogContent(`Failed to fetch: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    };
    fetchLog();
  }, [name, selectedFile, source.path]);

  // Filter log lines by search
  const filteredLines = React.useMemo(() => {
    if (!logContent) return [];
    const lines = logContent.split('\n');
    if (!searchQuery) return lines;
    const q = searchQuery.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [logContent, searchQuery]);

  const handleDownload = () => {
    if (!logContent || !selectedFile) return;
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${activeSource}-${selectedFile}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRefresh = () => {
    setSelectedFile((f) => { const tmp = f; setSelectedFile(null); setTimeout(() => setSelectedFile(tmp), 100); return f; });
  };

  if (!name) return null;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => go(`/r/v1~nodes/_/${name}`, name)} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200">
            <ArrowLeft size={16} />
          </button>
          <Server className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-200">Node Logs</span>
          <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-300 rounded">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={handleDownload} disabled={!logContent} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30" title="Download">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Source tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-800 overflow-x-auto shrink-0">
        {LOG_SOURCES.map((src) => (
          <button
            key={src.id}
            onClick={() => setActiveSource(src.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap',
              activeSource === src.id ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            )}
          >
            {src.icon}
            {src.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list sidebar */}
        <div className="w-56 border-r border-slate-800 overflow-auto shrink-0 bg-slate-900">
          <div className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">
            Files ({files.length})
          </div>
          {files.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-500 text-center">No log files found</div>
          ) : (
            files.map((file) => (
              <button
                key={file}
                onClick={() => setSelectedFile(file)}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-xs transition-colors truncate flex items-center gap-1.5',
                  selectedFile === file ? 'bg-blue-950/50 text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                )}
              >
                <FileText className="w-3 h-3 flex-shrink-0" />
                {file}
              </button>
            ))
          )}
        </div>

        {/* Log content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2 border-b border-slate-800 shrink-0">
            <div className="relative max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter log lines..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  {filteredLines.length} lines
                </span>
              )}
            </div>
          </div>

          {/* Log output */}
          <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed bg-slate-950">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-500">Loading...</div>
            ) : !selectedFile ? (
              <div className="flex items-center justify-center h-full text-slate-500">Select a log file</div>
            ) : filteredLines.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                {searchQuery ? `No lines match "${searchQuery}"` : 'Log file is empty'}
              </div>
            ) : (
              <div className="p-3">
                {filteredLines.map((line, i) => {
                  const isError = /error|fail|panic|fatal/i.test(line);
                  const isWarning = /warn|warning/i.test(line);
                  return (
                    <div key={i} className={cn(
                      'py-0.5 border-b border-slate-900/30',
                      isError ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-slate-300'
                    )}>
                      <span className="text-slate-600 select-none mr-3">{i + 1}</span>
                      {line || '\u00A0'}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
