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

/** Pulse AI's own surfaces: raw violet classes are allowed here. */
const AI_SURFACES = [
  'components/agent/',            // the chat dock, AI renderers and the tokens themselves
  'components/sidebar/',          // the Pulse AI sidebar
  'components/AskPulsePanel.tsx', // the palette's Ask Pulse answer
  'components/CommandPalette.tsx', // the palette's AI query mode
  'views/toolbox/',               // Pulse Agent settings: tools, skills, MCP
  'views/mission-control/',       // Pulse Agent settings: trust, evals, accuracy
  'views/PulseAgentView.tsx',
  'views/MemoryView.tsx',         // what the agent learned
  'views/CustomView.tsx',         // dashboards Pulse AI builds
  'views/ViewsManagement.tsx',
  'views/incidents/',             // agent investigations, hypotheses and postmortems
  'views/inbox/InboxLifecycle.tsx', // the agent's processing stage
  'engine/colors.ts',             // chart palette; the comment names the Tailwind shade
];

const COLOUR_CLASS = /\b(?:[a-z]+:)*(?:bg|text|border|ring|from|via|to|fill|stroke|accent|outline|divide|shadow|decoration|placeholder|caret)-(?:violet|purple)-\d{2,3}\b/g;

/**
 * Labels the AI entry points used before they all became "Ask Pulse…".
 * Matched inside string and JSX text, case-sensitive.
 */
const OLD_LABELS = [
  'Ask AI',
  'Analyze with AI',
  'Investigate with AI',
  'Investigate with Pulse',
  'Fix with AI',
  'Ask the Agent',
  'Ask the agent...',
  'Ask Agent',
  'Ask the Security Agent',
  'Ask Pulse Agent',
  'Pulse AI Agent',
  'Ask in chat',
  'Deep Dive',
  'How do I fix this?',
];

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
const isAiSurface = (rel: string) => AI_SURFACES.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));

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
        const hits = line.match(COLOUR_CLASS);
        if (hits) offenders.push(`${rel}:${i + 1} ${hits.join(' ')}`);
      });
    }
    expect(offenders, 'Use blue for selection/primary, slate for neutral, or AI_ACCENT for an AI state').toEqual([]);
  });

  it('every listed AI surface exists, so the list cannot outlive the code', () => {
    for (const p of AI_SURFACES) {
      const target = path.join(ROOT, p);
      expect(fs.existsSync(target), p).toBe(true);
    }
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
        // Inside a string literal or as JSX text: preceded by a quote, backtick, '>' or '}' (allowing whitespace).
        const re = new RegExp(`(['"\`>}]\\s*)${escaped}(?![A-Za-z])`);
        if (re.test(code)) offenders.push(`${rel}: "${label}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
