// @vitest-environment jsdom
/**
 * Tests for broken feature fixes:
 * C: Source filter uses created_by instead of claimed_by
 * H: claim_item rejects terminal states (backend structural test)
 * M: TaskDetailDrawer retry button doesn't send invalid 'acknowledged' status
 */
import { describe, it, expect, vi } from 'vitest';

// ---- C: Source filter uses created_by ----

describe('C: InboxFilterBar source filter uses created_by', () => {
  it('reads created_by from filters, not claimed_by', () => {
    const source = import.meta.glob(
      '../InboxFilterBar.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;

    // Source filter should use created_by
    expect(code).toContain("filters.created_by");
    expect(code).not.toContain("filters.claimed_by");
  });

  it('onChange sets created_by in filters', () => {
    const source = import.meta.glob(
      '../InboxFilterBar.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;

    expect(code).toContain("created_by: v || undefined");
    expect(code).not.toContain("claimed_by: v || undefined");
  });

  it('InboxFilters type includes created_by field', () => {
    const source = import.meta.glob(
      '../../../engine/inboxApi.ts',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain('created_by?:');
  });
});

// ---- H: claim_item rejects terminal states (backend test in pulse-agent repo) ----
// Backend validation tested in /Users/amobrem/ali/pulse-agent/tests/test_inbox_api.py

// ---- M: TaskDetailDrawer retry doesn't send 'acknowledged' ----

describe('M: TaskDetailDrawer retry button uses valid status', () => {
  it('does not send acknowledged status (not in _TRANSITIONS)', () => {
    const source = import.meta.glob(
      '../TaskDetailDrawer.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;

    // Should NOT contain advanceStatus with 'acknowledged'
    expect(code).not.toContain("'acknowledged'");
  });

  it('retry button calls claim() directly without advanceStatus', () => {
    const source = import.meta.glob(
      '../TaskDetailDrawer.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;

    // Find the view_status failed section — spans ~500 chars
    const start = code.indexOf("view_status || '') === 'failed'");
    const failedSection = code.slice(start, start + 500);
    expect(failedSection).toContain('claim(item.id)');
    expect(failedSection).not.toContain('advanceStatus');
  });
});
