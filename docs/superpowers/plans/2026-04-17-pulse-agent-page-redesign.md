# Pulse Agent Page Redesign Implementation Plan

> Historical design record. This proposal reflects its dated design discussion, not a statement that every feature, path, count, or acceptance criterion is implemented today. For current behavior and setup, use [README](../../../README.md), route/source modules, and current test output.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer-facing Pulse Agent page with a sysadmin-first narrative overview plus tabbed access to all admin tools (catalog, skills, plans, MCP, components, usage, analytics).

**Architecture:** PulseAgentView.tsx becomes a tabbed wrapper. The default Overview tab shows a status sentence, activity list, trust controls, and agent info footer. All existing Toolbox tab components are imported directly. A new backend endpoint `/agent/activity` aggregates recent events from the database.

**Tech Stack:** React + TypeScript (frontend), Python + FastAPI (backend), TanStack Query for data fetching, Zustand for trust state.

---

### Task 1: Backend — Add `/agent/activity` endpoint

**Files:**
- Modify: `/Users/amobrem/ali/pulse-agent/sre_agent/api/monitor_rest.py`
- Create: `/Users/amobrem/ali/pulse-agent/tests/test_activity_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_activity_endpoint.py
"""Tests for GET /agent/activity endpoint."""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock


class TestActivityEndpoint:
    def test_returns_events_list(self):
        from sre_agent.api.monitor_rest import _build_activity_events

        mock_db = MagicMock()
        mock_db.fetchall.side_effect = [
            # actions query
            [
                {"category": "crashloop", "namespace": "production", "cnt": 2, "status": "completed"},
                {"category": "workloads", "namespace": "default", "cnt": 1, "status": "completed"},
            ],
            # self-healed findings query
            [{"cnt": 3}],
            # postmortems query
            [{"cnt": 1, "latest_summary": "OOM incident in production"}],
            # investigations query
            [{"finding_type": "node_pressure", "target": "worker-3", "cnt": 1}],
        ]

        events = _build_activity_events(mock_db, days=7)
        assert len(events) >= 2
        assert events[0]["type"] == "auto_fix"
        assert events[0]["count"] == 2
        assert events[0]["namespace"] == "production"
        assert events[0]["link"] == "/incidents?tab=actions"

    def test_empty_when_no_data(self):
        from sre_agent.api.monitor_rest import _build_activity_events

        mock_db = MagicMock()
        mock_db.fetchall.side_effect = [[], [{"cnt": 0}], [], []]

        events = _build_activity_events(mock_db, days=7)
        assert events == []

    def test_no_crash_on_db_error(self):
        from sre_agent.api.monitor_rest import _build_activity_events

        mock_db = MagicMock()
        mock_db.fetchall.side_effect = Exception("DB down")

        events = _build_activity_events(mock_db, days=7)
        assert events == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_activity_endpoint.py -v`
Expected: FAIL with `ImportError: cannot import name '_build_activity_events'`

- [ ] **Step 3: Implement the endpoint**

Add to the end of `sre_agent/api/monitor_rest.py` (before the file ends):

