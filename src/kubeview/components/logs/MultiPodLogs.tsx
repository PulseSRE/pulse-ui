/**
 * MultiPodLogs - Aggregate logs across multiple pods (for Deployment view)
 */

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import LogStream from './LogStream';
import { parseLogLine, type ParsedLogLine } from './LogParser';
import { pickDefaultContainer } from './pickDefaultContainer';

interface MultiPodLogsProps {
  namespace: string;
  podNames: string[];
  containerName?: string;
}

interface MergedLogLine extends ParsedLogLine {
  podName: string;
  podColor: string;
}

const POD_COLORS = [
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

export default function MultiPodLogs({
  namespace,
  podNames,
  containerName,
}: MultiPodLogsProps) {
  const [selectedPod, setSelectedPod] = useState<string>('all');
  const [mergedLogs, setMergedLogs] = useState<MergedLogLine[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch and merge logs from all pods when "all" is selected
  useEffect(() => {
    if (selectedPod !== 'all') {
      setMergedLogs([]);
      return;
    }

    let mounted = true;
    setLoading(true);

    const fetchAllLogs = async () => {
      try {
        const logPromises = podNames.map(async (podName, index) => {
          const params = new URLSearchParams({
            timestamps: 'true',
            tailLines: '300',
          });

          if (containerName) {
            params.set('container', containerName);
          }

          const url = `/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}/log?${params}`;
          let response = await fetch(url);

          // 400 = multi-container pod without container param — auto-detect first container
          if (response.status === 400 && !containerName) {
            try {
              const podRes = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}`);
              if (podRes.ok) {
                const podData = await podRes.json();
                const containerNames = (podData?.spec?.containers ?? []).map((c: { name?: string }) => c.name);
                const defaultContainer = pickDefaultContainer(containerNames);
                if (defaultContainer) {
                  params.set('container', defaultContainer);
                  response = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}/log?${params}`);
                }
              }
            } catch { /* fall through */ }
          }

          if (!response.ok) {
            return [];
          }

          const text = await response.text();
          const lines = text.split('\n').filter((l) => l.trim());

          return lines.map((line) => {
            const parsed = parseLogLine(line);
            return {
              ...parsed,
              podName: truncatePodName(podName),
              podColor: POD_COLORS[index % POD_COLORS.length],
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
  }, [selectedPod, namespace, podNames, containerName]);

  // Truncate pod name for display (remove hash suffix)
  const truncatePodName = (podName: string): string => {
    // Pattern: deployment-name-xxxxxxxxxx-xxxxx
    // Keep deployment name + first 5 chars of hash
    const parts = podName.split('-');
    if (parts.length >= 3) {
      // Return all but last part, plus first 5 chars of last part
      const lastPart = parts[parts.length - 1];
      const hashPart = parts[parts.length - 2];
      return `${parts.slice(0, -2).join('-')}-${hashPart.slice(0, 5)}`;
    }
    return podName;
  };

  // Get display name for pod button
  const getPodDisplayName = (podName: string): string => {
    const truncated = truncatePodName(podName);
    return truncated.length < podName.length ? `${truncated}…` : truncated;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Pod selector */}
      <div className="flex items-center gap-2 p-2 bg-slate-900 border-b border-slate-700 overflow-x-auto">
        <button
          onClick={() => setSelectedPod('all')}
          className={cn(
            'px-3 py-1.5 text-sm rounded-sm whitespace-nowrap transition-colors',
            selectedPod === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          )}
        >
          All {podNames.length} pod{podNames.length !== 1 ? 's' : ''}
        </button>

        {podNames.map((podName, index) => (
          <button
            key={podName}
            onClick={() => setSelectedPod(podName)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm rounded-sm whitespace-nowrap transition-colors',
              selectedPod === podName
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            )}
            title={podName}
          >
            <div
              className={cn('w-2 h-2 rounded-full', POD_COLORS[index % POD_COLORS.length].replace('text-', 'bg-'))}
            />
            <span>{getPodDisplayName(podName)}</span>
          </button>
        ))}
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-hidden">
        {selectedPod === 'all' ? (
          <div className="h-full overflow-auto bg-slate-950 font-mono text-xs leading-relaxed">
            {loading && (
              <div className="flex items-center justify-center h-full text-slate-400">
                Loading logs from {podNames.length} pod{podNames.length !== 1 ? 's' : ''}...
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

                  {/* Pod name prefix */}
                  <div className={cn('w-32 shrink-0 pr-3 font-semibold', line.podColor)}>
                    [{line.podName}]
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
            namespace={namespace}
            podName={selectedPod}
            containerName={containerName}
            follow={true}
            timestamps={true}
          />
        )}
      </div>
    </div>
  );
}
