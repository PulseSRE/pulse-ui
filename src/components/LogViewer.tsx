/**
 * LogViewer Component - Live log streaming viewer
 *
 * Required CSS classes (prefix: compass-log-):
 *
 *   .compass-log-viewer          - Root container, flex column, full height, border
 *   .compass-log-toolbar         - Toolbar area, flex row, gap, padding, border-bottom, align-items center
 *   .compass-log-toolbar-group   - Grouping within toolbar, flex row, gap, align-items center
 *   .compass-log-body            - Log content area, flex 1, overflow-y auto, font-family monospace, font-size 13px
 *   .compass-log-line            - Single log line, flex row, padding 2px 12px, white-space pre-wrap (toggled)
 *   .compass-log-line--even      - Even rows: subtle background (e.g., rgba(0,0,0,0.02) light / rgba(255,255,255,0.02) dark)
 *   .compass-log-line--error     - color: var(--pf-t--global--color--status--danger--default, #c9190b)
 *   .compass-log-line--warn      - color: var(--pf-t--global--color--status--warning--default, #f0ab00)
 *   .compass-log-line--debug     - color: var(--pf-t--global--color--disabled--default, #6a6e73); opacity 0.75
 *   .compass-log-line-number     - width 50px, text-align right, user-select none, color muted, padding-right 12px, flex-shrink 0
 *   .compass-log-line-content    - flex 1, min-width 0
 *   .compass-log-line--nowrap    - white-space nowrap, overflow-x hidden, text-overflow ellipsis
 *   .compass-log-highlight       - background-color: yellow; color: black (search match highlight)
 *   .compass-log-status          - Toolbar status text (line count, streaming indicator), font-size small, color muted
 *   .compass-log-paused-banner   - Small banner indicating streaming is paused
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Button,
  SearchInput,
  Select,
  SelectOption,
  MenuToggle,
} from '@patternfly/react-core';
import {
  PlayIcon,
  PauseIcon,
  DownloadIcon,
  CopyIcon,
  CompressIcon,
  ExpandIcon,
} from '@patternfly/react-icons';
import { useUIStore } from '@/store/useUIStore';

interface LogViewerProps {
  podName: string;
  namespace: string;
  containers: string[];
  /** When provided, renders this text directly instead of fetching pod logs. Disables streaming and container selection. */
  rawText?: string;
  /** Whether rawText is still loading */
  rawLoading?: boolean;
}

interface LogLine {
  id: number;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
}

type LogLevel = LogLine['level'];

function detectLevel(message: string): LogLevel {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return 'ERROR';
  if (lower.includes('warn')) return 'WARN';
  if (lower.includes('debug') || lower.includes('trace')) return 'DEBUG';
  return 'INFO';
}

function parseLogLines(text: string, startId: number): LogLine[] {
  const lines = text.split('\n').filter((line) => line.length > 0);
  return lines.map((line, index) => {
    // K8s log format: 2024-01-15T10:30:00.123456789Z log message here
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\S+?Z?)\s+(.*)/);
    let timestamp: string;
    let message: string;
    if (timestampMatch) {
      timestamp = timestampMatch[1];
      message = timestampMatch[2];
    } else {
      timestamp = new Date().toISOString();
      message = line;
    }
    return {
      id: startId + index,
      timestamp,
      level: detectLevel(message),
      message,
    };
  });
}

function formatTimestamp(ts: string): string {
  return ts.replace('T', ' ').replace('Z', '').replace(/\.\d+$/, '');
}

function getLogLevelClass(level: LogLevel): string {
  switch (level) {
    case 'ERROR': return 'compass-log-line--error';
    case 'WARN': return 'compass-log-line--warn';
    case 'DEBUG': return 'compass-log-line--debug';
    default: return '';
  }
}

function highlightText(text: string, search: string): React.ReactNode {
  if (!search) return text;

  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedSearch})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="compass-log-highlight">{part}</span>
    ) : (
      part
    )
  );
}