```python
def _build_activity_events(database, days: int = 7) -> list[dict]:
    """Aggregate recent agent activity into plain-English events."""
    try:
        events: list[dict] = []

        # 1. Auto-fix actions (grouped by category + namespace)
        actions = database.fetchall(
            "SELECT "
            "COALESCE(category, 'unknown') as category, "
            "COALESCE(namespace, '') as namespace, "
            "COUNT(*) as cnt, "
            "status "
            "FROM actions "
            "WHERE timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '1 day' * %s)::BIGINT * 1000 "
            "AND status IN ('completed', 'failed', 'rolled_back') "
            "GROUP BY category, namespace, status "
            "ORDER BY cnt DESC",
            (days,),
        )
        for row in actions or []:
            cat = row["category"].replace("_", " ")
            ns = row["namespace"] or "cluster-wide"
            status = row["status"]
            verb = "Auto-fixed" if status == "completed" else "Failed to fix" if status == "failed" else "Rolled back"
            events.append({
                "type": "auto_fix" if status == "completed" else "fix_failed" if status == "failed" else "rollback",
                "description": f"{verb} {row['cnt']} {cat} issue{'s' if row['cnt'] != 1 else ''} in {ns}",
                "link": "/incidents?tab=actions",
                "count": row["cnt"],
                "category": row["category"],
                "namespace": row["namespace"],
            })

        # 2. Self-healed findings
        healed = database.fetchall(
            "SELECT COUNT(*) as cnt FROM findings "
            "WHERE resolved = 1 "
            "AND id NOT IN (SELECT finding_id FROM actions WHERE finding_id IS NOT NULL) "
            "AND timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '1 day' * %s)::BIGINT * 1000",
            (days,),
        )
        healed_count = healed[0]["cnt"] if healed and healed[0]["cnt"] else 0
        if healed_count > 0:
            events.append({
                "type": "self_healed",
                "description": f"{healed_count} finding{'s' if healed_count != 1 else ''} resolved without intervention",
                "link": "/incidents",
                "count": healed_count,
            })

        # 3. Postmortems generated
        postmortems = database.fetchall(
            "SELECT COUNT(*) as cnt, "
            "MAX(summary) as latest_summary "
            "FROM postmortems "
            "WHERE created_at >= NOW() - INTERVAL '%s days'",
            (days,),
        )
        pm_count = postmortems[0]["cnt"] if postmortems and postmortems[0]["cnt"] else 0
        if pm_count > 0:
            summary = postmortems[0].get("latest_summary", "")
            desc = f"Generated {pm_count} postmortem{'s' if pm_count != 1 else ''}"
            if summary:
                desc += f" — latest: {summary[:60]}"
            events.append({
                "type": "postmortem",
                "description": desc,
                "link": "/incidents?tab=postmortems",
                "count": pm_count,
            })

        # 4. Investigations
        investigations = database.fetchall(
            "SELECT finding_type, target, COUNT(*) as cnt "
            "FROM findings "
            "WHERE investigated = 1 "
            "AND timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '1 day' * %s)::BIGINT * 1000 "
            "GROUP BY finding_type, target "
            "ORDER BY cnt DESC "
            "LIMIT 5",
            (days,),
        )
        for row in investigations or []:
            ft = (row["finding_type"] or "issue").replace("_", " ")
            target = row["target"] or ""
            desc = f"Investigated {ft}"
            if target:
                desc += f" on {target}"
            events.append({
                "type": "investigation",
                "description": desc,
                "link": "/incidents",
                "count": row["cnt"],
            })

        return events

    except Exception:
        logger.debug("Activity event aggregation failed", exc_info=True)
        return []


@router.get("/agent/activity")
async def get_agent_activity(
    days: int = Query(7, ge=1, le=90),
    _auth=Depends(verify_token),
):
    """Recent agent activity for the Overview tab."""
    from .. import db

    try:
        database = db.get_database()
        events = _build_activity_events(database, days)
        return {"events": events, "period_days": days}
    except Exception:
        return {"events": [], "period_days": days}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_activity_endpoint.py -v`
Expected: 3 passed

- [ ] **Step 5: Run full backend test suite**

Run: `python3 -m pytest tests/ -x -q`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add sre_agent/api/monitor_rest.py tests/test_activity_endpoint.py
git commit -m "feat: add /agent/activity endpoint for overview narrative"
```

---

### Task 2: Frontend — Add `fetchAgentActivity` to analytics API

**Files:**
- Modify: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/engine/analyticsApi.ts`

- [ ] **Step 1: Add the type and fetch function**

Add after the existing types in `analyticsApi.ts`:

```typescript
export interface ActivityEvent {
  type: 'auto_fix' | 'fix_failed' | 'rollback' | 'self_healed' | 'postmortem' | 'investigation';
  description: string;
  link: string;
  count: number;
  category?: string;
  namespace?: string;
}

export interface AgentActivity {
  events: ActivityEvent[];
  period_days: number;
}

export const fetchAgentActivity = (days = 7) =>
  get<AgentActivity>(`${AGENT_BASE}/activity?days=${days}`);
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add src/kubeview/engine/analyticsApi.ts
git commit -m "feat: add fetchAgentActivity API function"
```

