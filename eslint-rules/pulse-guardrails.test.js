import { RuleTester } from 'eslint';
import tsparser from '@typescript-eslint/parser';
import { describe, it, expect } from 'vitest';
import plugin from './pulse-guardrails.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsparser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-private-stat-primitives', plugin.rules['no-private-stat-primitives'], {
  valid: [
    "import { StatCard } from '../components/primitives/StatCard'; const x = <StatCard label='a' value={1} />;",
    'function StatCardGrid() { return null; }',
    'const StatusDotSize = 3;',
  ],
  invalid: [
    { code: 'function StatCard() { return null; }', errors: [{ messageId: 'privateCopy' }] },
    { code: 'const StatusDot = () => null;', errors: [{ messageId: 'privateCopy' }] },
    { code: 'const SummaryCard = React.memo(() => null);', errors: [{ messageId: 'privateCopy' }] },
    { code: 'function StatPill({ label }) { return label; }', errors: [{ messageId: 'privateCopy' }] },
  ],
});

tester.run('no-inline-status-colors', plugin.rules['no-inline-status-colors'], {
  valid: [
    "import { statusClasses } from '../engine/statusColors'; const c = statusClasses('warning').text;",
    "const STATUS_LABELS = { ok: 'OK' };",
    "const statusColor = isOk ? 'text-emerald-400' : 'text-red-400';",
    "const STATUS_MAP = { ok: 'OK', bad: 'Broken' };",
    "const statusLabels = { ok: 'OK' };",
  ],
  invalid: [
    { code: "const STATUS_COLORS = { warning: 'text-yellow-400' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const SEVERITY_COLOR: Record<string, string> = { critical: 'bg-red-500' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const POD_STATUS_COLOR = { Running: '#10b981' } as const;", errors: [{ messageId: 'inlineMap' }] },
    { code: "const PHASE_STYLES = { Paused: { color: 'text-amber-400' } };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const statusColors = { ok: 'text-emerald-400' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const PHASE_COLOR_MAP = { Running: 'bg-green-500' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const SEVERITY_DOT = { critical: 'bg-red-500' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "function Row({ sev }) { const severityColor = { critical: 'text-red-400' }[sev]; return severityColor; }", errors: [{ messageId: 'inlineMap' }] },
  ],
});

tester.run('no-yellow', plugin.rules['no-yellow'], {
  valid: [
    "const c = 'text-amber-400 bg-amber-500/10';",
    "const level: 'green' | 'yellow' | 'red' = 'yellow';",
    "const label = 'Yellow submarine';",
    "const hex = '#f59e0b';",
    "import x from './yellow-500';",
  ],
  invalid: [
    { code: "const c = 'text-yellow-400';", errors: [{ messageId: 'yellow' }] },
    { code: "const c = 'px-1 hover:bg-yellow-900/50 rounded';", errors: [{ messageId: 'yellow' }] },
    { code: "const c = 'border-l-yellow-500';", errors: [{ messageId: 'yellow' }] },
    { code: 'const c = `w-2 ${on ? "x" : ""} bg-yellow-500`;', errors: [{ messageId: 'yellow' }] },
    { code: "const c = { color: '#EAB308' };", errors: [{ messageId: 'yellow' }] },
    { code: "const c = 'rgba(234, 179, 8, 0.15)';", errors: [{ messageId: 'yellow' }] },
    { code: "const x = <span className='text-yellow-300'>!</span>;", errors: [{ messageId: 'yellow' }] },
  ],
});

tester.run('no-low-contrast-text', plugin.rules['no-low-contrast-text'], {
  valid: [
    "const x = <p className='text-xs text-faint'>No data</p>;",
    "const x = <p className='text-muted'>Hint</p>;",
    "const x = <span className='text-slate-400'>ok</span>;",
    "const x = <div className='border-slate-600 bg-slate-700'>a</div>;",
    // Icons are not text.
    "import { Info } from 'lucide-react'; const x = <Info className='w-4 h-4 text-slate-600' />;",
    "import { Info as I } from 'lucide-react'; const x = <I className={cn('w-4', on ? 'text-red-400' : 'text-slate-500')} />;",
    "const x = <SeverityIcon className='text-slate-600' />;",
    "const x = <cfg.Icon className='text-slate-600' />;",
    // Separator glyphs are decorative.
    "const x = <span className='text-slate-700 mx-1'>›</span>;",
    "const x = <span className='text-slate-600'>&middot;</span>;",
    "const x = <span className='text-slate-600'> · </span>;",
    // Disabled controls are exempt.
    "const x = <button className='text-blue-400 disabled:text-slate-500'>Go</button>;",
    "const c = ok ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed';",
  ],
  invalid: [
    { code: "const x = <p className='text-xs text-slate-600'>All clusters are quiet.</p>;", errors: [{ messageId: 'lowContrast', data: { cls: 'text-slate-600' } }] },
    { code: "const x = <p className='text-slate-500'>Hint</p>;", errors: [{ messageId: 'lowContrast' }] },
    { code: "const x = <span className='text-slate-700'>12m ago</span>;", errors: [{ messageId: 'lowContrast' }] },
    { code: "const x = <input className='placeholder:text-slate-600' />;", errors: [{ messageId: 'lowContrast', data: { cls: 'placeholder:text-slate-600' } }] },
    { code: "const c = cond ? 'text-slate-300' : 'text-slate-600';", errors: [{ messageId: 'lowContrast' }] },
    { code: 'const c = `text-xs ${x} text-slate-500`;', errors: [{ messageId: 'lowContrast' }] },
    // A lone dash means "no value": that is content, not a separator.
    { code: "const x = <span className='text-slate-600'>-</span>;", errors: [{ messageId: 'lowContrast' }] },
    // An aria-label makes the glyph meaningful.
    { code: "const x = <span aria-label='not recorded' className='text-slate-500'>•</span>;", errors: [{ messageId: 'lowContrast' }] },
    // An enabled button whose disabled look is a variant is still checked.
    { code: "const x = <button className='p-2 text-slate-500 disabled:cursor-not-allowed'>Edit</button>;", errors: [{ messageId: 'lowContrast' }] },
    // Text beside an icon is still text.
    { code: "import { Info } from 'lucide-react'; const x = <span className='text-slate-600'><Info className='w-3' /> Note</span>;", errors: [{ messageId: 'lowContrast' }] },
  ],
});

describe('repository ESLint config', () => {
  const root = new URL('..', import.meta.url).pathname;

  async function lint(code, filePath) {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` });
    return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
  }

  it('fails a new page that uses window.confirm, a private StatCard or a status colour map', async () => {
    const code = [
      "const STATUS_COLORS = { warning: 'text-yellow-400' };",
      'function StatCard() { return null; }',
      "export function go() { if (window.confirm('sure?')) StatCard(); return STATUS_COLORS; }",
      "export function go2() { return confirm('sure?'); }",
      "export function go3() { return globalThis.confirm('sure?'); }",
    ].join('\n');
    const rules = await lint(code, 'src/kubeview/views/NewPage.tsx');
    expect(rules).toEqual(expect.arrayContaining([
      'pulse/no-inline-status-colors',
      'pulse/no-private-stat-primitives',
      'no-restricted-properties',
      'no-restricted-globals',
    ]));
    expect(rules.filter((r) => r === 'no-restricted-properties')).toHaveLength(2);
  }, 30_000);

  it('bans yellow and low-contrast text everywhere, primitives and engine included', async () => {
    const code = "export const a = 'text-yellow-400'; export const b = 'text-xs text-slate-600';";
    for (const file of ['src/kubeview/views/NewPage.tsx', 'src/kubeview/components/NewPanel.tsx', 'src/kubeview/components/primitives/New.tsx', 'src/kubeview/engine/new.ts']) {
      expect(await lint(code, file)).toEqual(['pulse/no-yellow', 'pulse/no-low-contrast-text']);
    }
  }, 30_000);

  it('allows a commented exception', async () => {
    const code = [
      '// eslint-disable-next-line pulse/no-yellow -- a favourite star, not a status',
      "export const star = 'text-yellow-400';",
    ].join('\n');
    expect(await lint(code, 'src/kubeview/components/NewPanel.tsx')).toEqual([]);
  }, 30_000);

  it('passes the codemod output', async () => {
    const { transform } = await import('../scripts/codemods/text-tokens.mjs');
    const before = [
      "import { Info } from 'lucide-react';",
      'export const X = () => (',
      "  <div className='text-xs text-slate-600 hover:text-slate-500'>",
      "    <Info className='w-3 h-3 text-slate-600' />",
      "    <span className='text-yellow-400'>warn</span>",
      "    <span className='text-slate-700'>·</span>",
      "    <button disabled className='disabled:text-slate-600 bg-yellow-900/50'>x</button>",
      '  </div>',
      ');',
    ].join('\n');
    const after = transform(before, 'X.tsx');
    expect(after).toContain("'text-xs text-faint hover:text-faint'");
    expect(after).toContain("'w-3 h-3 text-slate-600'");
    expect(after).toContain("'text-amber-400'");
    expect(after).toContain("'text-slate-700'>·");
    expect(after).toContain("'disabled:text-slate-600 bg-amber-900/50'");
    expect(transform(after, 'X.tsx')).toBe(after);
    expect(await lint(after, 'src/kubeview/components/NewPanel.tsx')).toEqual([]);
    expect(await lint(before, 'src/kubeview/components/NewPanel.tsx')).toEqual(['pulse/no-low-contrast-text', 'pulse/no-yellow', 'pulse/no-yellow']);
  }, 30_000);

  it('lets primitives and the engine define them', async () => {
    expect(await lint("export const STATUS_COLORS = { ok: 'x' };", 'src/kubeview/engine/newMap.ts')).toEqual([]);
    expect(await lint('export function StatCard() { return null; }', 'src/kubeview/components/primitives/New.tsx')).toEqual([]);
  }, 30_000);
});
