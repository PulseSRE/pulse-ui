// @vitest-environment jsdom
/**
 * Fleet Compare, Compliance's "Configuration Drift" table and the Drift
 * Detector were three pages checking overlapping things. They are now one
 * Compare & Drift page with two modes; the old routes still land on it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../../engine/snapshot', async (orig) => ({ ...(await orig<object>()), captureSnapshot: vi.fn() }));

import { domainRoutes } from '../../../routes';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{domainRoutes()}</Routes>
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Compare & Drift', () => {
  it('/fleet/drift lands on Compare & Drift in "One resource" mode', async () => {
    renderAt('/fleet/drift');
    expect(await screen.findByRole('heading', { name: 'Compare & Drift' })).toBeDefined();
    expect(screen.getByTestId('where').textContent).toBe('/fleet/compare?mode=resource');
    expect(screen.getByRole('radio', { name: 'One resource' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Resource type')).toBeDefined();
  });

  it('/fleet/compare opens the cluster-configuration preset and can switch modes', async () => {
    renderAt('/fleet/compare');
    expect(await screen.findByRole('heading', { name: 'Compare & Drift' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Cluster configuration' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Cross-Cluster Comparison')).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'One resource' }));
    expect(screen.getByTestId('where').textContent).toBe('/fleet/compare?mode=resource');
    expect(screen.getByLabelText('Resource type')).toBeDefined();
  });

  it('has the fleet tab bar with a way back to the overview', async () => {
    renderAt('/fleet/compare');
    const nav = await screen.findByRole('navigation', { name: 'Fleet pages' });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Compare & Drift');
    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/fleet'));
  });
});

describe('Fleet Compliance', () => {
  it('no longer repeats the configuration-drift table; it links to Compare & Drift', async () => {
    const conn = await import('../../../engine/clusterConnection');
    vi.spyOn(conn, 'getAllConnections').mockReturnValue([
      { id: 'a', name: 'prod-a', status: 'connected' },
      { id: 'b', name: 'prod-b', status: 'connected' },
    ] as never);
    const q = await import('../../../engine/query');
    vi.spyOn(q, 'k8sGet').mockRejectedValue(new Error('403'));
    vi.spyOn(q, 'k8sList').mockResolvedValue([]);
    renderAt('/fleet/compliance');
    expect(await screen.findByRole('heading', { name: /Fleet Compliance/ })).toBeDefined();
    expect(screen.queryByText('Configuration Drift Detection')).toBeNull();
    expect(screen.queryByText('Ingress Domain')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open Compare & Drift/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/fleet/compare'));
    vi.restoreAllMocks();
  });
});