---

### Task 3: Frontend — Rewrite OverviewTab as narrative briefing

**Files:**
- Rewrite: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/views/pulse-agent/OverviewTab.tsx`

- [ ] **Step 1: Rewrite OverviewTab.tsx**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchFixHistorySummary,
  fetchScannerCoverage,
  fetchAgentHealth,
  fetchCapabilities,
  fetchAgentVersion,
  fetchAgentActivity,
  type ActivityEvent,
} from '../../engine/analyticsApi';
import { TrustPolicy } from '../mission-control/TrustPolicy';
import { ScannerDrawer } from '../mission-control/ScannerDrawer';

export function OverviewTab() {
  const [scannerDrawerOpen, setScannerDrawerOpen] = useState(false);

  const healthQ = useQuery({ queryKey: ['agent', 'health'], queryFn: fetchAgentHealth, refetchInterval: 30_000 });
  const fixQ = useQuery({ queryKey: ['agent', 'fix-history-summary'], queryFn: () => fetchFixHistorySummary(), staleTime: 60_000 });
  const coverageQ = useQuery({ queryKey: ['agent', 'scanner-coverage'], queryFn: () => fetchScannerCoverage(), staleTime: 60_000 });
  const capQ = useQuery({ queryKey: ['agent', 'capabilities'], queryFn: fetchCapabilities, staleTime: 60_000 });
  const versionQ = useQuery({ queryKey: ['agent', 'version'], queryFn: fetchAgentVersion, staleTime: 5 * 60_000 });
  const activityQ = useQuery({ queryKey: ['agent', 'activity'], queryFn: () => fetchAgentActivity(7), staleTime: 60_000 });

  const scannerCount = coverageQ.data?.active_scanners ?? 0;
  const totalFindings = (fixQ.data?.completed ?? 0) + (fixQ.data?.failed ?? 0) + (fixQ.data?.rolled_back ?? 0);
  const cbState = healthQ.data?.circuit_breaker?.state?.toLowerCase();
  const isDegraded = cbState === 'open';

  return (
    <div className="space-y-6">
      {/* 1. Status Sentence */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4">
        <StatusSentence
          isDegraded={isDegraded}
          scannerCount={scannerCount}
          totalFindings={totalFindings}
          fixedCount={fixQ.data?.completed ?? 0}
          needsAttention={(fixQ.data?.failed ?? 0) + (fixQ.data?.rolled_back ?? 0)}
          onScannerClick={() => setScannerDrawerOpen(true)}
        />
      </div>

      {/* 2. Recent Activity */}
      <ActivitySection events={activityQ.data?.events ?? []} isLoading={activityQ.isLoading} />

      {/* 3. Trust Controls */}
      <TrustPolicy
        maxTrustLevel={capQ.data?.max_trust_level ?? 0}
        scannerCount={scannerCount}
        fixSummary={fixQ.data ?? null}
        supportedAutoFixCategories={capQ.data?.supported_auto_fix_categories}
      />

      {/* 4. Agent Info Footer */}
      {versionQ.data && (
        <div className="text-xs text-slate-600 flex items-center gap-1.5 justify-center py-2">
          <Bot className="w-3 h-3" />
          <span>v{versionQ.data.agent}</span>
          <span>&middot;</span>
          <span>Protocol v{versionQ.data.protocol}</span>
          <span>&middot;</span>
          <Link to="/agent?tab=tools" className="text-slate-500 hover:text-slate-300">{versionQ.data.tools} tools</Link>
          <span>&middot;</span>
          <Link to="/agent?tab=skills" className="text-slate-500 hover:text-slate-300">{versionQ.data.skills} skills</Link>
        </div>
      )}

      {scannerDrawerOpen && <ScannerDrawer coverage={coverageQ.data ?? null} onClose={() => setScannerDrawerOpen(false)} />}
    </div>
  );
}

function StatusSentence({
  isDegraded, scannerCount, totalFindings, fixedCount, needsAttention, onScannerClick,
}: {
  isDegraded: boolean; scannerCount: number; totalFindings: number;
  fixedCount: number; needsAttention: number; onScannerClick: () => void;
}) {
  if (isDegraded) {
    return (
      <p className="text-sm text-red-300">
        Pulse is <span className="font-medium text-red-400">degraded</span> — circuit breaker is open. Check agent logs.
      </p>
    );
  }

  if (totalFindings > 0) {
    return (
      <p className="text-sm text-slate-300">
        Pulse detected{' '}
        <Link to="/incidents" className="text-blue-400 hover:underline">{totalFindings} issue{totalFindings !== 1 ? 's' : ''}</Link>
        {' '}this week.{' '}
        {fixedCount > 0 && (
          <><Link to="/incidents?tab=actions" className="text-emerald-400 hover:underline">{fixedCount} auto-fixed</Link>{needsAttention > 0 ? ', ' : '.'}</>
        )}
        {needsAttention > 0 && (
          <Link to="/incidents?tab=actions" className="text-amber-400 hover:underline">{needsAttention} need{needsAttention === 1 ? 's' : ''} attention</Link>
        )}
      </p>
    );
  }

  return (
    <p className="text-sm text-slate-300">
      Pulse is monitoring your cluster.{' '}
      <button onClick={onScannerClick} className="text-blue-400 hover:underline">{scannerCount} scanners</button>
      {' '}active, no issues detected.
    </p>
  );
}

const EVENT_COLORS: Record<string, string> = {
  auto_fix: 'text-emerald-400',
  fix_failed: 'text-red-400',
  rollback: 'text-amber-400',
  self_healed: 'text-blue-400',
  postmortem: 'text-teal-400',
  investigation: 'text-slate-400',
};

function ActivitySection({ events, isLoading }: { events: ActivityEvent[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h2>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-slate-800 rounded w-3/4" />
          <div className="h-4 bg-slate-800 rounded w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h2>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet. The agent is monitoring but hasn&apos;t needed to intervene.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((evt, i) => (
            <li key={i}>
              <Link
                to={evt.link}
                className={cn('text-sm hover:underline flex items-center gap-2', EVENT_COLORS[evt.type] ?? 'text-slate-300')}
              >
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                {evt.description}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add src/kubeview/views/pulse-agent/OverviewTab.tsx
git commit -m "feat: rewrite OverviewTab as narrative sysadmin briefing"
```

