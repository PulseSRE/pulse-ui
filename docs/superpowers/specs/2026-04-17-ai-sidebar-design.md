# AI Sidebar Design Spec

> Historical design record. This proposal reflects its dated design discussion, not a statement that every feature, path, count, or acceptance criterion is implemented today. For current behavior and setup, use [README](../../../README.md), route/source modules, and current test output.

## Problem

The agent is hidden behind a floating button and shares a dock with Logs/Terminal/Events. It feels like a support widget, not a teammate. Users forget it's there, lose conversation context when toggling, and can't passively see what the agent is doing.

## Goal

Make the AI agent a first-class, always-visible member of the interface. Replace the floating button + right dock with a persistent sidebar. Move Logs/Terminal/Events to a bottom dock (IDE-style layout).

## Layout

```
+-- CommandBar -----------------------------------------+
+-- TabBar ---------------------------------------------+
+----------------------------------+--------------------+
|                                  |    AI Sidebar      |
|         Main Content             |     (360px)        |
|         (routes/views)           |                    |
|                                  |  Collapsed: 48px   |
+----------------------------------+                    |
|  Bottom Dock (Logs/Term/Events)  |                    |
|  Push layout, drag-to-resize     |                    |
+----------------------------------+--------------------+
+-- StatusBar ------------------------------------------+
```

- AI sidebar spans full height (CommandBar to StatusBar), fixed 360px when expanded, 48px when collapsed.
- Bottom dock sits below main content, does not extend under the sidebar.
- Both panels are independently collapsible.

## Sidebar States

### Collapsed Rail (48px)

A narrow vertical strip showing at-a-glance agent status.

- **Status icon**: idle (gray dot), scanning (blue pulse), investigating (violet spin), alert (amber), error (red).
- **Status text**: single line, vertically oriented or truncated. Examples: "All clear", "2 findings", "Investigating...".
- **Unread badge**: amber dot when agent produced output the user hasn't seen.
- **Interaction**: click anywhere to expand. `Cmd+J` toggles.

### Expanded - Dashboard Mode (360px)

Shown when the agent is idle or scanning with no active conversation. Sections top-to-bottom:

1. **Agent status bar**: state icon + descriptive text ("Scanning... all clear", "Investigating OOM in prod"). Shows elapsed time when actively working.

2. **Quick prompt chips**: 3-4 contextual suggestions from the existing `useSmartPrompts` engine. Chips like "Why is api-server crashlooping?", "Check node pressure". Clicking sends the prompt and transitions to chat mode.

3. **Active findings summary**: severity-grouped counts (critical/warning/info) from `monitorStore.findings`. Clicking navigates to Incident Center.

4. **Recent agent actions**: last 3 investigations or fix actions with timestamps. Source: `monitorStore.investigations` + `monitorStore.recentActions`. Each entry shows: tool name, category, timestamp, status badge.

5. **Memory highlights**: compact card showing runbook count, pattern count, and average confidence score. Source: `GET /api/agent/memory/summary`. Links to full Memory view.

6. **Chat input**: always visible at the bottom of the sidebar. Typing triggers transition to chat mode.

### Expanded - Chat Mode (360px)

Shown when the user sends a message or the agent starts an investigation.

- Full chat UI reusing existing `DockAgentPanel` internals: message bubbles, streaming text, ThinkingIndicator, tool pills, component rendering, confirmation dialogs, follow-up suggestions.
- "Back to dashboard" link appears 10 seconds after the agent's last `done` event with no new user input.
- Auto-returns to dashboard mode after 30 seconds of post-conversation inactivity.

### Transition Rules

```
Dashboard --[user types]--> Chat
Dashboard --[agent starts investigation]--> Chat
Chat --[10s idle after done]--> show "Back to dashboard" link
Chat --[30s idle OR click "Back"]--> Dashboard
Chat --[user collapses sidebar]--> Collapsed
Collapsed --[click OR Cmd+J]--> last expanded state (dashboard or chat)
Collapsed --[agent starts investigation]--> Expanded + Chat (auto-open)
```

The transition between dashboard and chat should be a crossfade (150ms), not a hard cut.

## Bottom Dock

Replaces the current right-side dock for non-AI panels.

- **Position**: bottom of main content area, left of sidebar.
- **Tabs**: Logs | Terminal | Events. Rendered as a tab bar at the top of the dock.
- **Layout behavior**: push (main content shrinks vertically, nothing hidden).
- **Height**: default 250px, drag top edge to resize (150-400px range), persisted to localStorage.
- **Collapse**: double-click tab bar to minimize to just the tab strip (~32px). Click a tab to restore.
- **Default state**: closed (no bottom dock visible on load).
- **Keyboard**: `Cmd+`` ` toggles bottom dock with Terminal tab focused.

## Removals

