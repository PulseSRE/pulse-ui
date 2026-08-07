# KubeView Log Viewer Architecture

## Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     MultiPodLogs                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Pod Selector: [All 3 pods] [pod-1] [pod-2] [pod-3]   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                MultiContainerLogs                       │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  Container: [All] [app] [sidecar] [init-setup]  │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │                  LogStream                        │  │ │
│  │  │  ┌────────────────────────────────────────────┐  │  │ │
│  │  │  │  Toolbar: Search, Follow, TS, Wrap, etc.  │  │  │ │
│  │  │  └────────────────────────────────────────────┘  │  │ │
│  │  │  ┌────────────────────────────────────────────┐  │  │ │
│  │  │  │  Log Lines (scrollable)                    │  │  │ │
│  │  │  │  1  2024-01-15 [INFO] Starting...          │  │  │ │
│  │  │  │  2  2024-01-15 [INFO] Ready                │  │  │ │
│  │  │  │  ...                                        │  │  │ │
│  │  │  └────────────────────────────────────────────┘  │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

> A `LogContext` modal (context lines, structured fields, similar occurrences) was explored during design but was never built. `LogStream`'s `onLineClick` callback exists and is wired for this purpose, but no component currently consumes it to render a context panel.

## Component Responsibilities

### LogStream
**Purpose:** Core log streaming viewer
**Responsibilities:**
- Fetch logs from K8s API
- Handle live streaming (ReadableStream)
- Parse log lines with LogParser
- Render log lines with syntax highlighting
- Handle auto-scroll behavior
- Provide search, filtering, download, copy (search is a plain inline `<input>` in the toolbar — there is no dedicated `LogSearch` component, regex support, or match navigation)

**State:**
- `lines: ParsedLogLine[]` - All parsed log lines
- `isFollowing: boolean` - Live tail mode
- `autoScroll: boolean` - Auto-scroll state
- `searchQuery: string` - Search filter

**API calls:**
```
GET /api/kubernetes/api/v1/namespaces/{ns}/pods/{pod}/log
  ?container={name}&timestamps=true&tailLines=1000&follow=true
```

### MultiContainerLogs
**Purpose:** Container switcher for multi-container pods
**Responsibilities:**
- Render container selector tabs
- Show container state indicators
- In "All" mode, fetch and merge logs from all containers
- Color-code container prefixes
- Render LogStream for selected container

**State:**
- `selectedContainer: string` - Current container or 'all'
- `mergedLogs: MergedLogLine[]` - Merged logs from all containers

### MultiPodLogs
**Purpose:** Aggregate logs across multiple pods
**Responsibilities:**
- Render pod selector tabs
- In "All" mode, fetch and merge logs from all pods
- Color-code pod prefixes
- Sort merged logs by timestamp
- Truncate pod names for display
- Render LogStream for selected pod

**State:**
- `selectedPod: string` - Current pod or 'all'
- `mergedLogs: MergedLogLine[]` - Merged logs from all pods

## Utilities

### LogParser
**Purpose:** Parse and detect log formats
**Functions:**
- `detectLogFormat(lines: string[]): LogFormat`
- `parseLogLine(line: string, format?: LogFormat): ParsedLogLine`

**Format detection:**
1. Try JSON: line starts with `{` and parses as valid JSON
2. Try logfmt: contains `key=value` patterns
3. Default to plain text

**K8s timestamp handling:**
- Strips RFC3339Nano prefix: `2024-01-15T10:04:23.441234567Z`
- Parses into `timestamp` field

**Level normalization:**
- Maps various level strings to standard enum
- Detects level from message content for plain text

### LogCollapse
**Purpose:** Collapse repeated similar log lines
**Status:** Implemented and tested (`LogCollapse.test.ts`), but not currently wired into `LogStream` or any other component — it's exported from `index.ts` but has no real consumer yet.
**Functions:**
- `areSimilar(a: string, b: string): boolean`
- `collapseRepeatedLines(lines: ParsedLogLine[], threshold: number): (ParsedLogLine | CollapsedGroup)[]`
- `isCollapsedGroup(item): boolean`

