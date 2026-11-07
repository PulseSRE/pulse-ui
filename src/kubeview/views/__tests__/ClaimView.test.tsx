// @vitest-environment jsdom
/** A rejected claim left the spinner running forever, with no way out. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const claimSharedView = vi.fn();
vi.mock('../../store/customViewStore', () => ({ useCustomViewStore: { getState: () => ({ claimSharedView }) } }));

import ClaimView from '../ClaimView';
import { AgentHttpError } from '../../engine/safeQuery';

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

function renderClaim() {
  return render(
    <MemoryRouter initialEntries={['/share/tok123']}>
      <Routes>
        <Route path="/share/:shareToken" element={<ClaimView />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); claimSharedView.mockReset(); });

describe('ClaimView', () => {
  it('opens the cloned view on success', async () => {
    claimSharedView.mockResolvedValue('v-9');
    renderClaim();
    expect((await screen.findByTestId('where')).textContent).toBe('/custom/v-9');
    expect(claimSharedView).toHaveBeenCalledWith('tok123');
  });

  it('a 503 is a load error with Retry and a link to Views, not "not found"', async () => {
    claimSharedView.mockRejectedValueOnce(new AgentHttpError(503, '503 Service Unavailable')).mockResolvedValueOnce('v-2');
    renderClaim();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The dashboard could not be cloned');
    expect(alert.textContent).toMatch(/status 503/);
    expect(screen.queryByTestId('not-found')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Views' }).getAttribute('href')).toBe('/views');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/custom/v-2');
  });

  it.each([403, 500])('a %i is a LoadError, not NotFound', async (status) => {
    claimSharedView.mockRejectedValue(new AgentHttpError(status, `failed ${status}`));
    renderClaim();
    expect((await screen.findByRole('alert')).textContent).toContain('The dashboard could not be cloned');
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  it.each([
    [404, /no longer exists/],
    [410, /expired/],
    [400, /not a valid share link/],
  ])('a %i is NotFound with a way out', async (status, reason) => {
    claimSharedView.mockRejectedValue(new AgentHttpError(status, 'x'));
    renderClaim();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Shared view not found' });
    expect(heading).toBeDefined();
    expect(screen.getByTestId('not-found').textContent).toMatch(reason);
    expect(screen.queryByRole('alert')).toBeNull();
    const views = screen.getByRole('link', { name: 'Go to Views' });
    expect(views.getAttribute('href')).toBe('/views');
    fireEvent.click(views);
    expect(screen.getByTestId('where').textContent).toBe('/views');
  });
});
