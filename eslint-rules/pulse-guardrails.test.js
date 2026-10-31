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
  ],
  invalid: [
    { code: "const STATUS_COLORS = { warning: 'text-yellow-400' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const SEVERITY_COLOR: Record<string, string> = { critical: 'bg-red-500' };", errors: [{ messageId: 'inlineMap' }] },
    { code: "const POD_STATUS_COLOR = { Running: '#10b981' } as const;", errors: [{ messageId: 'inlineMap' }] },
    { code: "const PHASE_STYLES = { Paused: { color: 'text-amber-400' } };", errors: [{ messageId: 'inlineMap' }] },
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
    ].join('\n');
    const rules = await lint(code, 'src/kubeview/views/NewPage.tsx');
    expect(rules).toEqual(expect.arrayContaining([
      'pulse/no-inline-status-colors',
      'pulse/no-private-stat-primitives',
      'no-restricted-properties',
      'no-restricted-globals',
    ]));
  }, 30_000);

  it('lets primitives and the engine define them', async () => {
    expect(await lint("export const STATUS_COLORS = { ok: 'x' };", 'src/kubeview/engine/newMap.ts')).toEqual([]);
    expect(await lint('export function StatCard() { return null; }', 'src/kubeview/components/primitives/New.tsx')).toEqual([]);
  }, 30_000);
});
