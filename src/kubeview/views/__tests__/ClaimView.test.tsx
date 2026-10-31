// @vitest-environment jsdom
/** A rejected claim left the spinner running forever, with no way out. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const claimSharedView = vi.fn();
vi.mock('../../store/customViewStore', () => ({ useCustomViewStore: { getState: () => ({ claimSharedView }) } }));

import ClaimView from '../ClaimView';

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

  it('a rejected claim shows the error and a way back', async () => {
    claimSharedView.mockRejectedValue(new Error('503 Service Unavailable'));
    renderClaim();
    expect((await screen.findByRole('alert')).textContent).toContain('The dashboard could not be cloned: 503 Service Unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Views' }));
    expect(screen.getByTestId('where').textContent).toBe('/views');
  });
});
