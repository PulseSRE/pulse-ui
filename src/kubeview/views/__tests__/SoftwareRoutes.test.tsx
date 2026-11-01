// @vitest-environment jsdom
/**
 * The Software hub has its own route. Old /create/v1~pods?tab=… links land on
 * /software with their query; /create/<gvr> opens that kind's editor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { resourceRoutes } from '../../routes/resourceRoutes';
import { domainRoutes } from '../../routes/domainRoutes';
import { isKnownRoute } from '../../engine/routeTable';
import { NAV_ITEMS, PALETTE_SHORTCUTS } from '../../engine/navRegistry';

vi.mock('../CreateView', () => ({
  default: ({ gvrKey }: { gvrKey?: string }) => <div data-testid="create">{gvrKey === undefined ? 'hub' : `editor:${gvrKey}`}</div>,
}));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/">{resourceRoutes()}{domainRoutes()}</Route></Routes>
      <Where />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Software route', () => {
  it('/software is the hub, and is a known route', async () => {
    renderAt('/software');
    expect((await screen.findByTestId('create')).textContent).toBe('hub');
    expect(isKnownRoute('/software?tab=helm')).toBe(true);
  });

  it.each(['helm', 'templates', 'yaml', 'deploy', 'installed'])('/create/v1~pods?tab=%s redirects to /software?tab=%s', async (tab) => {
    renderAt(`/create/v1~pods?tab=${tab}&q=x`);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/software?tab=${tab}&q=x`));
    expect((await screen.findByTestId('create')).textContent).toBe('hub');
  });

  it('/create/<gvr> goes straight to that kind\'s editor, Pods included', async () => {
    renderAt('/create/apps~v1~deployments');
    expect((await screen.findByTestId('create')).textContent).toBe('editor:apps/v1/deployments');
    cleanup();
    renderAt('/create/v1~pods');
    expect((await screen.findByTestId('create')).textContent).toBe('editor:v1/pods');
    expect(screen.getByTestId('where').textContent).toBe('/create/v1~pods');
  });

  it('the sidebar and palette point at /software', () => {
    expect(NAV_ITEMS.find((n) => n.id === 'software')?.path).toBe('/software');
    expect(PALETTE_SHORTCUTS.find((n) => n.id === 'helm')?.path).toBe('/software?tab=helm');
  });
});