**Similarity algorithm:**
1. Normalize both messages (replace UUIDs, numbers, IPs, timestamps)
2. Compare normalized versions
3. If equal, lines are similar

**Collapsing:**
- Find consecutive similar lines with same level
- If count >= threshold, create CollapsedGroup
- Otherwise, keep individual lines

## Data Flow

### Initial Load
```
User opens pod logs
  → LogStream mounts
    → Fetch /api/kubernetes/.../log?tailLines=1000&timestamps=true
      → Parse each line with LogParser
        → Detect format (JSON/logfmt/plain)
        → Extract timestamp, level, message, fields
          → Store in lines[] state
            → Render log lines
```

### Live Streaming
```
User enables Follow
  → LogStream fetches with follow=true
    → ReadableStream starts
      → Read chunks in loop
        → Decode chunk with TextDecoder
          → Split by newlines
            → Parse new lines
              → Append to lines[] state
                → Auto-scroll if at bottom
```

### Search
```
User types in the inline search input
  → LogStream filters lines[] by substring match (case-insensitive)
    → `-` prefix negates the filter
      → Matching lines re-rendered with highlighted substrings
```

### Context Click
```
User clicks log line
  → onLineClick callback fires with the clicked ParsedLogLine
    → (no built-in consumer today — a LogContext panel showing
       surrounding lines, structured fields, and similar occurrences
       was explored but never implemented)
```

## Performance Considerations

1. **Line limit:** Max 10,000 lines in memory to prevent slowdown
2. **Streaming:** Efficient chunk processing with TextDecoder
3. **No virtualization:** Browser native scrolling is fast enough for 10k lines
4. **Smart auto-scroll:** Only scrolls when user is at bottom
5. **Similarity detection:** Regex-based normalization is fast enough (though `collapseRepeatedLines` isn't called from any component yet — see LogCollapse status above)
6. **Memo/useMemo:** Not currently used for search filtering in `LogStream` — filtering re-runs on every render

## Styling Strategy

All components use:
- **Tailwind CSS** for utility classes
- **Dark theme** with slate color palette
- **Monospace font** for log content
- **Consistent spacing** (px-3, py-2, gap-2)
- **Rounded corners** (rounded, rounded-lg)
- **Transitions** for interactive elements

**Color palette:**
- Background: `bg-slate-950` (darkest), `bg-slate-900` (cards)
- Borders: `border-slate-700`
- Text: `text-slate-200` (primary), `text-slate-400` (muted)
- Accents: `text-blue-400`, `text-green-400`, etc.

## Testing Strategy

Unit tests for:
- **LogParser:** Format detection, line parsing, level normalization (`LogParser.test.ts`)
- **LogCollapse:** Similarity detection, collapsing logic (`LogCollapse.test.ts`)
- **LogStream:** Fetch/render behavior, container auto-detection, error states (`__tests__/LogStream.test.tsx`)

There are also two orphaned logic-only test files, `__tests__/LogSearch.test.ts` and `__tests__/LogContext.test.ts`, that test search/context-extraction logic in isolation for the `LogSearch`/`LogContext` components described above — those components were never built, so these tests exercise standalone functions only, not any React component.

Integration tests (future):
- Fetch logs from mock K8s API
- Stream parsing
- Search functionality
- Multi-container merging

## Future Enhancements

1. **Log export formats:** JSON, CSV, structured logs
2. **Advanced filters:** Level, time range, field values
3. **Log aggregation:** Group by error message
4. **Performance profiling:** Identify slow log sources
5. **Log analytics:** Error rate over time
6. **Saved searches:** Bookmark common queries
7. **Share links:** Deep link to specific log line
8. **Log tailing limits:** Configurable max lines
9. **Custom parsers:** User-defined log formats
10. **Log forwarding:** Send to external log aggregator