---

### Task 4: Frontend — Rewrite PulseAgentView as tabbed wrapper

**Files:**
- Rewrite: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/views/PulseAgentView.tsx`

- [ ] **Step 1: Rewrite PulseAgentView.tsx**

Replace the entire file with:

```tsx
import { useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot, List, BarChart3, History,
  Puzzle, Layers, Cable, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OverviewTab } from './pulse-agent/OverviewTab';
import { CatalogTab } from './toolbox/CatalogTab';
import { SkillsTab } from './toolbox/SkillsTab';
import { PlansTab } from './toolbox/PlansTab';
import { ConnectionsTab } from './toolbox/ConnectionsTab';
import { ComponentsTab } from './toolbox/ComponentsTab';
import { UsageTab } from './toolbox/UsageTab';
import { AnalyticsTab } from './toolbox/AnalyticsTab';

type AgentTab = 'overview' | 'tools' | 'skills' | 'plans' | 'mcp' | 'components' | 'usage' | 'analytics';

const TABS: Array<{ id: AgentTab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Bot className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'tools', label: 'Tools', icon: <List className="w-3.5 h-3.5 text-fuchsia-400" />, activeIcon: <List className="w-3.5 h-3.5" /> },
  { id: 'skills', label: 'Skills', icon: <Puzzle className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Puzzle className="w-3.5 h-3.5" /> },
  { id: 'plans', label: 'SkillPlan', icon: <Target className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Target className="w-3.5 h-3.5" /> },
  { id: 'mcp', label: 'MCP', icon: <Cable className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <Cable className="w-3.5 h-3.5" /> },
  { id: 'components', label: 'Components', icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />, activeIcon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'usage', label: 'Usage', icon: <History className="w-3.5 h-3.5 text-amber-400" />, activeIcon: <History className="w-3.5 h-3.5" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <BarChart3 className="w-3.5 h-3.5" /> },
];

