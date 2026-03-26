// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HealthAuditPanel } from '../HealthAuditPanel';
import type { AuditCheck } from '../types';

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: 'test-check',
    title: 'Test Check',
    description: 'Test description',
    why: 'Test why it matters',
    passing: [],
    failing: [],
    yamlExample: 'apiVersion: v1\nkind: Pod',
    ...overrides,
  };
}

describe('HealthAuditPanel', () => {
  afterEach(() => cleanup());
  it('renders title and score', () => {
    const checks = [
      makeCheck({ id: 'c1', title: 'Check One', passing: [{ metadata: { name: 'a' } }], failing: [] }),
      makeCheck({ id: 'c2', title: 'Check Two', passing: [], failing: [{ metadata: { name: 'b' } }] }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test Audit" />);

    expect(screen.getByText('Test Audit')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('1/2 passing')).toBeTruthy();
  });

  it('renders 100% when all checks pass', () => {
    const checks = [
      makeCheck({ id: 'c1', passing: [{ metadata: { name: 'a' } }], failing: [] }),
      makeCheck({ id: 'c2', passing: [{ metadata: { name: 'b' } }], failing: [] }),
    ];
    render(<HealthAuditPanel checks={checks} title="All Pass" />);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('shows failing items when a check is expanded', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Failing Check',
        failing: [
          { metadata: { name: 'bad-deploy', namespace: 'ns1', uid: 'uid1' } },
          { metadata: { name: 'bad-deploy-2', namespace: 'ns2', uid: 'uid2' } },
        ],
        passing: [{ metadata: { name: 'good-deploy', uid: 'uid3' } }],
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" />);

    // Not expanded yet — failing items not visible
    expect(screen.queryByText('bad-deploy')).toBeNull();

    // Click to expand
    fireEvent.click(screen.getByText('Failing Check'));

    // Now visible
    expect(screen.getByText('bad-deploy')).toBeTruthy();
    expect(screen.getByText('bad-deploy-2')).toBeTruthy();
    expect(screen.getByText('ns1')).toBeTruthy();
  });

  it('shows "Why it matters" and YAML example when expanded', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Expand Me',
        why: 'This is important because...',
        yamlExample: 'spec:\n  replicas: 3',
        failing: [{ metadata: { name: 'x' } }],
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" />);
    fireEvent.click(screen.getByText('Expand Me'));

    expect(screen.getByText('Why it matters')).toBeTruthy();
    expect(screen.getByText('This is important because...')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('replicas: 3'))).toBeTruthy();
  });

  it('shows passing items as green badges when expanded', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'With Passing',
        passing: [
          { metadata: { name: 'ok-1', uid: 'u1' } },
          { metadata: { name: 'ok-2', uid: 'u2' } },
        ],
        failing: [{ metadata: { name: 'fail-1' } }],
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" />);
    fireEvent.click(screen.getByText('With Passing'));

    expect(screen.getByText('ok-1')).toBeTruthy();
    expect(screen.getByText('ok-2')).toBeTruthy();
  });

  it('calls onNavigateItem when a failing item is clicked', () => {
    const onNav = vi.fn();
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Nav Check',
        failing: [{ metadata: { name: 'item-1', uid: 'u1' } }],
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" onNavigateItem={onNav} />);
    fireEvent.click(screen.getByText('Nav Check'));
    fireEvent.click(screen.getByText('item-1'));

    expect(onNav).toHaveBeenCalledOnce();
    expect(onNav).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1' }),
      expect.objectContaining({ metadata: { name: 'item-1', uid: 'u1' } }),
      0,
    );
  });

  it('uses custom navigateLabel', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Custom Label',
        failing: [{ metadata: { name: 'x' } }],
      }),
    ];
    render(
      <HealthAuditPanel
        checks={checks}
        title="Test"
        onNavigateItem={vi.fn()}
        navigateLabel={() => 'Edit YAML'}
      />,
    );
    fireEvent.click(screen.getByText('Custom Label'));
    // The arrow entity renders as part of the link text
    const link = screen.getByText(/Edit YAML/);
    expect(link).toBeTruthy();
  });

  it('uses custom failingLabel and fixLabel', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Custom Labels',
        failing: [{ metadata: { name: 'x' } }],
        failingLabel: 'Pending (1)',
        fixLabel: 'Configuration example:',
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" />);
    fireEvent.click(screen.getByText('Custom Labels'));

    expect(screen.getByText('Pending (1)')).toBeTruthy();
    expect(screen.getByText('Configuration example:')).toBeTruthy();
  });

  it('truncates failing items beyond maxFailingItems', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      metadata: { name: `item-${i}`, uid: `uid-${i}` },
    }));
    const checks = [makeCheck({ id: 'c1', title: 'Many Items', failing: items })];
    render(<HealthAuditPanel checks={checks} title="Test" maxFailingItems={5} />);
    fireEvent.click(screen.getByText('Many Items'));

    // Should show first 5 and a "+10 more" message
    expect(screen.getByText('item-0')).toBeTruthy();
    expect(screen.getByText('item-4')).toBeTruthy();
    expect(screen.queryByText('item-5')).toBeNull();
    expect(screen.getByText('+10 more')).toBeTruthy();
  });

  it('renders item badges via renderItemBadges', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'With Badges',
        failing: [{ metadata: { name: 'node-1' }, _pressureType: 'Memory' }],
      }),
    ];
    render(
      <HealthAuditPanel
        checks={checks}
        title="Test"
        renderItemBadges={(_check, item) => {
          const pressure = (item as Record<string, unknown>)._pressureType as string | undefined;
          return pressure ? <span data-testid="badge">{pressure}</span> : null;
        }}
      />,
    );
    fireEvent.click(screen.getByText('With Badges'));
    expect(screen.getByTestId('badge').textContent).toBe('Memory');
  });

  it('collapses an expanded check on second click', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Toggle Me',
        why: 'Toggle why',
        failing: [{ metadata: { name: 'x' } }],
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" />);

    // Expand
    fireEvent.click(screen.getByText('Toggle Me'));
    expect(screen.getByText('Toggle why')).toBeTruthy();

    // Collapse
    fireEvent.click(screen.getByText('Toggle Me'));
    expect(screen.queryByText('Toggle why')).toBeNull();
  });

  it('uses fallback name from item.name when metadata.name is absent', () => {
    const checks = [
      makeCheck({
        id: 'c1',
        title: 'Fallback Names',
        passing: [{ name: 'note-based-name' }],
        failing: [{ name: 'failing-note' }],
      }),
    ];
    render(<HealthAuditPanel checks={checks} title="Test" />);
    fireEvent.click(screen.getByText('Fallback Names'));

    expect(screen.getByText('note-based-name')).toBeTruthy();
    expect(screen.getByText('failing-note')).toBeTruthy();
  });
});
