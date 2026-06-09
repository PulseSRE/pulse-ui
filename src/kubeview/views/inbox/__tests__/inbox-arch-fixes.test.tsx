// @vitest-environment jsdom
/**
 * Tests for inbox architectural fixes:
 * A/Q: Unified count badges — DockAgentPanel and NotificationCenter use inboxStore
 * P:   current_user resolution — frontend stores and displays username
 * B4:  Deep link tab sync — InboxPage reads/writes tab param
 */
import { describe, it, expect, vi } from 'vitest';
import type { InboxResponse } from '../../../engine/inboxApi';

// ---- A/Q: Unified count badges ----

describe('A/Q: DockAgentPanel uses inboxStore for counts', () => {
  it('imports useInboxStore and does not use monitorFindings.length for counts', () => {
    const source = import.meta.glob(
      '../../../components/agent/DockAgentPanel.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain('useInboxStore');

    // Monitor status bar section should use inbox counts, not monitorFindings
    const statusBarStart = code.indexOf('Monitor status bar');
    const statusBarEnd = code.indexOf('ActionPlanTracker', statusBarStart);
    const statusBar = code.slice(statusBarStart, statusBarEnd);
    expect(statusBar).toContain('inboxNeedsAttention');
    expect(statusBar).not.toContain('monitorFindings.length');
  });

  it('does not use monitorFindings for count logic', () => {
    const source = import.meta.glob(
      '../../../components/agent/DockAgentPanel.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).not.toContain('monitorFindings.filter');
    expect(code).not.toContain("const monitorCritical");
  });
});

describe('A/Q: NotificationCenter badge uses inboxStore', () => {
  it('imports useInboxStore and uses inboxNeedsAttention for badge', () => {
    const source = import.meta.glob(
      '../../../components/agent/NotificationCenter.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain('useInboxStore');
    expect(code).toContain('inboxNeedsAttention');

    // Badge should show inboxNeedsAttention, not unreadCount
    const badgeStart = code.indexOf('inline-flex h-5 min-w-');
    const badgeSection = code.slice(badgeStart - 100, badgeStart + 200);
    expect(badgeSection).toContain('inboxNeedsAttention');
    expect(badgeSection).not.toContain('{unreadCount}');
  });

  it('still keeps unreadCount for mark-all-read button', () => {
    const source = import.meta.glob(
      '../../../components/agent/NotificationCenter.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain('markAllRead');
  });
});

// ---- P: current_user resolution ----

describe('P: current_user in InboxResponse', () => {
  it('InboxResponse type accepts current_user field', () => {
    const response: InboxResponse = {
      items: [],
      groups: [],
      stats: {},
      total: 0,
      current_user: 'alice',
    };
    expect(response.current_user).toBe('alice');
  });

  it('current_user is optional for backward compat', () => {
    const response: InboxResponse = {
      items: [],
      groups: [],
      stats: {},
      total: 0,
    };
    expect(response.current_user).toBeUndefined();
  });
});

describe('P: inboxStore stores currentUser', () => {
  it('inboxStore state includes currentUser field', () => {
    const source = import.meta.glob(
      '../../../store/inboxStore.ts',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain('currentUser:');
    expect(code).toContain('data.current_user');
  });
});

describe('P: InboxHeader shows username in My Items', () => {
  it('InboxHeader reads currentUser and displays it for my_items preset', () => {
    const source = import.meta.glob(
      '../InboxHeader.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain('currentUser');
    expect(code).toContain("my_items");
    // Should conditionally show username
    expect(code).toMatch(/My Items.*currentUser/);
  });
});

// ---- B4: InboxPage tab deep links ----

describe('B4: InboxPage tab deep links', () => {
  it('uses controlled Tabs with value prop, not defaultValue', () => {
    const source = import.meta.glob(
      '../../InboxPage.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).not.toContain('defaultValue="inbox"');
    expect(code).toContain('value={activeTab}');
    expect(code).toContain('onValueChange={handleTabChange}');
  });

  it('reads tab from searchParams on mount', () => {
    const source = import.meta.glob(
      '../../InboxPage.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    expect(code).toContain("searchParams.get('tab')");
    expect(code).toContain('setActiveTab');
  });

  it('handleTabChange updates URL params', () => {
    const source = import.meta.glob(
      '../../InboxPage.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    // Should set tab param for non-default tabs and delete for inbox
    const handlerStart = code.indexOf('handleTabChange');
    const handlerEnd = code.indexOf('handleClearFilters');
    const handler = code.slice(handlerStart, handlerEnd);
    expect(handler).toContain("next.delete('tab')");
    expect(handler).toContain("next.set('tab', value)");
  });

  it('restores tab param in didRestore effect', () => {
    const source = import.meta.glob(
      '../../InboxPage.tsx',
      { query: '?raw', import: 'default', eager: true },
    );
    const code = Object.values(source)[0] as string;
    // The didRestore effect should handle tab
    const restoreStart = code.indexOf('didRestoreRef.current');
    const restoreEnd = code.indexOf('], [searchParams');
    const restoreBlock = code.slice(restoreStart, restoreEnd);
    expect(restoreBlock).toContain("tab === 'activity'");
  });
});
