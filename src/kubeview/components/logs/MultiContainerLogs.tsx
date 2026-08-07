/**
 * MultiContainerLogs - Container switcher for multi-container pods
 */

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import LogStream from './LogStream';
import { parseLogLine, type ParsedLogLine } from './LogParser';

interface Container {
  name: string;
  type: 'container' | 'init' | 'ephemeral';
  state: 'running' | 'waiting' | 'terminated';
}

interface MultiContainerLogsProps {
  namespace: string;
  podName: string;
  containers: Container[];
}

interface MergedLogLine extends ParsedLogLine {
  containerName: string;
  containerColor: string;
}

const CONTAINER_COLORS = [
  'text-blue-400',
  'text-green-400',
  'text-purple-400',
  'text-orange-400',
  'text-pink-400',
  'text-cyan-400',
  'text-amber-400',
  'text-emerald-400',
  'text-violet-400',
  'text-rose-400',
];

export default function MultiContainerLogs({
  namespace,
  podName,
  containers,
}: MultiContainerLogsProps) {
  const [selectedContainer, setSelectedContainer] = useState<string>('all');
  const [mergedLogs, setMergedLogs] = useState<MergedLogLine[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch and merge logs from all containers when "all" is selected
  useEffect(() => {
    if (selectedContainer !== 'all') {
      setMergedLogs([]);
      return;
    }

    let mounted = true;
    setLoading(true);

    const fetchAllLogs = async () => {
      try {
        const logPromises = containers.map(async (container, index) => {
          const url = `/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}/log?container=${container.name}&tailLines=500&timestamps=true`;
          const response = await fetch(url);

          if (!response.ok) {
            return [];
          }

          const text = await response.text();
          const lines = text.split('\n').filter((l) => l.trim());

          return lines.map((line) => {
            const parsed = parseLogLine(line);
            return {
              ...parsed,
              containerName: container.name,
              containerColor: CONTAINER_COLORS[index % CONTAINER_COLORS.length],
            };
          });
        });

        const allLogs = await Promise.all(logPromises);
        const merged = allLogs.flat();

        // Sort by timestamp
        merged.sort((a, b) => {
          if (!a.timestamp || !b.timestamp) return 0;
          return a.timestamp.getTime() - b.timestamp.getTime();
        });

        if (mounted) {
          setMergedLogs(merged);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch logs:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchAllLogs();

    return () => {
      mounted = false;
    };
  }, [selectedContainer, namespace, podName, containers]);

  // Get container state indicator
  const getStateIndicator = (state: Container['state']) => {
    switch (state) {
      case 'running':
        return <div className="w-2 h-2 bg-green-400 rounded-full" />;
      case 'waiting':
        return <div className="w-2 h-2 bg-yellow-400 rounded-full" />;
      case 'terminated':
        return <div className="w-2 h-2 bg-slate-500 rounded-full" />;
    }
  };

  // Get container type label
  const getTypeLabel = (type: Container['type']) => {
    switch (type) {
      case 'init':
        return '(init)';
      case 'ephemeral':
        return '(debug)';
      default:
        return '';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Container selector */}
      <div className="flex items-center gap-2 p-2 bg-slate-900 border-b border-slate-700 overflow-x-auto">
        <button
          onClick={() => setSelectedContainer('all')}
          className={cn(
            'px-3 py-1.5 text-sm rounded-sm whitespace-nowrap transition-colors',
            selectedContainer === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          )}
        >
          All {containers.length} container{containers.length !== 1 ? 's' : ''}
        </button>

        {containers.map((container) => (
          <button
            key={container.name}
            onClick={() => setSelectedContainer(container.name)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm rounded-sm whitespace-nowrap transition-colors',
              selectedContainer === container.name
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            )}
          >
            {getStateIndicator(container.state)}
            <span>
              {container.name} {getTypeLabel(container.type)}
            </span>
          </button>
        ))}
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-hidden">
        {selectedContainer === 'all' ? (
          <div className="h-full overflow-auto bg-slate-950 font-mono text-xs leading-relaxed">
            {loading && (
              <div className="flex items-center justify-center h-full text-slate-400">
                Loading logs from all containers...
              </div>
            )}

            {!loading && mergedLogs.length === 0 && (
              <div className="flex items-center justify-center h-full text-slate-400">
                No logs found
              </div>
            )}

            {!loading &&
              mergedLogs.map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex border-b border-slate-900/50 hover:bg-slate-800/30 px-3 py-0.5',
                    index % 2 === 0 && 'bg-slate-900/20'
                  )}
                >
                  {/* Line number */}
                  <div className="w-14 shrink-0 text-right pr-3 text-slate-500 select-none">
                    {index + 1}
                  </div>

                  {/* Container name prefix */}
                  <div className={cn('w-32 shrink-0 pr-3 font-semibold', line.containerColor)}>
                    [{line.containerName}]
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {line.timestamp && (
                      <span className="text-slate-500 mr-2">
                        {line.timestamp.toISOString().replace('T', ' ').slice(0, 23)}
                      </span>
                    )}
                    {line.level && line.level !== 'unknown' && (
                      <span className="font-semibold mr-2">[{line.level.toUpperCase()}]</span>
                    )}
                    <span className="break-all">{line.message}</span>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <LogStream
            key={selectedContainer}
            namespace={namespace}
            podName={podName}
            containerName={selectedContainer}
            timestamps={true}
          />
        )}
      </div>
    </div>
  );
}
