/**
 * Guardrail: violet means Pulse AI, and every "ask the AI" entry says
 * "Ask Pulse".
 *
 * Violet used to mark Identity's selected tab, the Inbox "Needs Attention"
 * preset and the Readiness wizard toggle as well as the assistant, so it
 * stopped meaning "this is the AI". Non-AI selection is blue, neutral chips
 * are slate. A component that shows an AI state outside the AI surfaces below
 * takes it from `AI_ACCENT` (components/agent/aiTokens.ts) instead of writing
 * a violet class, so this scan sees it as AI.
 *
 * Scope: Tailwind colour classes (`bg-violet-600`, `text-purple-400`, …) in
 * non-test source. Hex values in data-visualisation palettes (chart series,
 * topology node kinds) and the logo gradient are categorical, not UI state,
 * and are not scanned.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/**
 * Files that are Pulse AI's own surfaces, one by one, so a new file in the
 * same folder is not allowed by default. Selection states inside them (tabs,
 * filters, toggles) are still blue; violet here marks the assistant itself.
 */
const AI_SURFACES = [
  'components/AskPulsePanel.tsx',                       // the palette's Ask Pulse answer
  'components/CommandPalette.tsx',                      // the palette's AI query mode
  'components/agent/AIOnboarding.tsx',                  // introduces Pulse AI
  'components/agent/AgentChart.tsx',                    // charts Pulse AI draws in chat
  'components/agent/AgentEditBanner.tsx',               // Pulse AI is editing a view
  'components/agent/AgentTopology.tsx',                 // topology Pulse AI draws in chat
  'components/agent/MessageBubble.tsx',                 // Pulse AI's messages
  'components/agent/ThinkingIndicator.tsx',             // Pulse AI is thinking
  'components/agent/aiTokens.ts',                       // the AI colour itself
  'components/agent/renderers/DataRenderer.tsx',        // components Pulse AI renders
  'components/agent/renderers/VisualizationRenderer.tsx',
  'components/sidebar/AISidebar.tsx',                   // the Pulse AI sidebar
  'components/sidebar/DashboardMode.tsx',               // the sidebar's view-builder prompts
  'views/CustomView.tsx',                               // dashboards Pulse AI builds
  'views/ViewsManagement.tsx',
  'views/MemoryView.tsx',                               // what Pulse AI learned
  'views/PulseAgentView.tsx',                           // Pulse AI settings
  'views/inbox/InboxLifecycle.tsx',                     // the agent's processing stage
  'views/incidents/ActivityTab.tsx',                    // agent activity
  'views/incidents/IncidentLifecycleDrawer.tsx',        // agent hypotheses and skills
  'views/incidents/shared/InvestigationCard.tsx',       // the agent's suspected cause
  'views/incidents/shared/PostmortemCard.tsx',          // agent-drafted postmortem
  'views/mission-control/AgentAccuracy.tsx',            // Pulse AI settings: accuracy, memory link
  'views/mission-control/AgentHealth.tsx',
  'views/mission-control/CapabilityDiscovery.tsx',      // "Ask Pulse" recommendations
  'views/mission-control/EvalDrawer.tsx',
  'views/mission-control/OutcomesDrawer.tsx',           // chat-action outcomes
  'views/toolbox/CatalogTab.tsx',                       // Pulse AI tools, skills, MCP
  'views/toolbox/ComponentsTab.tsx',
  'views/toolbox/ConnectionsTab.tsx',
  'views/toolbox/OrcaAnalyticsSection.tsx',
  'views/toolbox/PromptAuditSection.tsx',
  'views/toolbox/SessionAnalyticsSection.tsx',
  'views/toolbox/SkillDetailDrawer.tsx',
  'views/toolbox/SkillsTab.tsx',
  'views/toolbox/ToolCard.tsx',
  'views/toolbox/ToolDetailDrawer.tsx',
  'views/toolbox/UsageRow.tsx',
];

