// @vitest-environment jsdom
/**
 * Tests for inbox quick-win fixes:
 * G: camelCase/snake_case investigation metadata normalization
 * I: WS event debounce — updated events use stats-only refresh
 * L: selectedItemId not cleared on list fetch failure
 */
import { describe, it, expect, vi } from 'vitest';
import type { InvestigationReport } from '../../../engine/inboxApi';

vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector) => {
    const state = {
      resolve: vi.fn(),
      claim: vi.fn(),
      dismiss: vi.fn(),
      restore: vi.fn(),
      advanceStatus: vi.fn(),
    };
    return selector(state);
  }),
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: { getState: () => ({ connectAndSend: vi.fn() }) },
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: { getState: () => ({ expandAISidebar: vi.fn(), setAISidebarMode: vi.fn(), addToast: vi.fn(), setActiveTab: vi.fn() }) },
}));

// ---- G: InvestigationReport type supports both casing forms ----

describe('G: InvestigationReport camelCase/snake_case normalization', () => {
  it('InvestigationReport type accepts both snake_case and camelCase fields', () => {
    const snakeCase: InvestigationReport = {
      id: 'inv-1',
      summary: 'OOM killed',
      suspected_cause: 'Memory limit too low',
      recommended_fix: 'Increase memory limit',
      confidence: 0.85,
      evidence: ['Pod restarted 3 times'],
      alternatives_considered: ['CPU throttling'],
    };
    expect(snakeCase.suspected_cause).toBe('Memory limit too low');
    expect(snakeCase.recommended_fix).toBe('Increase memory limit');

    const camelCase: InvestigationReport = {
      id: 'inv-2',
      summary: 'CrashLoop',
      suspected_cause: '',
      suspectedCause: 'Missing config map',
      recommended_fix: '',
      recommendedFix: 'Create configmap',
      confidence: 0.7,
      evidence: [],
      alternatives_considered: [],
      alternativesConsidered: ['Bad image'],
    };
    expect(camelCase.suspectedCause).toBe('Missing config map');
    expect(camelCase.recommendedFix).toBe('Create configmap');
    expect(camelCase.alternativesConsidered).toEqual(['Bad image']);
  });

  it('fallback reads camelCase when snake_case is empty', () => {
    const report: InvestigationReport = {
      id: 'inv-3',
      summary: 'Test',
      suspected_cause: '',
      suspectedCause: 'Cause via camelCase',
      recommended_fix: '',
      recommendedFix: 'Fix via camelCase',
      confidence: 0.8,
      evidence: [],
      alternatives_considered: [],
    };
    const cause = report.suspected_cause || report.suspectedCause;
    const fix = report.recommended_fix || report.recommendedFix;
    expect(cause).toBe('Cause via camelCase');
    expect(fix).toBe('Fix via camelCase');
  });

  it('snake_case takes precedence when both are present', () => {
    const report: InvestigationReport = {
      id: 'inv-4',
      summary: 'Test',
      suspected_cause: 'Snake wins',
      suspectedCause: 'Camel loses',
      recommended_fix: 'Snake fix',
      recommendedFix: 'Camel fix',
      confidence: 0.8,
      evidence: [],
      alternatives_considered: [],
    };
    const cause = report.suspected_cause || report.suspectedCause;
    const fix = report.recommended_fix || report.recommendedFix;
    expect(cause).toBe('Snake wins');
    expect(fix).toBe('Snake fix');
  });
});

// ---- I: WS inbox_item_updated uses stats-only refresh ----

describe('I: WS inbox_item_updated uses stats-only refresh', () => {
  it('inbox_item_updated handler calls refreshStats, not debouncedInboxRefresh', () => {
    const source = import.meta.glob('../../../store/monitorStore.ts', { query: '?raw', import: 'default', eager: true });
    const code = Object.values(source)[0] as string;

    const updatedBlock = code.slice(
      code.indexOf("case 'inbox_item_updated'"),
      code.indexOf("case 'inbox_item_claimed'"),
    );
    expect(updatedBlock).toContain('refreshStats');
    expect(updatedBlock).not.toContain('debouncedInboxRefresh');
  });

  it('inbox_item_created still uses full debouncedInboxRefresh', () => {
    const source = import.meta.glob('../../../store/monitorStore.ts', { query: '?raw', import: 'default', eager: true });
    const code = Object.values(source)[0] as string;

    const createdBlock = code.slice(
      code.indexOf("case 'inbox_item_created'"),
      code.indexOf("case 'inbox_item_updated'"),
    );
    expect(createdBlock).toContain('debouncedInboxRefresh');
  });

  it('inbox_item_resolved still uses full debouncedInboxRefresh', () => {
    const source = import.meta.glob('../../../store/monitorStore.ts', { query: '?raw', import: 'default', eager: true });
    const code = Object.values(source)[0] as string;

    const resolvedBlock = code.slice(
      code.indexOf("case 'inbox_item_resolved'"),
      code.indexOf("case 'inbox_item_resolved'") + 200,
    );
    expect(resolvedBlock).toContain('debouncedInboxRefresh');
  });
});

// ---- L: selectedItemId not cleared on list fetch failure ----

describe('L: selectedItemId preserved on list fetch failure', () => {
  it('refresh() catch block does not clear selectedItemId', () => {
    const source = import.meta.glob('../../../store/inboxStore.ts', { query: '?raw', import: 'default', eager: true });
    const code = Object.values(source)[0] as string;

    const refreshStart = code.indexOf('refresh: async');
    const refreshEnd = code.indexOf('refreshStats:', refreshStart);
    const refreshBody = code.slice(refreshStart, refreshEnd);

    const catchStart = refreshBody.indexOf('catch');
    const catchBody = refreshBody.slice(catchStart);
    expect(catchBody).not.toContain('selectedItemId');
  });
});
