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

describe('server monitor pause and policy controls', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('can resume authoritative paused state even with low browser trust', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    useTrustStore.setState({ trustLevel: 1 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<TrustPolicy maxTrustLevel={4} effectiveTrustLevel={3} scannerCount={1} fixSummary={null} autofixPaused={true} onPauseChanged={refresh} supportedAutoFixCategories={['crashloop', 'workloads']} />);
    fireEvent.click(screen.getByText('Resume Auto-Fix'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/agent/monitor/resume', { method: 'POST' });
    expect(screen.getByText(/monitor uses all server-supported/)).toBeDefined();
  });

  it('surfaces server failures instead of pretending pause succeeded', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const refresh = vi.fn();
    render(<TrustPolicy maxTrustLevel={4} effectiveTrustLevel={3} scannerCount={1} fixSummary={null} autofixPaused={false} onPauseChanged={refresh} />);
    fireEvent.click(screen.getByText('Pause Auto-Fix (Emergency Kill Switch)'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('403'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