/** Tailwind colour classes in the violet family, with or without variants (hover:, focus:). */
const COLOUR_CLASS = /\b(?:[a-z]+:)*(?:bg|text|border|ring|from|via|to|fill|stroke|accent|outline|divide|shadow|decoration|placeholder|caret)-(?:violet|purple|fuchsia)-\d{2,3}\b/g;
/** Arbitrary-value classes with a violet-family hex, e.g. `bg-[#7c3aed]`. */
const ARBITRARY_VIOLET = /-\[#(?:7c3aed|6d28d9|5b21b6|8b5cf6|a78bfa|c4b5fd|ddd6fe|a855f7|9333ea|7e22ce|c084fc|d946ef|c026d3|e879f9)\]/gi;

/**
 * Labels the AI entry points used before they all became "Ask Pulse…".
 * Matched inside string and JSX text, case-sensitive. An entry ending in a
 * space is a prefix ("Ask the …" anything).
 */
const OLD_LABELS = [
  'Ask AI',
  'Analyze with AI',
  'Investigate with AI',
  'Investigate with Pulse',
  'Fix with AI',
  'Edit with AI',
  'Ask the ',
  'Ask Agent',
  'Ask Pulse Agent',
  'Pulse AI Agent',
  'Ask in chat',
  'Try in chat',
  'Deep Dive',
  'How do I fix this?',
];

/**
 * How many AI entry points (AskPulseButton, its base, AskPulsePrompts, or a
 * hand-built control marked data-ai-entry) each converted file has. A file
 * that drops one back to an ad-hoc button fails here.
 */
const ENTRY_COUNTS: Record<string, number> = {
  'components/ErrorBoundary.tsx': 1,
  'components/agent/AmbientInsight.tsx': 1,
  'components/feedback/Toast.tsx': 1,
  'components/onboarding/GateCard.tsx': 1,
  'views/ArgoCDView.tsx': 1,
  'views/OperatorCatalogView.tsx': 1,
  'views/SecurityView.tsx': 2,
  'views/admin/CertificatesTab.tsx': 1,
  'views/admin/ErrorsTab.tsx': 1,
  'views/admin/QuotasTab.tsx': 1,
  'views/admin/UpgradeReadinessPanel.tsx': 1,
  'views/alerts/AlertTriage.tsx': 1,
  'views/alerts/RuleDetailDrawer.tsx': 1,
  'views/compute/CapacityTab.tsx': 1,
  'views/create/HelmReleases.tsx': 1,
  'views/create/QuickDeployTab.tsx': 1,
  'views/detail/AskPulseCard.tsx': 1,
  'views/detail/FixCard.tsx': 1,
  'views/identity/WhoCanPanel.tsx': 1,
  'views/inbox/EpisodePanel.tsx': 1,
  'views/inbox/TaskDetailDrawer.tsx': 6,
  'views/incidents/shared/CorrelationGroupRow.tsx': 1,
  'views/pulse/AttentionList.tsx': 3,
  'views/pulse/ReportTab.tsx': 1,
};
const ENTRY = /<AskPulseButton(?:Base)?\b|<AskPulsePrompts\b|data-ai-entry=/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__fixtures__') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(ROOT).map((f) => ({ rel: path.relative(ROOT, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));
const isAiSurface = (rel: string) => AI_SURFACES.includes(rel);

/** Drop // and /* *\/ comments so a note about history does not count as UI text. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('violet is reserved for Pulse AI', () => {
  it('no component outside the AI surfaces writes a violet or purple colour class', () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      if (isAiSurface(rel)) continue;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const hits = [...(line.match(COLOUR_CLASS) ?? []), ...(line.match(ARBITRARY_VIOLET) ?? [])];
        if (hits.length) offenders.push(`${rel}:${i + 1} ${hits.join(' ')}`);
      });
    }
    expect(offenders, 'Use blue for selection/primary, slate for neutral, or AI_ACCENT for an AI state').toEqual([]);
  });

  it('every listed AI surface exists and still uses the AI colour, so the list cannot outlive the code', () => {
    for (const p of AI_SURFACES) {
      const f = files.find((x) => x.rel === p);
      expect(f, p).toBeDefined();
      expect((f!.text.match(COLOUR_CLASS) ?? []).length, `${p} no longer uses violet; drop it from AI_SURFACES`).toBeGreaterThan(0);
    }
  });

  it('the scan also catches fuchsia and arbitrary violet hex classes', () => {
    expect('text-fuchsia-400'.match(COLOUR_CLASS)).not.toBeNull();
    expect('hover:bg-violet-600/20'.match(COLOUR_CLASS)).not.toBeNull();
    expect('bg-[#7c3aed]'.match(ARBITRARY_VIOLET)).not.toBeNull();
    expect('bg-blue-600 text-slate-300'.match(COLOUR_CLASS)).toBeNull();
  });

  it('the scan sees the token module (sanity: the regex matches what AI_ACCENT holds)', () => {
    const tokens = files.find((f) => f.rel === 'components/agent/aiTokens.ts');
    expect(tokens?.text.match(COLOUR_CLASS)?.length ?? 0).toBeGreaterThan(5);
  });
});

describe('AI entry points say "Ask Pulse"', () => {
  it('none of the old labels remain in UI text', () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      const code = stripComments(text);
      for (const label of OLD_LABELS) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tail = label.endsWith(' ') ? '' : '(?![A-Za-z])';
        // Inside a string literal or as JSX text: preceded by a quote, backtick, '>' or '}' (allowing whitespace).
        const re = new RegExp(`(['"\`>}]\\s*)${escaped}${tail}`);
        if (re.test(code)) offenders.push(`${rel}: "${label}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('each converted file keeps its AI entry points on the shared primitive', () => {
    const counts = Object.fromEntries(Object.keys(ENTRY_COUNTS).map((rel) => {
      const f = files.find((x) => x.rel === rel);
      return [rel, f ? (f.text.match(ENTRY) ?? []).length : -1];
    }));
    expect(counts).toEqual(ENTRY_COUNTS);
  });
});
