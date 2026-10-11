# Integration Guide

> Component integration reference. Source props/exports in this directory are authoritative; examples omit application-specific data/error wiring. Run `pnpm test -- src/kubeview/components/logs` for current coverage. Tests and counts do not prove live cluster acceptance.

How to integrate KubeView log viewer components into your application.

## Pod Detail Page

Example integration in a Pod detail page with tabs:

```tsx
import React, { useState } from 'react';
import type { K8sResource } from '@/kubeview/engine/renderers';
import { MultiContainerLogs } from '@/kubeview/components/logs';

interface PodDetailPageProps {
  pod: K8sResource;
}

export default function PodDetailPage({ pod }: PodDetailPageProps) {
  const namespace = pod.metadata?.namespace ?? 'default';
  const podName = pod.metadata?.name ?? '';

  // Extract container info from pod spec and status
  const containers = [
    // Regular containers
    ...(pod.spec?.containers ?? []).map((c: { name: string }) => {
      const status = pod.status?.containerStatuses?.find((s: { name: string }) => s.name === c.name);
      return {
        name: c.name,
        type: 'container' as const,
        state: getContainerState(status),
      };
    }),
    // Init containers
    ...(pod.spec?.initContainers ?? []).map((c: { name: string }) => {
      const status = pod.status?.initContainerStatuses?.find((s: { name: string }) => s.name === c.name);
      return {
        name: c.name,
        type: 'init' as const,
        state: getContainerState(status),
      };
    }),
    // Ephemeral containers
    ...(pod.spec?.ephemeralContainers ?? []).map((c: { name: string }) => {
      const status = pod.status?.ephemeralContainerStatuses?.find((s: { name: string }) => s.name === c.name);
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
import type { K8sResource } from '@/kubeview/engine/renderers';
import { MultiPodLogs } from '@/kubeview/components/logs';

interface DeploymentLogsTabProps {
  deployment: K8sResource;
  pods: K8sResource[];
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

## Embedding a Log Panel

`Shell` renders its own application layout and accepts no children. There is no `Dock` component or components barrel. Embed a log panel in the host view instead:

```tsx
import { MultiContainerLogs } from '@/kubeview/components/logs';

export function PodLogPanel() {
  return (
    <section className="h-96">
      <MultiContainerLogs
        namespace="default"
        podName="my-app-abc123"
        containers={[{ name: 'app', type: 'container', state: 'running' }]}
      />
    </section>
  );
}
```

## API Hooks

You might want to create custom hooks for fetching pod/container data:

```tsx
import { useState, useEffect } from 'react';
import type { K8sResource } from '@/kubeview/engine/renderers';

export function usePodContainers(pod: K8sResource | null) {
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
      ...(pod.spec?.containers ?? []).map((c: { name: string }) => ({
        name: c.name,
        type: 'container' as const,
        state: getContainerState(pod.status?.containerStatuses?.find((s: { name: string }) => s.name === c.name)),
      })),
      ...(pod.spec?.initContainers ?? []).map((c: { name: string }) => ({
        name: c.name,
        type: 'init' as const,
        state: getContainerState(pod.status?.initContainerStatuses?.find((s: { name: string }) => s.name === c.name)),
      })),
      ...(pod.spec?.ephemeralContainers ?? []).map((c: { name: string }) => ({
        name: c.name,
        type: 'ephemeral' as const,
        state: getContainerState(pod.status?.ephemeralContainerStatuses?.find((s: { name: string }) => s.name === c.name)),
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

function PodLogs({ pod }: { pod: K8sResource }) {
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

`LogStream` displays fetch errors itself. Use the repository's error boundary for render failures:

```tsx
import { ErrorBoundary } from '@/kubeview/components/ErrorBoundary';
import { LogStream } from '@/kubeview/components/logs';

export function SafeLogViewer(props: React.ComponentProps<typeof LogStream>) {
  return (
    <ErrorBoundary fallbackTitle="Failed to render logs">
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
      <style>{`
        .custom-log-theme {
          color: #ffffff;
        }
        .custom-log-theme .bg-slate-950 {
          background-color: #000000;
        }
        .custom-log-theme .text-slate-200 {
          color: #ffffff;
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
      apiVersion: 'v1',
      kind: 'Pod',
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

export default function LazyPodLogs(props: React.ComponentProps<typeof MultiContainerLogs>) {
  return (
    <Suspense fallback={<div>Loading logs...</div>}>
      <MultiContainerLogs {...props} />
    </Suspense>
  );
}
```
