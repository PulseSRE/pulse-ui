# Pulse Agent Page Redesign

> Historical design record. This proposal reflects its dated design discussion, not a statement that every feature, path, count, or acceptance criterion is implemented today. For current behavior and setup, use [README](../../../README.md), route/source modules, and current test output.

**Date:** 2026-04-17
**Status:** Approved
**Audience:** Sysadmin (primary), Platform Admin (secondary via tabs)

## Problem

The `/agent` page is a developer dashboard showing internal metrics (eval rubric scores, routing accuracy, token cost breakdowns, pattern counts) that mean nothing to sysadmin users. KPIs show red/fail for zero-sample data. The "Full analytics →" link is broken. The merge of Mission Control + Toolbox was incomplete — `/toolbox` redirects to `/agent?tab=tools` but the page has no tab system, making Toolbox content unreachable.

## Design Principles Applied

- **Conversational-first (#1):** Overview reads as a narrative briefing, not a metrics grid
- **Zero training curve (#3):** Status sentence explains itself; no jargon
- **Radical transparency (#6):** Every number is clickable and leads to detail
- **Minimal cognitive load (#8):** Sysadmin sees 4 sections max; admin tabs available but not default
- **Intent → Visibility → Trust → Action (#2):** Status → Activity → Trust Controls → Configure

## Page Structure

`/agent` becomes a tabbed page with `?tab=` param support. Default tab is `overview`.

### Tabs

| Tab | Label | Audience | Source |
|-----|-------|----------|--------|
| `overview` | Overview | Sysadmin | New — narrative briefing |
| `tools` | Tools | Admin | Existing `CatalogTab` |
| `skills` | Skills | Admin | Existing `SkillsTab` |
| `plans` | Plans | Both | Existing `PlansTab` |
| `mcp` | MCP | Admin | Existing `ConnectionsTab` |
| `components` | Components | Admin | Existing `ComponentsTab` |
| `usage` | Usage | Admin | Existing `UsageTab` |
| `analytics` | Analytics | Admin | Existing `AnalyticsTab` |

### Tab persistence

Active tab stored in `sessionStorage` (key: `agent-tab`) and URL `?tab=` param, matching existing ToolboxView pattern.

### Route compatibility

Existing redirects continue to work:
- `/toolbox` → `/agent?tab=tools`
- `/toolbox?tab=analytics` → `/agent?tab=analytics`
- `/extensions` → `/agent?tab=skills`
- `/memory` → `/agent?tab=memory` (no memory tab — redirect to `/agent`)
- `/tools` → `/agent?tab=tools`

## Overview Tab Design

Four sections, read top-to-bottom like a status page.

### 1. Status Sentence

One dynamically generated line at the top. Variants:

- **Healthy:** "Pulse is monitoring your cluster. [17 scanners](#) active, no issues detected."
- **Issues found:** "Pulse detected [3 issues](#) this week. [2 were auto-fixed](#), [1 needs your attention](#)."
- **Degraded:** "Pulse is [degraded](#) — circuit breaker is open. Check agent logs."

All nouns and numbers are clickable (see Clickability section).

Data sources: `fetchAgentHealth()` for circuit breaker, `fetchFixHistorySummary()` for fix counts, `fetchScannerCoverage()` for scanner count.

### 2. Recent Activity

Plain-English list of what the agent did in the last 7 days. Each item is a clickable row.

Examples:
- "Auto-fixed 2 crashlooping pods in `production`" → `/incidents?tab=actions`
- "Generated 1 postmortem for OOM incident" → `/incidents?tab=postmortems`
- "Investigated node pressure on `worker-3`" → `/incidents`
- "Cluster self-healed 3 findings" → `/incidents` (resolved filter)

Empty state: "No activity yet. The agent is monitoring but hasn't needed to intervene."

Data source: New `GET /api/agent/activity?days=7` endpoint.

### 3. Trust Controls

The existing `TrustPolicy` component — trust level slider, auto-fix category toggles, communication style selector. Already user-facing and functional. No changes needed.

### 4. Agent Info Footer

Single `text-xs` line at the bottom:
"v2.4.0 · Protocol v2 · [118 tools](#) · [7 skills](#)"

- Tool count links to `/agent?tab=tools`
- Skill count links to `/agent?tab=skills`

### What moves out of Overview

| Current section | Destination |
|----------------|-------------|
| KPI strip (9 metrics) | Analytics tab |
| Agent Health (Quality Gate, Coverage, Outcomes) | Analytics tab |
| Agent Accuracy (quality score, override rate, anti-patterns) | Analytics tab |
| Capability Discovery (recommendations) | Analytics tab |
| Agent Intelligence / Activity card | Replaced by new Activity section |

## Clickability Map

Every visible number, noun, or status links somewhere:

| Element | Click target |
|---------|-------------|
| Scanner count ("17 scanners") | Opens scanner drawer |
| Issue count ("3 issues") | `/incidents` |
| "circuit breaker is open" | Agent health drawer |
| Each activity item | `/incidents?tab=actions` (or relevant tab) |
| "self-healed N findings" | `/incidents` with resolved filter |
| Trust level slider | In-place (existing) |
| Auto-fix toggles | In-place (existing) |
| Tool count in footer | `/agent?tab=tools` |
| Skill count in footer | `/agent?tab=skills` |

No dead text. If it's a number or a noun, it navigates.

## New Backend Endpoint

### `GET /api/agent/activity?days=7`

Returns structured activity events for the overview.

**Response:**
```json
{
  "events": [
    {
      "type": "auto_fix",
      "description": "Auto-fixed 2 crashlooping pods in production",
      "timestamp": "2026-04-17T10:30:00Z",
      "link": "/incidents?tab=actions",
      "count": 2,
      "category": "crashloop",
      "namespace": "production"
    },
    {
      "type": "investigation",
      "description": "Investigated node pressure on worker-3",
      "timestamp": "2026-04-16T14:20:00Z",
      "link": "/incidents",
      "finding_id": "f-abc123"
    },
    {
      "type": "self_healed",
      "description": "3 findings resolved without intervention",
      "timestamp": "2026-04-15T08:00:00Z",
      "link": "/incidents",
      "count": 3
    },
    {
      "type": "postmortem",
      "description": "Generated postmortem for OOM incident",
      "timestamp": "2026-04-14T16:45:00Z",
      "link": "/incidents?tab=postmortems"
    }
  ],
  "period_days": 7
}
```

**Data sources:** Aggregates from `actions`, `findings`, and `plan_executions` tables. Groups by type and namespace for concise display.

## Files to Create/Modify

### Frontend (OpenshiftPulse)

| File | Action |
|------|--------|
| `src/kubeview/views/PulseAgentView.tsx` | Rewrite — tabbed wrapper importing Overview + Toolbox tabs |
| `src/kubeview/views/pulse-agent/OverviewTab.tsx` | Rewrite — narrative briefing (status, activity, trust, footer) |
| `src/kubeview/views/MissionControlView.tsx` | Delete — replaced by PulseAgentView |
| `src/kubeview/views/ToolboxView.tsx` | Keep as-is — individual tabs imported directly |
| `src/kubeview/engine/analyticsApi.ts` | Add `fetchAgentActivity()` |
| `src/kubeview/routes/domainRoutes.tsx` | Update `/toolbox` redirect to preserve tab param |

### Backend (pulse-agent)

| File | Action |
|------|--------|
| `sre_agent/api/monitor_rest.py` | Add `GET /api/agent/activity` endpoint |

### Existing Toolbox tab files (no changes)

- `toolbox/CatalogTab.tsx`
- `toolbox/SkillsTab.tsx`
- `toolbox/PlansTab.tsx`
- `toolbox/ConnectionsTab.tsx`
- `toolbox/ComponentsTab.tsx`
- `toolbox/UsageTab.tsx`
- `toolbox/AnalyticsTab.tsx`

## Migration

The Analytics tab absorbs the developer-facing sections removed from Overview:
- KPI strip → already available via KPI endpoint, Analytics tab can render it
- Quality Gate, Coverage, Outcomes → move `AgentHealth` component into Analytics tab
- Agent Accuracy → move into Analytics tab
- Capability Discovery → move into Analytics tab

This is additive — the Analytics tab gets richer, the Overview tab gets simpler.