const TAB_IDS = TABS.map((t) => t.id);

export default function PulseAgentView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as AgentTab)
    || (sessionStorage.getItem('agent-tab') as AgentTab)
    || 'overview';
  const [activeTab, setActiveTabState] = useState<AgentTab>(
    TAB_IDS.includes(initialTab) ? initialTab : 'overview',
  );

  const setActiveTab = (tab: AgentTab) => {
    setActiveTabState(tab);
    sessionStorage.setItem('agent-tab', tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % TAB_IDS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
    if (nextIndex !== null) {
      e.preventDefault();
      setActiveTab(TAB_IDS[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  }, []);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-violet-400" />
          <h1 className="text-lg font-semibold text-slate-100">Pulse Agent</h1>
        </div>

        <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1" role="tablist" aria-label="Pulse Agent tabs">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={activeTab === t.id}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => handleTabKeyDown(e, i)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'tools' && <CatalogTab />}
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'plans' && <PlansTab />}
        {activeTab === 'mcp' && <ConnectionsTab />}
        {activeTab === 'components' && <ComponentsTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add src/kubeview/views/PulseAgentView.tsx
git commit -m "feat: rewrite PulseAgentView as tabbed wrapper with 8 tabs"
```

---

### Task 5: Frontend — Update route redirects

**Files:**
- Modify: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/routes/domainRoutes.tsx`

- [ ] **Step 1: Fix the `/memory` redirect**

The `/memory` redirect currently goes to `/agent?tab=memory` but there is no memory tab. Change it to go to `/agent`:

In `domainRoutes.tsx`, change:
```tsx
<Route path="memory" element={<Navigate to="/agent?tab=memory" replace />} />
```
to:
```tsx
<Route path="memory" element={<Navigate to="/agent" replace />} />
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add src/kubeview/routes/domainRoutes.tsx
git commit -m "fix: update /memory redirect to /agent (no memory tab)"
```

---

### Task 6: Frontend — Delete MissionControlView and update tests

**Files:**
- Delete: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/views/MissionControlView.tsx`
- Modify: Any test files that import MissionControlView

- [ ] **Step 1: Check for imports of MissionControlView**

Run: `grep -r "MissionControlView" /Users/amobrem/ali/OpenshiftPulse/src/ --include="*.tsx" --include="*.ts" -l`

Update or delete any test files that reference MissionControlView.

- [ ] **Step 2: Delete MissionControlView.tsx**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
rm src/kubeview/views/MissionControlView.tsx
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add -A
git commit -m "refactor: delete MissionControlView — replaced by PulseAgentView"
```

---

### Task 7: Frontend — Move developer metrics into Analytics tab

**Files:**
- Modify: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/views/toolbox/AnalyticsTab.tsx`

- [ ] **Step 1: Add the developer-facing sections to AnalyticsTab**

At the bottom of the AnalyticsTab component's return, add the AgentHealth and AgentAccuracy components that were removed from the Overview:

```tsx
// Add these imports at the top of AnalyticsTab.tsx
import { AgentHealth } from '../mission-control/AgentHealth';
import { AgentAccuracy } from '../mission-control/AgentAccuracy';
import { CapabilityDiscovery } from '../mission-control/CapabilityDiscovery';
```

Add query hooks for the data these components need (evalStatus, coverage, fixSummary, confidence, costStats, readiness, accuracy, recommendations) and render the components at the bottom of the tab.

The exact integration depends on what already exists in AnalyticsTab — the existing sections (intelligence, prompt audit, ORCA, sessions, unused tools) stay, and the mission-control components are appended after them.

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Run test suite**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add src/kubeview/views/toolbox/AnalyticsTab.tsx
git commit -m "feat: add agent health, accuracy, and capability sections to Analytics tab"
```

---

### Task 8: Frontend — Update OverviewTab test

**Files:**
- Modify: `/Users/amobrem/ali/OpenshiftPulse/src/kubeview/views/pulse-agent/__tests__/OverviewTab.test.tsx`

- [ ] **Step 1: Update or rewrite the OverviewTab test**

The test should verify:
- Status sentence renders with scanner count
- Activity section shows empty state when no events
- Agent info footer shows version and clickable links
- Trust controls render

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OverviewTab } from '../OverviewTab';

vi.mock('../../../engine/analyticsApi', () => ({
  fetchAgentHealth: vi.fn().mockResolvedValue({ circuit_breaker: { state: 'closed' }, errors: { total: 0 }, investigations: {} }),
  fetchFixHistorySummary: vi.fn().mockResolvedValue({ completed: 0, failed: 0, rolled_back: 0, total_actions: 0, success_rate: 0, rollback_rate: 0, avg_resolution_ms: 0, by_category: [], trend: { current_week: 0, previous_week: 0, delta: 0 }, verification: { resolved: 0, still_failing: 0, improved: 0, pending: 0, resolution_rate: 0 } }),
  fetchScannerCoverage: vi.fn().mockResolvedValue({ active_scanners: 17, total_scanners: 17, scanners: [] }),
  fetchCapabilities: vi.fn().mockResolvedValue({ max_trust_level: 3, supported_auto_fix_categories: ['crashloop'] }),
  fetchAgentVersion: vi.fn().mockResolvedValue({ agent: '2.4.0', protocol: '2', tools: 118, skills: 7 }),
  fetchAgentActivity: vi.fn().mockResolvedValue({ events: [], period_days: 7 }),
}));

vi.mock('../../mission-control/TrustPolicy', () => ({
  TrustPolicy: () => <div data-testid="trust-policy" />,
}));

vi.mock('../../mission-control/ScannerDrawer', () => ({
  ScannerDrawer: () => <div data-testid="scanner-drawer" />,
}));

function renderWithProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OverviewTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewTab', () => {
  it('renders status sentence', async () => {
    renderWithProviders();
    expect(await screen.findByText(/monitoring your cluster/i)).toBeTruthy();
  });

  it('renders empty activity state', async () => {
    renderWithProviders();
    expect(await screen.findByText(/no activity yet/i)).toBeTruthy();
  });

  it('renders trust controls', async () => {
    renderWithProviders();
    expect(await screen.findByTestId('trust-policy')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx vitest run src/kubeview/views/pulse-agent/__tests__/OverviewTab.test.tsx`
Expected: All pass

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd /Users/amobrem/ali/OpenshiftPulse
git add src/kubeview/views/pulse-agent/__tests__/OverviewTab.test.tsx
git commit -m "test: update OverviewTab tests for narrative redesign"
```

---

### Task 9: Final verification and deploy

- [ ] **Step 1: Run full backend tests**

Run: `python3 -m pytest tests/ -x -q`
Expected: All pass

- [ ] **Step 2: Run full frontend tests**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx vitest run`
Expected: All pass

- [ ] **Step 3: Type check**

Run: `cd /Users/amobrem/ali/OpenshiftPulse && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Push both repos**

```bash
git push
cd /Users/amobrem/ali/OpenshiftPulse && git push
```

- [ ] **Step 5: Deploy**

```bash
cd /Users/amobrem/ali/OpenshiftPulse && ./deploy/deploy.sh
```

- [ ] **Step 6: Verify in browser**

Navigate to the deployed URL `/agent` and verify:
- Overview tab is default
- Status sentence shows scanner count
- Activity section renders
- Trust controls work
- Tab switching works for all 8 tabs
- `/toolbox` redirects to `/agent?tab=tools`
- Footer links navigate correctly