export default function LogViewer({ podName, namespace, containers, rawText, rawLoading }: LogViewerProps) {
  const isRawMode = rawText !== undefined;
  const addToast = useUIStore((s) => s.addToast);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchValue, setSearchValue] = useState('');
  const [selectedContainer, setSelectedContainer] = useState(containers[0] ?? '');
  const [containerSelectOpen, setContainerSelectOpen] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);

  const logBodyRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(1);

  // Parse rawText into log lines when in raw mode
  useEffect(() => {
    if (!isRawMode) return;
    if (!rawText) { setLogs([]); return; }
    const parsed = parseLogLines(rawText, 1);
    setLogs(parsed);
  }, [isRawMode, rawText]);

  // Initial log fetch
  useEffect(() => {
    if (isRawMode || !podName || !namespace || !selectedContainer) return;

    let cancelled = false;
    nextIdRef.current = 1;

    async function fetchInitialLogs() {
      try {
        const url = `/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}/log?container=${selectedContainer}&tailLines=500&timestamps=true`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const text = await res.text();
        if (cancelled) return;
        const parsed = parseLogLines(text, nextIdRef.current);
        nextIdRef.current += parsed.length;
        setLogs(parsed);
      } catch (err) {
        if (!cancelled) {
          addToast({
            type: 'error',
            title: 'Failed to fetch logs',
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    setLogs([]);
    fetchInitialLogs();

    return () => { cancelled = true; };
  }, [podName, namespace, selectedContainer, addToast]);

  // Polling for new log lines
  useEffect(() => {
    if (isRawMode || !streaming || !podName || !namespace || !selectedContainer) return;

    const interval = setInterval(async () => {
      try {
        const url = `/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}/log?container=${selectedContainer}&sinceSeconds=3&timestamps=true`;
        const res = await fetch(url);
        if (!res.ok) return;
        const text = await res.text();
        if (!text.trim()) return;
        const newLines = parseLogLines(text, nextIdRef.current);
        if (newLines.length > 0) {
          nextIdRef.current += newLines.length;
          setLogs((prev) => [...prev, ...newLines]);
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [streaming, podName, namespace, selectedContainer]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect manual scroll to pause auto-scroll
  const handleScroll = useCallback(() => {
    const el = logBodyRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const filteredLogs = useMemo(() => {
    if (!searchValue) return logs;
    const lower = searchValue.toLowerCase();
    return logs.filter(
      (line) =>
        line.message.toLowerCase().includes(lower) ||
        line.level.toLowerCase().includes(lower)
    );
  }, [logs, searchValue]);

  const rawLogText = useCallback((): string => {
    return filteredLogs
      .map(
        (line) =>
          `${formatTimestamp(line.timestamp)} [${line.level}] ${line.message}`
      )
      .join('\n');
  }, [filteredLogs]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(rawLogText()).then(() => {
      addToast({
        type: 'success',
        title: 'Logs copied',
        description: `${filteredLogs.length} log lines copied to clipboard`,
      });
    }).catch(() => {
      addToast({
        type: 'error',
        title: 'Copy failed',
        description: 'Unable to copy logs to clipboard',
      });
    });
  }, [rawLogText, filteredLogs.length, addToast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([rawLogText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}_${selectedContainer}_${new Date().toISOString().slice(0, 19)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({
      type: 'success',
      title: 'Logs downloaded',
      description: `Saved ${filteredLogs.length} log lines`,
    });
  }, [rawLogText, podName, selectedContainer, filteredLogs.length, addToast]);

  const handleToggleStreaming = useCallback(() => {
    setStreaming((prev) => !prev);
  }, []);

  const handleToggleWordWrap = useCallback(() => {
    setWordWrap((prev) => !prev);
  }, []);

  const handleToggleTimestamps = useCallback(() => {
    setShowTimestamps((prev) => !prev);
  }, []);

  return (
    <div className="compass-log-viewer">
      <div className="compass-log-toolbar">
        <div className="compass-log-toolbar-group">
          {!isRawMode && (
            <Select
              isOpen={containerSelectOpen}
              selected={selectedContainer}
              onSelect={(_event, selection) => {
                setSelectedContainer(selection as string);
                setContainerSelectOpen(false);
              }}
              onOpenChange={(isOpen) => setContainerSelectOpen(isOpen)}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setContainerSelectOpen(!containerSelectOpen)}
                  className="os-log__container-toggle"
                >
                  {selectedContainer}
                </MenuToggle>
              )}
            >
              {containers.map((container) => (
                <SelectOption key={container} value={container}>
                  {container}
                </SelectOption>
              ))}
            </Select>
          )}

          <SearchInput
            placeholder="Filter logs..."
            value={searchValue}
            onChange={(_event, value) => setSearchValue(value)}
            onClear={() => setSearchValue('')}
            className="os-log__search-input"
          />
        </div>

        <div className="compass-log-toolbar-group">
          <span className="compass-log-status">
            {rawLoading ? 'Loading...' : `${filteredLogs.length} lines`}
            {searchValue && ` (filtered from ${logs.length})`}
            {!isRawMode && streaming && (
              <span className="compass-log-status-streaming"> ● Streaming</span>
            )}
          </span>

          {!isRawMode && (
            <Button
              variant="plain"
              onClick={handleToggleStreaming}
              aria-label={streaming ? 'Pause streaming' : 'Resume streaming'}
              title={streaming ? 'Pause streaming' : 'Resume streaming'}
            >
              {streaming ? <PauseIcon /> : <PlayIcon />}
            </Button>
          )}

          <Button
            variant="plain"
            onClick={handleToggleTimestamps}
            aria-label={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
            title={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
          >
            {showTimestamps ? 'TS' : <span className="os-log__timestamps-inactive">TS</span>}
          </Button>

          <Button
            variant="plain"
            onClick={handleToggleWordWrap}
            aria-label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          >
            {wordWrap ? <CompressIcon /> : <ExpandIcon />}
          </Button>

          <Button
            variant="plain"
            onClick={handleCopy}
            aria-label="Copy all logs"
            title="Copy all logs"
          >
            <CopyIcon />
          </Button>

          <Button
            variant="plain"
            onClick={handleDownload}
            aria-label="Download logs"
            title="Download logs"
          >
            <DownloadIcon />
          </Button>
        </div>
      </div>

      {!streaming && (
        <div className="compass-log-paused-banner">
          Streaming paused.{' '}
          <Button variant="link" isInline onClick={handleToggleStreaming}>
            Resume
          </Button>
        </div>
      )}

      <div
        className="compass-log-body"
        ref={logBodyRef}
        onScroll={handleScroll}
      >
        {filteredLogs.map((line, index) => {
          const levelClass = getLogLevelClass(line.level);
          const evenClass = index % 2 === 0 ? 'compass-log-line--even' : '';
          const wrapClass = !wordWrap ? 'compass-log-line--nowrap' : '';

          return (
            <div
              key={line.id}
              className={`compass-log-line ${evenClass} ${levelClass} ${wrapClass}`}
            >
              <span className="compass-log-line-number">{line.id}</span>
              <span className="compass-log-line-content">
                {showTimestamps && (
                  <span className="compass-log-timestamp">
                    {formatTimestamp(line.timestamp)}{' '}
                  </span>
                )}
                <span className="compass-log-level">[{line.level}]</span>{' '}
                {highlightText(line.message, searchValue)}
              </span>
            </div>
          );
        })}
      </div>

      {!autoScroll && (
        <Button
          className="compass-log-scroll-bottom"
          variant="primary"
          size="sm"
          onClick={() => {
            setAutoScroll(true);
            if (logBodyRef.current) {
              logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
            }
          }}
        >
          Scroll to bottom
        </Button>
      )}

      <style>{`
        .compass-log-viewer {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 400px;
          border: 1px solid var(--glass-border, #30363d);
          border-radius: 8px;
          overflow: hidden;
          position: relative;
        }

        .compass-log-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--glass-border, #30363d);
          background: rgba(15, 23, 42, 0.8);
          color: #e2e8f0;
        }

        .compass-log-toolbar-group {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .compass-log-body {
          flex: 1;
          overflow-y: auto;
          overflow-x: auto;
          font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Red Hat Mono', 'Consolas', monospace;
          font-size: 13px;
          line-height: 1.6;
          padding: 4px 0;
          background: rgba(15, 23, 42, 0.95);
          color: #e2e8f0;
        }

        .compass-log-line {
          display: flex;
          flex-direction: row;
          padding: 1px 12px;
          white-space: pre-wrap;
          word-break: break-all;
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }

        .compass-log-line--even {
          background: rgba(255, 255, 255, 0.02);
        }

        .compass-log-line:hover {
          background: rgba(59, 130, 246, 0.08);
        }

        .compass-log-line--nowrap {
          white-space: nowrap;
          overflow: hidden;
        }

        .compass-log-line--nowrap .compass-log-line-content {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .compass-log-line--error {
          color: #f87171;
        }

        .compass-log-line--warn {
          color: #fbbf24;
        }

        .compass-log-line--debug {
          color: #6b7280;
          opacity: 0.75;
        }

        .compass-log-line-number {
          width: 50px;
          min-width: 50px;
          text-align: right;
          padding-right: 12px;
          user-select: none;
          color: rgba(148, 163, 184, 0.5);
          flex-shrink: 0;
        }

        .compass-log-line-content {
          flex: 1;
          min-width: 0;
        }

        .compass-log-timestamp {
          color: rgba(148, 163, 184, 0.7);
        }

        .compass-log-level {
          font-weight: 600;
        }

        .compass-log-highlight {
          background: rgba(250, 204, 21, 0.3);
          color: #fff;
          border-radius: 2px;
          padding: 0 1px;
        }

        .compass-log-status {
          font-size: 12px;
          color: rgba(148, 163, 184, 0.7);
          white-space: nowrap;
        }

        .compass-log-status-streaming {
          color: #4ade80;
          animation: compass-log-pulse 2s ease-in-out infinite;
        }

        .compass-log-paused-banner {
          padding: 4px 12px;
          font-size: 12px;
          background: #f59e0b;
          color: #000;
          text-align: center;
        }

        .compass-log-scroll-bottom {
          position: absolute;
          bottom: 16px;
          right: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          z-index: 10;
        }

        @keyframes compass-log-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
