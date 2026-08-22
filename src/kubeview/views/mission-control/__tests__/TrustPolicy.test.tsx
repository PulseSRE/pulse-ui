// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrustPolicy } from '../TrustPolicy';
import { useTrustStore } from '../../../store/trustStore';

/**
 * The page that configures trust described the browser, not the agent.
 *
 * `useTrustStore` is zustand `persist` on localStorage — sent to the agent on
 * connect and never read back. The front-door badge was fixed to read the
 * server's `effective_trust_level`; this page was not, so with the agent
 * running at 2 it rendered level 1's summary: "suggests fixes with dry-run
 * previews. It never acts without your approval."
 *
 * That sentence was doubly wrong. Level 1 never enters `auto_fix` at all, so
 * it suggests nothing — the same falsehood as the old "Confirm" label,
 * surviving in a second copy of the ladder that the relabel missed.
 */
describe('the trust page describes the agent, not the browser', () => {
  beforeEach(() => {
    useTrustStore.setState({ trustLevel: 1, autoFixCategories: [], communicationStyle: 'detailed' });
  });
  afterEach(cleanup);

  const renderAt = (effective?: number) =>
    render(
      <TrustPolicy
        maxTrustLevel={4}
        effectiveTrustLevel={effective}
        scannerCount={27}
        fixSummary={null}
      />,
    );

  it('describes the level the agent is running at, not the one stored here', () => {
    renderAt(2);
    expect(screen.getByText(/proposes fixes for your review/)).toBeDefined();
  });

  it('names the gap when the two disagree', () => {
    renderAt(2);
    expect(screen.getByText(/agent is running at/)).toBeDefined();
    expect(screen.getByText(/Propose \(2\)/)).toBeDefined();
  });

  it('stays quiet when they agree', () => {
    useTrustStore.setState({ trustLevel: 2 });
    renderAt(2);
    expect(screen.queryByText(/agent is running at/)).toBeNull();
  });

  it('falls back to the stored level against an agent that does not report one', () => {
    renderAt(undefined);
    expect(screen.queryByText(/agent is running at/)).toBeNull();
  });

  it('does not claim level 1 suggests fixes, because it never proposes anything', () => {
    useTrustStore.setState({ trustLevel: 1 });
    renderAt(1);
    expect(screen.queryByText(/suggests fixes with dry-run previews/)).toBeNull();
    expect(screen.queryByText(/never acts without your approval/)).toBeNull();
    expect(screen.getByText(/never remediates on its own/)).toBeDefined();
  });

  it('level 0 still reports and takes no action', () => {
    renderAt(0);
    expect(screen.getByText(/takes no actions/)).toBeDefined();
  });
});
