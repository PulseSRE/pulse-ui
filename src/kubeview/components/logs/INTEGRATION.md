# Integration Guide

How to integrate KubeView log viewer components into your application.

## Pod Detail Page

Example integration in a Pod detail page with tabs:

```tsx
import React, { useState } from 'react';
import { V1Pod } from '@kubernetes/client-node';
import { MultiContainerLogs } from '@/kubeview/components/logs';

interface PodDetailPageProps {
  pod: V1Pod;
}

export default function PodDetailPage({ pod }: PodDetailPageProps) {
  const namespace = pod.metadata?.namespace ?? 'default';
  const podName = pod.metadata?.name ?? '';

  // Extract container info from pod spec and status
  const containers = [
    // Regular containers
    ...(pod.spec?.containers ?? []).map((c) => {
      const status = pod.status?.containerStatuses?.find((s) => s.name === c.name);
      return {
        name: c.name,
        type: 'container' as const,
        state: getContainerState(status),
      };
    }),
    // Init containers
    ...(pod.spec?.initContainers ?? []).map((c) => {
      const status = pod.status?.initContainerStatuses?.find((s) => s.name === c.name);
      return {
        name: c.name,
        type: 'init' as const,
        state: getContainerState(status),
      };
    }),
    // Ephemeral containers
    ...(pod.spec?.ephemeralContainers ?? []).map((c) => {
      const status = pod.status?.ephemeralContainerStatuses?.find((s) => s.name === c.name);
      return {
        name: c.name,
        type: 'ephemeral' as const,
        state: getContainerState(status),
      };
    }),
  ];

  return (
    <div className="h-full">
      <MultiContainerLogs
        namespace={namespace}
        podName={podName}
        containers={containers}
      />
    </div>
  );
}

function getContainerState(status: any): 'running' | 'waiting' | 'terminated' {
  if (!status) return 'waiting';
  if (status.state?.running) return 'running';
  if (status.state?.terminated) return 'terminated';
  return 'waiting';
}
```

## Deployment Detail Page

Example integration showing logs from all pods in a Deployment:

```tsx
import React from 'react';
import { V1Deployment, V1Pod } from '@kubernetes/client-node';
import { MultiPodLogs } from '@/kubeview/components/logs';

interface DeploymentLogsTabProps {
  deployment: V1Deployment;
  pods: V1Pod[];
}

export default function DeploymentLogsTab({ deployment, pods }: DeploymentLogsTabProps) {
  const namespace = deployment.metadata?.namespace ?? 'default';
  const podNames = pods
    .filter((p) => p.metadata?.name)
    .map((p) => p.metadata!.name!);

  // Get primary container name from deployment spec
  const containerName = deployment.spec?.template?.spec?.containers?.[0]?.name;

  return (
    <div className="h-full">
      {podNames.length === 0 ? (
        <div className="flex items-center justify-center h-full text-slate-400">
          No pods found for this deployment
        </div>
      ) : (
        <MultiPodLogs
          namespace={namespace}
          podNames={podNames}
          containerName={containerName}
        />
      )}
    </div>
  );
}
```

## Standalone Log Viewer

Simple standalone log viewer component:

```tsx
import React from 'react';
import { LogStream } from '@/kubeview/components/logs';

interface SimpleLogViewerProps {
  namespace: string;
  podName: string;
  containerName?: string;
}

export default function SimpleLogViewer({
  namespace,
  podName,
  containerName,
}: SimpleLogViewerProps) {
  return (
    <div className="h-screen">
      <LogStream
        namespace={namespace}
        podName={podName}
        containerName={containerName}
        follow={true}
        timestamps={true}
        tailLines={1000}
      />
    </div>
  );
}
```

## Advanced: Reacting to Line Clicks

`LogStream` exposes an `onLineClick` callback so a parent can react when a user clicks a line (for example, to log it or feed it into your own custom panel). Note there is no built-in `LogContext` component shipped today — a context panel (surrounding lines, structured fields, similar occurrences) was explored but never implemented, so you'd need to build your own if you want that UX.

```tsx
import React, { useState, useCallback } from 'react';
import { LogStream, type ParsedLogLine } from '@/kubeview/components/logs';

export default function LogViewerWithClickHandling() {
  const [selectedLine, setSelectedLine] = useState<ParsedLogLine | null>(null);

  const handleLineClick = useCallback((line: ParsedLogLine) => {
    setSelectedLine(line);
  }, []);

  return (
    <div className="relative h-full">
      <LogStream
        namespace="default"
        podName="my-pod"
        onLineClick={handleLineClick}
      />

      {selectedLine && (
        <pre className="absolute bottom-0 right-0 p-3 bg-slate-900 text-slate-200 text-xs">
          {selectedLine.raw}
        </pre>
      )}
    </div>
  );
}
```

## KubeView Shell Integration

Example showing how to integrate into the KubeView shell:

```tsx
import React from 'react';
import { Shell, Dock } from '@/kubeview/components';
import { MultiContainerLogs } from '@/kubeview/components/logs';

export default function KubeViewWithLogs() {
  return (
    <Shell>
      <Dock
        title="Pod Logs"
        defaultHeight={400}
        minHeight={200}
      >
        <MultiContainerLogs
          namespace="default"
          podName="my-app-abc123"
          containers={[
            { name: 'app', type: 'container', state: 'running' },
            { name: 'sidecar', type: 'container', state: 'running' },
          ]}
        />
      </Dock>
    </Shell>
  );
}
```

## API Hooks

You might want to create custom hooks for fetching pod/container data:

```tsx
import { useState, useEffect } from 'react';
import type { V1Pod } from '@kubernetes/client-node';

export function usePodContainers(pod: V1Pod | null) {
  const [containers, setContainers] = useState<Array<{
    name: string;
    type: 'container' | 'init' | 'ephemeral';
    state: 'running' | 'waiting' | 'terminated';
  }>>([]);

  useEffect(() => {
    if (!pod) {
      setContainers([]);
      return;
    }

    const allContainers = [
      ...(pod.spec?.containers ?? []).map((c) => ({
        name: c.name,
        type: 'container' as const,
        state: getContainerState(pod.status?.containerStatuses?.find((s) => s.name === c.name)),
      })),
      ...(pod.spec?.initContainers ?? []).map((c) => ({
        name: c.name,
        type: 'init' as const,
        state: getContainerState(pod.status?.initContainerStatuses?.find((s) => s.name === c.name)),
      })),
      ...(pod.spec?.ephemeralContainers ?? []).map((c) => ({
        name: c.name,
        type: 'ephemeral' as const,
        state: getContainerState(pod.status?.ephemeralContainerStatuses?.find((s) => s.name === c.name)),
      })),
    ];

    setContainers(allContainers);
  }, [pod]);

  return containers;
}

function getContainerState(status: any): 'running' | 'waiting' | 'terminated' {
  if (!status) return 'waiting';
  if (status.state?.running) return 'running';
  if (status.state?.terminated) return 'terminated';
  return 'waiting';
}
```

Then use in your component:

```tsx
import { usePodContainers } from './hooks';

function PodLogs({ pod }: { pod: V1Pod }) {
  const containers = usePodContainers(pod);

  return (
    <MultiContainerLogs
      namespace={pod.metadata?.namespace!}
      podName={pod.metadata?.name!}
      containers={containers}
    />
  );
}
```

## Error Handling

Example with error boundary:

```tsx
import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LogStream } from '@/kubeview/components/logs';

function ErrorFallback({ error, resetErrorBoundary }: any) {
  return (
    <div className="flex items-center justify-center h-full bg-slate-950 text-slate-200 p-4">
      <div className="max-w-md text-center">
        <h3 className="text-lg font-semibold text-red-400 mb-2">
          Failed to load logs
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          {error.message}
        </p>
        <button
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export default function SafeLogViewer(props: any) {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <LogStream {...props} />
    </ErrorBoundary>
  );
}
```

## Custom Styling

If you need to override the default dark theme:

```tsx
import { LogStream } from '@/kubeview/components/logs';

export default function CustomStyledLogs() {
  return (
    <div className="custom-log-theme">
      <LogStream
        namespace="default"
        podName="my-pod"
      />
      <style jsx>{`
        .custom-log-theme {
          /* Override default colors */
          --slate-950: #000000;
          --slate-900: #0a0a0a;
          --slate-700: #333333;
          --slate-200: #ffffff;
        }
      `}</style>
    </div>
  );
}
```

## Testing Your Integration

Example Jest/Vitest test:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PodDetailPage from './PodDetailPage';

describe('PodDetailPage logs integration', () => {
  it('renders log viewer with pod data', async () => {
    const mockPod = {
      metadata: {
        name: 'test-pod',
        namespace: 'default',
      },
      spec: {
        containers: [
          { name: 'app' },
        ],
      },
      status: {
        containerStatuses: [
          { name: 'app', state: { running: {} } },
        ],
      },
    };

    render(<PodDetailPage pod={mockPod} />);

    await waitFor(() => {
      expect(screen.getByText('app')).toBeInTheDocument();
    });
  });
});
```

## Performance Tips

1. **Lazy loading:** Only load log viewer when tab is active
2. **Pagination:** For very large deployments, paginate pod list
3. **Debounce search:** Debounce search input to reduce re-renders
4. **Memoization:** Memoize expensive computations
5. **Virtual scrolling:** For >10,000 lines, consider react-window

Example lazy loading:

```tsx
import React, { lazy, Suspense } from 'react';

const MultiContainerLogs = lazy(() =>
  import('@/kubeview/components/logs').then(m => ({ default: m.MultiContainerLogs }))
);

export default function PodDetailPage() {
  return (
    <Suspense fallback={<div>Loading logs...</div>}>
      <MultiContainerLogs {...props} />
    </Suspense>
  );
}
```
