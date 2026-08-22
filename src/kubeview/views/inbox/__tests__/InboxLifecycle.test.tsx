// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InboxLifecycleBadge, InboxLifecycleStepper } from '../InboxLifecycle';

describe('InboxLifecycleBadge — where this item is, not the whole ladder', () => {
  // The badge used to print all five stages on every row. Down a real inbox
  // that is the same five words twenty times, wider than the finding's own
  // title — measured on the reference cluster at 32 open items. A list answers
  // "where is each of these"; one item's full progression belongs to the
  // detail view, which is what the stepper does in the drawer.

  it('names only the stage the item is actually at', () => {
    render(<InboxLifecycleBadge itemType="finding" status="triaged" />);
    expect(screen.getByText('Triaged')).toBeDefined();
    for (const other of ['New', 'Claimed', 'In Progress', 'Resolved']) {
      expect(screen.queryByText(other)).toBeNull();
    }
  });

  it('still shows position, so the stage is not just a word', () => {
    // Five dots, filled up to here: "Triaged" alone does not say whether that
    // is early or nearly done.
    const { container } = render(<InboxLifecycleBadge itemType="finding" status="triaged" />);
    expect(container.querySelectorAll('.rounded-full').length).toBe(5);
    expect(container.querySelectorAll('.bg-emerald-500').length).toBe(1); // New, behind us
    expect(container.querySelectorAll('.bg-slate-600').length).toBe(3); // three still ahead
  });

  it('keeps the full ladder available on hover', () => {
    const { container } = render(<InboxLifecycleBadge itemType="finding" status="claimed" />);
    const title = container.querySelector('[title]')?.getAttribute('title') ?? '';
    expect(title).toContain('New');
    expect(title).toContain('Claimed ←');
    expect(title).toContain('Resolved');
  });

  it('reads the same for every item type', () => {
    for (const type of ['finding', 'task', 'alert', 'assessment'] as const) {
      const { unmount } = render(<InboxLifecycleBadge itemType={type} status="new" />);
      expect(screen.getByText('New')).toBeDefined();
      unmount();
    }
  });

  it('highlights current status with pulse for agent_reviewing', () => {
    const { container } = render(<InboxLifecycleBadge itemType="finding" status="agent_reviewing" />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows Cleared for agent_cleared', () => {
    render(<InboxLifecycleBadge itemType="finding" status="agent_cleared" />);
    expect(screen.getAllByText(/Cleared/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('InboxLifecycleStepper', () => {
  it('renders universal stepper', () => {
    render(<InboxLifecycleStepper itemType="finding" status="triaged" />);
    expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Triaged').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Claimed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Resolved').length).toBeGreaterThanOrEqual(1);
  });

  it('maps in_progress correctly', () => {
    render(<InboxLifecycleStepper itemType="task" status="in_progress" />);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
  });
});