| What | Why |
|------|-----|
| Floating Bot button (`Shell.tsx` lines 148-163) | Replaced by always-visible sidebar |
| AI tab in dock header | AI moves to sidebar |
| `dockPanel: 'agent'` state path | Sidebar has its own state |
| Right-side dock for AI | Dock becomes bottom-only |

## Reuse

| Component | Reuse Plan |
|-----------|------------|
| `DockAgentPanel` internals | Extract chat UI (messages, streaming, input, confirmations) into a `ChatPanel` component used by the sidebar's chat mode |
| `useSmartPrompts` hook | Drives quick prompt chips in dashboard mode (unchanged) |
| `agentStore` | Unchanged — sidebar consumes the same state |
| `ThinkingIndicator` | Used in collapsed rail (compact mode) and chat mode |
| `monitorStore` | Drives findings summary and recent actions in dashboard mode |
| `PromptPill` | Reused for quick prompt chips |
| `MessageBubble` | Reused in chat mode |
| Dock resize logic | Adapted for bottom dock height resizing |

## New State (uiStore additions)

```typescript
// Replace existing dock state
sidebarExpanded: boolean          // collapsed (48px) vs expanded (360px)
sidebarMode: 'dashboard' | 'chat' // adaptive mode within expanded state
bottomDockPanel: 'logs' | 'terminal' | 'events' | null  // null = closed
bottomDockHeight: number          // default 250, range 150-400, persisted
```

Persisted via the existing `partialize` config in uiStore (same as current `dockWidth`).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+J` | Toggle sidebar expand/collapse |
| `Cmd+`` ` | Toggle bottom dock (Terminal tab) |
| `/` (when sidebar expanded) | Focus chat input |
| `Escape` | Collapse sidebar if expanded, close bottom dock if open |

## Files

### Create

| File | Description |
|------|-------------|
| `src/kubeview/components/sidebar/AISidebar.tsx` | Main sidebar shell — handles collapsed/expanded states, transition logic |
| `src/kubeview/components/sidebar/CollapsedRail.tsx` | 48px mini status strip |
| `src/kubeview/components/sidebar/DashboardMode.tsx` | Status, prompts, findings, actions, memory sections |
| `src/kubeview/components/sidebar/ChatPanel.tsx` | Extracted chat UI from DockAgentPanel (messages, streaming, input, confirmations) |
| `src/kubeview/components/BottomDock.tsx` | Bottom dock for Logs/Terminal/Events with resize handle |

### Modify

| File | Changes |
|------|---------|
| `Shell.tsx` | New layout: flex row with main+bottomDock column + sidebar. Remove floating bot button. Replace Dock import with BottomDock + AISidebar. |
| `uiStore.ts` | Replace `dockPanel`/`dockWidth`/`dockFullscreen` with `sidebarExpanded`/`sidebarMode`/`bottomDockPanel`/`bottomDockHeight`. Keep `openDock()` working for backward compat (maps to bottomDockPanel). |
| `DockAgentPanel.tsx` | Extract chat internals to `ChatPanel.tsx`. DockAgentPanel becomes a thin wrapper or is deleted after migration. |
| `Dock.tsx` | Rename/replace with `BottomDock.tsx`. Remove AI tab. Reorient from right-side to bottom. |

### Delete (after migration)

| File | Reason |
|------|--------|
| Floating button JSX in `Shell.tsx` | Replaced by sidebar |
| `Dock.tsx` (if fully replaced) | Replaced by `BottomDock.tsx` |

## Migration Safety

All existing `openDock('agent')` calls throughout the codebase (Incident Center investigate button, monitor status click, command palette "Ask AI") need to be redirected. Two options:

1. **Adapter**: keep `openDock('agent')` working by having it call `expandSidebar()` + `setSidebarMode('chat')` internally. This is safer for migration.
2. **Replace**: find all call sites (`grep -r "openDock.*agent"`) and update to the new API directly.

Recommendation: option 1 for the initial implementation, option 2 as cleanup after all tests pass.

## Verification

1. `npx tsc --noEmit` — type check
2. `npx vitest run` — all tests pass
3. Dev server: sidebar visible on all routes
4. Collapsed rail shows correct agent status (idle/scanning/investigating)
5. Dashboard mode: smart prompts render, findings count matches Incident Center, memory stats load
6. Chat mode: send message, verify streaming, tool indicators, component rendering, confirmation dialogs
7. Transition: type in input → dashboard fades to chat. Wait 30s after done → chat fades to dashboard.
8. Bottom dock: Logs/Terminal/Events work, push layout, resize handle, persist height
9. `Cmd+J` toggles sidebar, `Cmd+`` ` toggles bottom dock
10. All existing "Investigate" buttons still open chat mode correctly
11. No floating bot button anywhere
