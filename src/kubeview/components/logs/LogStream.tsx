/**
 * LogStream - Main streaming log viewer component
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Play, Pause, WrapText, Download, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseLogLine, detectLogFormat, type ParsedLogLine, type LogFormat } from './LogParser';

interface LogStreamProps {
  namespace: string;
  podName: string;
  containerName?: string;
  follow?: boolean;
  timestamps?: boolean;
  tailLines?: number;
  sinceSeconds?: number;
  onLineClick?: (line: ParsedLogLine) => void;
}

const MAX_LINES = 10000;

export default function LogStream({
  namespace,
  podName,
  containerName,
  follow = false,
  timestamps = true,
  tailLines = 1000,
  sinceSeconds,
  onLineClick,
}: LogStreamProps) {
  const [lines, setLines] = useState<ParsedLogLine[]>([]);
  const [isFollowing, setIsFollowing] = useState(follow);
  const [showTimestamps, setShowTimestamps] = useState(timestamps);
  const [wordWrap, setWordWrap] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logFormat, setLogFormat] = useState<LogFormat>('plain');

  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAtBottomRef = useRef(true);

  // Build API URL
  const buildLogUrl = useCallback((followMode: boolean) => {
    const params = new URLSearchParams({
      timestamps: 'true',
      tailLines: String(tailLines),
    });

    if (containerName) {
      params.set('container', containerName);
    }

    if (sinceSeconds) {
      params.set('sinceSeconds', String(sinceSeconds));
    }

    if (followMode) {
      params.set('follow', 'true');
    }

    return `/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}/log?${params}`;
  }, [namespace, podName, containerName, tailLines, sinceSeconds]);

  // Fetch logs
  useEffect(() => {
    let mounted = true;

    const fetchLogs = async () => {
      // Cancel any existing fetch
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      setLoading(true);
      setError(null);

      try {
        let url = buildLogUrl(isFollowing);
        let response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
        }

        // If current container has no logs (crashed/terminated), try previous container
        if (!isFollowing && !url.includes('previous=true')) {
          const currentText = await response.text();
          if (!currentText.trim()) {
            const prevUrl = url + (url.includes('?') ? '&' : '?') + 'previous=true';
            try {
              const prevResponse = await fetch(prevUrl, { signal: abortControllerRef.current.signal });
              if (prevResponse.ok) {
                response = prevResponse;
              }
            } catch {}
          } else {
            // Current has content — parse it directly and skip re-reading
            if (mounted) {
              const rawLines = currentText.split('\n').filter((l) => l.trim());
              const detected = detectLogFormat(rawLines);
              setLogFormat(detected);
              const parsedLines = rawLines.map((line) => parseLogLine(line, detected));
              setLines(parsedLines.length > MAX_LINES ? parsedLines.slice(-MAX_LINES) : parsedLines);
              setLoading(false);
            }
            return;
          }
        }

        if (isFollowing && response.body) {
          // Streaming mode
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const parsedLines: ParsedLogLine[] = [];

          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const newLines = buffer.split('\n');

            // Keep last incomplete line in buffer
            buffer = newLines.pop() || '';

            for (const line of newLines) {
              if (line.trim()) {
                const parsed = parseLogLine(line, logFormat);
                parsedLines.push(parsed);
              }
            }

            if (mounted) {
              // Detect format from first batch
              if (parsedLines.length > 0 && logFormat === 'plain') {
                const detected = detectLogFormat(parsedLines.map((l) => l.raw));
                setLogFormat(detected);
              }

              // Update lines, limiting to MAX_LINES
              setLines((prev) => {
                const combined = [...prev, ...parsedLines];
                if (combined.length > MAX_LINES) {
                  return combined.slice(-MAX_LINES);
                }
                return combined;
              });

              parsedLines.length = 0; // Clear for next batch
              setLoading(false);
            }
          }

          // Process any remaining buffer
          if (buffer.trim() && mounted) {
            const parsed = parseLogLine(buffer, logFormat);
            setLines((prev) => {
              const combined = [...prev, parsed];
              if (combined.length > MAX_LINES) {
                return combined.slice(-MAX_LINES);
              }
              return combined;
            });
          }
        } else {
          // Non-streaming mode
          const text = await response.text();
          const rawLines = text.split('\n').filter((l) => l.trim());

          if (mounted) {
            const detected = detectLogFormat(rawLines);
            setLogFormat(detected);

            const parsedLines = rawLines.map((line) => parseLogLine(line, detected));

            // Limit to MAX_LINES
            if (parsedLines.length > MAX_LINES) {
              setLines(parsedLines.slice(-MAX_LINES));
            } else {
              setLines(parsedLines);
            }
            setLoading(false);
          }
        }
      } catch (err) {
        if (mounted && err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchLogs();

    return () => {
      mounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [namespace, podName, containerName, isFollowing, buildLogUrl]);

  // Auto-scroll when following
  useEffect(() => {
    if (autoScroll && scrollAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Handle scroll to detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

    scrollAtBottomRef.current = isAtBottom;
    setAutoScroll(isAtBottom);
  }, []);

  // Filter lines based on search
  const filteredLines = searchQuery
    ? lines.filter((line) => {
        const query = searchQuery.toLowerCase();
        // Support negative filter with - prefix
        if (query.startsWith('-')) {
          const negativeQuery = query.slice(1);
          return !line.message.toLowerCase().includes(negativeQuery);
        }
        return line.message.toLowerCase().includes(query);
      })
    : lines;

  // Download logs
  const handleDownload = useCallback(() => {
    const text = filteredLines
      .map((line) => {
        const ts = line.timestamp ? line.timestamp.toISOString() + ' ' : '';
        const level = line.level ? `[${line.level.toUpperCase()}] ` : '';
        return `${ts}${level}${line.message}`;
      })
      .join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}-${containerName || 'logs'}-${new Date().toISOString().slice(0, 19)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredLines, podName, containerName]);

  // Copy logs
  const handleCopy = useCallback(() => {
    const text = filteredLines
      .map((line) => {
        const ts = line.timestamp ? line.timestamp.toISOString() + ' ' : '';
        const level = line.level ? `[${line.level.toUpperCase()}] ` : '';
        return `${ts}${level}${line.message}`;
      })
      .join('\n');

    navigator.clipboard.writeText(text);
  }, [filteredLines]);

  // Get level color class
  const getLevelColor = (level?: ParsedLogLine['level']) => {
    switch (level) {
      case 'debug':
        return 'text-slate-400';
      case 'info':
        return 'text-slate-200';
      case 'warn':
        return 'text-amber-400';
      case 'error':
        return 'text-red-400';
      case 'fatal':
        return 'text-red-500';
      default:
        return 'text-slate-300';
    }
  };

  // Highlight search matches
  const highlightMatch = (text: string, query: string) => {
    if (!query || query.startsWith('-')) return text;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="bg-amber-900/50 rounded px-0.5">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  const totalLines = lines.length;
  const matchCount = searchQuery ? filteredLines.length : totalLines;

  return (
    <div className="flex flex-col h-full bg-slate-950 rounded-lg border border-slate-700">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-700 bg-slate-900">
        <div className="flex items-center gap-2 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search logs... (prefix with - to exclude)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status */}
          <div className="text-xs text-slate-400 whitespace-nowrap">
            {searchQuery && `${matchCount} / `}
            {totalLines} {totalLines === MAX_LINES && '(max) '}lines
            {isFollowing && (
              <span className="ml-2 inline-flex items-center gap-1 text-green-400">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsFollowing(!isFollowing)}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition-colors"
            title={isFollowing ? 'Pause streaming' : 'Resume streaming'}
          >
            {isFollowing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={cn(
              'px-2 py-1.5 text-xs font-mono rounded transition-colors',
              showTimestamps
                ? 'bg-slate-700 text-slate-200'
                : 'hover:bg-slate-700 text-slate-400'
            )}
            title="Toggle timestamps"
          >
            TS
          </button>

          <button
            onClick={() => setWordWrap(!wordWrap)}
            className={cn(
              'p-1.5 rounded transition-colors',
              wordWrap ? 'bg-slate-700 text-slate-200' : 'hover:bg-slate-700 text-slate-400'
            )}
            title="Toggle word wrap"
          >
            <WrapText className="w-4 h-4" />
          </button>

          <button
            onClick={handleCopy}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition-colors"
            title="Copy logs"
          >
            <Copy className="w-4 h-4" />
          </button>

          <button
            onClick={handleDownload}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition-colors"
            title="Download logs"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto font-mono text-xs leading-relaxed"
      >
        {loading && lines.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400">
            Loading logs...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full text-red-400 p-4">
            {error}
          </div>
        )}

        {!loading && !error && filteredLines.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400">
            No logs found
          </div>
        )}

        {filteredLines.map((line, index) => (
          <div
            key={index}
            onClick={() => onLineClick?.(line)}
            className={cn(
              'flex border-b border-slate-900/50 hover:bg-slate-800/30 cursor-pointer px-3 py-0.5',
              index % 2 === 0 && 'bg-slate-900/20',
              getLevelColor(line.level)
            )}
          >
            {/* Line number */}
            <div className="w-14 flex-shrink-0 text-right pr-3 text-slate-500 select-none">
              {index + 1}
            </div>

            {/* Content */}
            <div className={cn('flex-1 min-w-0', !wordWrap && 'truncate')}>
              {showTimestamps && line.timestamp && (
                <span className="text-slate-500 mr-2">
                  {line.timestamp.toISOString().replace('T', ' ').slice(0, 23)}
                </span>
              )}
              {line.level && line.level !== 'unknown' && (
                <span className="font-semibold mr-2">[{line.level.toUpperCase()}]</span>
              )}
              <span className={wordWrap ? 'break-all' : ''}>
                {highlightMatch(line.message, searchQuery)}
              </span>
            </div>
          </div>
        ))}

        {totalLines >= MAX_LINES && (
          <div className="text-center py-2 text-xs text-amber-400 bg-slate-900/50">
            Showing last {MAX_LINES.toLocaleString()} lines
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-4 right-4 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded shadow-lg transition-colors"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
