# Chart Edit Popover

## Goal

Let users edit chart widget properties (PromQL query, chart type, time range, title, axis labels) directly on the dashboard via a popover panel, with a live "Test Query" button that validates the PromQL against Prometheus before saving.

## Architecture

One new component: `ChartEditPopover.tsx` in `src/kubeview/components/agent/`.

Opens when user clicks an edit icon on a chart widget in CustomView edit mode. Uses CodeMirror (already installed for YAML editor) with PromQL syntax highlighting. Saves via the existing `updateWidget()` store method.

## Component: ChartEditPopover

**Props:**
```typescript
interface ChartEditPopoverProps {
  spec: ChartSpec;              // Current chart spec
  viewId: string;               // View ID for persistence
  widgetIndex: number;           // Widget index in layout
  onClose: () => void;           // Close the popover
}
```

**Fields (top to bottom):**

1. **Title** — text input, pre-filled from `spec.title`
2. **PromQL Query** — CodeMirror editor (~4 lines tall), pre-filled from `spec.query`
3. **Chart Type** — dropdown: line, area, bar, donut, stacked_area, stacked_bar
4. **Time Range** — button group: 15m, 30m, 1h, 6h, 24h
5. **Y-Axis Label** — text input, pre-filled from `spec.yAxisLabel`

**Actions:**
- **Test Query** — runs PromQL against the Prometheus proxy (`/api/k8s/prometheus/query`), shows result count or error inline. On success, renders a mini preview chart.
- **Save** — calls `updateWidget(viewId, widgetIndex, updatedSpec)`, closes popover
- **Cancel** — closes without saving

## Data Flow

```
User clicks edit icon on chart widget (edit mode only)
  -> ChartEditPopover opens anchored to the widget
  -> User edits PromQL in CodeMirror
  -> User clicks "Test Query"
     -> fetch /api/k8s/prometheus/query?query={encoded_query}
     -> Success: show "N series, M data points" + mini preview
     -> Error: show red error message inline
  -> User clicks "Save"
     -> customViewStore.updateWidget(viewId, index, {
          title, query, chartType, timeRange, yAxisLabel
        })
     -> PUT /api/agent/views/{viewId}
     -> Popover closes
     -> Chart re-renders with new spec (live refresh picks up new query)
```

## Integration Points

- **CustomView.tsx** — add edit button to chart widgets in edit mode (pencil icon in widget header, next to the existing delete button). On click, set `editingWidget: { index, spec }` state. Render `ChartEditPopover` when set.
- **AgentChart.tsx** — no changes needed. The chart already re-renders when its spec changes.
- **customViewStore.ts** — uses existing `updateWidget(viewId, widgetIndex, updates)` method.
- **CodeMirror** — import from existing `@codemirror/lang-javascript` or add `codemirror-promql` for proper PromQL syntax highlighting. If `codemirror-promql` is not available, use plain text with monospace styling.

## Prometheus Query Testing

The "Test Query" button hits the existing Prometheus proxy:
```
GET /api/k8s/prometheus/query?query={encodeURIComponent(promql)}
```

This proxy is already configured in nginx for the chart live-refresh feature. Parse the response:
- `data.result` array → show series count
- Empty result → show "No data returned"
- Error → show `error` field in red

## Visual Design

- Popover anchored to the bottom of the widget, 400px wide
- Dark theme matching the dashboard (bg-slate-900, border-slate-700)
- CodeMirror with dark theme (oneDark or custom)
- "Test Query" button in blue, "Save" in emerald, "Cancel" in slate
- Test result: green success badge or red error inline
- Mini preview: small 120px tall recharts line chart with the test data

## What NOT to Build

- No series color picker (recharts auto-assigns)
- No multi-query support (one query per chart)
- No description editing (already editable inline in edit mode)
- No undo — cancel discards changes
- No editing for non-chart widgets (tables, metric cards, etc.)

## Testing

- Unit test: ChartEditPopover renders fields from spec
- Unit test: Save calls updateWidget with correct params
- Unit test: Cancel closes without saving
- Unit test: Test Query shows error on bad PromQL
- Integration: verify popover opens from CustomView edit mode
