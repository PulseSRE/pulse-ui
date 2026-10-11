# KubeView Log Viewer Components

> Component integration reference. Source props/exports in this directory are authoritative; examples omit application-specific data/error wiring. Run `pnpm test -- src/kubeview/components/logs` for current coverage. Tests and counts do not prove live cluster acceptance.

Powerful log exploration components for Kubernetes pods with streaming, multi-container, and multi-pod support.

## Components

### LogStream

Main streaming log viewer component with live tail, search, and filtering.

```tsx
import { LogStream } from '@/kubeview/components/logs';

<LogStream
  namespace="default"
  podName="my-pod-abc123"
  containerName="app"
  follow={true}
  timestamps={true}
  tailLines={1000}
  onLineClick={(line) => console.log('Clicked:', line)}
/>
```

**Features:**
- Live streaming with ReadableStream API
- Auto-scroll with smart pause on user scroll
- Search with negative filter support (prefix with `-`)
- Word wrap toggle
- Timestamp toggle
- Copy and download logs
- Auto-detect log format (JSON, logfmt, plain)
- Color-coded log levels
- Line numbers
- Limited to 10,000 lines in the single-container stream

### MultiContainerLogs

Container switcher for multi-container pods with merged view.

```tsx
import { MultiContainerLogs } from '@/kubeview/components/logs';

<MultiContainerLogs
  namespace="default"
  podName="my-pod-abc123"
  containers={[
    { name: 'app', type: 'container', state: 'running' },
    { name: 'sidecar', type: 'container', state: 'running' },
    { name: 'init-setup', type: 'init', state: 'terminated' },
  ]}
/>
```

**Features:**
- Tab-style container selector
- "All" mode fetches a snapshot (500 lines per container), without live follow
- Color-coded container prefixes
- State indicators (running, waiting, terminated)
- Init and ephemeral container support

### MultiPodLogs

Aggregate logs across multiple pods (for Deployment/ReplicaSet view).

```tsx
import { MultiPodLogs } from '@/kubeview/components/logs';

<MultiPodLogs
  namespace="default"
  podNames={['app-abc123', 'app-def456', 'app-ghi789']}
  containerName="app"
/>
```

**Features:**
- Pod selector with "All" option
- Snapshot merged view (500 lines per pod) with color-coded pod prefixes
- Truncated pod names for readability
- Timestamp-based merging

> **Not implemented:** A `LogContext` panel (surrounding lines, structured fields, similar-occurrence detection) was explored during design but never built. `LogStream`'s `onLineClick` prop still fires on line clicks — see [`INTEGRATION.md`](./INTEGRATION.md) for an example of wiring up your own click handler.

## Utilities

### LogParser

Auto-detecting log line parser.

```tsx
import { parseLogLine, detectLogFormat } from '@/kubeview/components/logs';

// Detect format from multiple lines
const format = detectLogFormat(lines);

// Parse single line
const parsed = parseLogLine(line, format);

// Result:
{
  raw: string;                // Original line
  timestamp?: Date;           // Extracted timestamp
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'unknown';
  message: string;            // Log message
  fields?: Record<string, string>;  // Structured fields (JSON/logfmt)
  format: 'json' | 'logfmt' | 'plain';
}
```

**Supported formats:**
- **JSON:** `{"level":"info","msg":"message","ts":"2024-01-15T10:00:00Z"}`
- **logfmt:** `level=info msg="message" ts=2024-01-15T10:00:00Z`
- **Plain text:** `[INFO] message` or `I0315 10:00:00 message`

**K8s timestamp handling:**
When `timestamps=true` is used in the log API, each line is prefixed with RFC3339Nano:
```
2024-01-15T10:04:23.441234567Z actual log message here
```
The parser automatically strips and parses this.

## API Integration

The log components resolve the selected cluster via `useClusterBase()`. For the primary cluster, the path is:

```
GET /api/kubernetes/api/v1/namespaces/{namespace}/pods/{pod}/log
```

**Query parameters:**
- `container` - Container name
- `timestamps=true` - Include timestamps
- `tailLines=1000` - Number of lines to fetch
- `sinceSeconds=60` - Time range
- `follow=true` - Streaming mode (uses ReadableStream)

## Performance

- **Max lines:** 10,000 lines in memory at once
- **Streaming:** Efficient ReadableStream processing
- **No virtualization:** Uses browser native scrolling (fast enough for 10k lines)
- **Smart auto-scroll:** Pauses when user scrolls up

## Styling

All components use Tailwind CSS with dark theme:
- Background: `bg-slate-950` (very dark)
- Cards: `bg-slate-900`
- Borders: `border-slate-700`
- Text: `text-slate-200`
- Monospace font: `font-mono`

**Level colors:**
- DEBUG: `text-slate-400`
- INFO: `text-slate-200`
- WARN: `text-amber-400`
- ERROR: `text-red-400`
- FATAL: `text-red-500`

**Search highlights:**
- Match: `bg-amber-900/50`

## Example Usage

### Basic pod logs

```tsx
import type { K8sResource } from '@/kubeview/engine/renderers';

function PodLogsTab({ pod }: { pod: K8sResource }) {
  const containers = pod.spec?.containers.map((c: { name: string }) => ({
    name: c.name,
    type: 'container' as const,
    state: 'running' as const, // derive from pod.status.containerStatuses
  })) ?? [];

  return (
    <MultiContainerLogs
      namespace={pod.metadata?.namespace!}
      podName={pod.metadata?.name!}
      containers={containers}
    />
  );
}
```

### Deployment logs (all pods)

```tsx
import type { K8sResource } from '@/kubeview/engine/renderers';

function DeploymentLogsTab({ deployment, pods }: { deployment: K8sResource; pods: K8sResource[] }) {
  const podNames = pods.map(p => p.metadata?.name!);

  return (
    <MultiPodLogs
      namespace={deployment.metadata?.namespace!}
      podNames={podNames}
      containerName="app"
    />
  );
}
```

### Reacting to line clicks

```tsx
function LogViewerWithClickHandling() {
  const [selectedLine, setSelectedLine] = useState<ParsedLogLine | null>(null);

  return (
    <>
      <LogStream
        namespace="default"
        podName="my-pod"
        onLineClick={(line) => setSelectedLine(line)}
      />

      {selectedLine && <pre>{selectedLine.raw}</pre>}
    </>
  );
}
```

## Tests

Run tests with:

```bash
pnpm test -- src/kubeview/components/logs/
```

Test files:
- `LogParser.test.ts` - Parser and format detection
- `__tests__/LogStream.test.tsx` - Fetch/render behavior, container auto-detection, error states
- `__tests__/LogSearch.test.ts` - Orphaned: tests search-filtering logic extracted from the never-built `LogSearch` component
- `__tests__/LogContext.test.ts` - Orphaned: tests context-extraction logic extracted from the never-built `LogContext` component
