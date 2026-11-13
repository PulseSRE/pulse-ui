// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type React from 'react';
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
    const note = screen.getByTestId('trust-mismatch');
    expect(note.textContent).toMatch(/agent is running at/);
    expect(note.textContent).toMatch(/Propose \(2\)/);
  });

  it('stays quiet when they agree', () => {
    useTrustStore.setState({ trustLevel: 2 });
    renderAt(2);
    expect(screen.queryByText(/agent is running at/)).toBeNull();
    expect(screen.queryByTestId('trust-mismatch')).toBeNull();
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
    expect(screen.getByText(/The monitor can remediate these categories/)).toBeDefined();
  });

  it('shows the server\'s auto-fix categories read-only, with no toggles that do nothing', () => {
    render(<TrustPolicy maxTrustLevel={4} effectiveTrustLevel={3} scannerCount={1} fixSummary={null} autofixPaused={false} supportedAutoFixCategories={['crashloop', 'image_pull']} />);
    const section = screen.getByTestId('autofix-categories');
    expect(section.textContent).toContain('Crashlooping pods');
    expect(section.textContent).toContain('Image pull errors');
    expect(section.textContent).not.toContain('Failed deployments');
    expect(section.querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryByText(/Requested category preferences/)).toBeNull();
  });

  it('says when the agent does not report its categories', () => {
    render(<TrustPolicy maxTrustLevel={4} effectiveTrustLevel={3} scannerCount={1} fixSummary={null} />);
    expect(screen.getByTestId('autofix-categories').textContent).toContain('Not reported by the agent.');
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

describe('the auto-fix kill switch while its state is unknown', () => {
  afterEach(cleanup);
  const renderWith = (props: Partial<React.ComponentProps<typeof TrustPolicy>>) =>
    render(<TrustPolicy maxTrustLevel={4} effectiveTrustLevel={2} scannerCount={1} fixSummary={null} {...props} />);

  it('while checking, shows a neutral status, not the red kill-switch button', () => {
    renderWith({ autofixPaused: undefined });
    expect(screen.getByRole('status').textContent).toContain('Checking monitor pause state…');
    expect(screen.queryByRole('button', { name: /Pause Auto-Fix|Checking/ })).toBeNull();
  });

  it.each([
    ['403', Object.assign(new Error('forbidden'), { status: 403 }), /Permission denied/],
    ['500', Object.assign(new Error('boom'), { status: 500 }), /status 500/],
  ])('a %s health read says it could not check, with the reason and Retry', (_l, err, reason) => {
    const retry = vi.fn().mockResolvedValue(undefined);
    renderWith({ autofixPaused: undefined, pauseStateError: err, onPauseChanged: retry });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not check whether auto-fix is paused');
    expect(alert.textContent).toMatch(reason);
    expect(screen.queryByText(/Pause Auto-Fix|Resume Auto-Fix/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('once known, offers the real switch', () => {
    renderWith({ autofixPaused: false });
    expect(screen.getByRole('button', { name: 'Pause Auto-Fix (Emergency Kill Switch)' })).toBeDefined();
  });
});

describe('the browser/server trust mismatch is a callout, with the kill switch state', () => {
  beforeEach(() => { useTrustStore.setState({ trustLevel: 1, autoFixCategories: [], communicationStyle: 'detailed' }); });
  afterEach(cleanup);
  const renderWith = (autofixPaused: boolean | undefined, pauseStateError?: Error) => render(
    <TrustPolicy maxTrustLevel={4} effectiveTrustLevel={3} scannerCount={27} fixSummary={null} autofixPaused={autofixPaused} pauseStateError={pauseStateError} />,
  );

  it('heads the card, before the kill switch, and says the switch is not engaged', () => {
    const { container } = renderWith(false);
    const note = screen.getByTestId('trust-mismatch');
    expect(note.getAttribute('role')).toBe('note');
    expect(note.textContent).toMatch(/The agent is running at .* \(3\), set on the server/);
    expect(note.textContent).toMatch(/This browser has .* \(1\) selected/);
    expect(screen.getByTestId('trust-mismatch-pause').textContent).toMatch(/not engaged/);
    const killSwitch = screen.getByRole('button', { name: /Emergency Kill Switch/ });
    // The callout comes first in the card.
    expect(note.compareDocumentPosition(killSwitch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-testid="trust-mismatch"]')).toBe(note);
  });

  it('says auto-fix is paused when it is, and unknown when the pause state could not be read', () => {
    renderWith(true);
    expect(screen.getByTestId('trust-mismatch-pause').textContent).toMatch(/auto-fix is paused/);
    cleanup();
    renderWith(undefined, new Error('503'));
    expect(screen.getByTestId('trust-mismatch-pause').textContent).toMatch(/unknown/);
  });
});
