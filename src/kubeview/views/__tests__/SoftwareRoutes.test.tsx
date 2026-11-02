// @vitest-environment jsdom
/**
 * The Software hub has its own route. Old /create/v1~pods?tab=… links land on
 * /software with their query; /create/<gvr> opens that kind's editor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { fireEvent } from '@testing-library/react';
import { resourceRoutes } from '../../routes/resourceRoutes';
import { domainRoutes } from '../../routes/domainRoutes';
import { isKnownRoute, createPathFor } from '../../engine/routeTable';
import { NAV_ITEMS, PALETTE_SHORTCUTS } from '../../engine/navRegistry';

const mounts: string[] = [];
vi.mock('../CreateView', () => ({
  default: function CreateViewMock({ gvrKey }: { gvrKey?: string }) {
    useEffect(() => { mounts.push(gvrKey ?? 'hub'); }, []);
    return <div data-testid="create">{gvrKey === undefined ? 'hub' : `editor:${gvrKey}`}</div>;
  },
}));

vi.mock('../OperatorCatalogView', () => ({ default: () => <div data-testid="catalog">operator catalog</div> }));

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go</button>;
}

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

  // The Software › Operators tab only redirected to /operators and is gone.
  // Old links to it still reach the catalog, with their search.
  it.each([
    ['/software?tab=operators', '/operators'],
    ['/software?tab=operators&q=cluster-logging', '/operators?q=cluster-logging'],
    ['/create/v1~pods?tab=operators&q=cluster logging', '/operators?q=cluster%20logging'],
  ])('old Operators-tab link %s lands on %s', async (from, to) => {
    renderAt(from);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(to));
    expect(await screen.findByTestId('catalog')).toBeDefined();
    expect(screen.queryByTestId('create')).toBeNull();
  });

  it('/create/<gvr> goes straight to that kind\'s editor, Pods included', async () => {
    renderAt('/create/apps~v1~deployments');
    expect((await screen.findByTestId('create')).textContent).toBe('editor:apps/v1/deployments');
    cleanup();
    renderAt('/create/v1~pods');
    expect((await screen.findByTestId('create')).textContent).toBe('editor:v1/pods');
    expect(screen.getByTestId('where').textContent).toBe('/create/v1~pods');
  });

  it("a list's Create opens that kind's editor, Pods included (not Import YAML)", async () => {
    expect(createPathFor('v1/pods')).toBe('/create/v1~pods');
    expect(createPathFor('apps/v1/deployments')).toBe('/create/apps~v1~deployments');
    renderAt(createPathFor('v1/pods'));
    expect((await screen.findByTestId('create')).textContent).toBe('editor:v1/pods');
    expect(screen.getByTestId('where').textContent).toBe('/create/v1~pods');
  });

  it('moving between two /create pages starts a fresh editor for the new kind', async () => {
    mounts.length = 0;
    render(
      <MemoryRouter initialEntries={['/create/apps~v1~deployments']}>
        <Routes><Route path="/">{resourceRoutes()}{domainRoutes()}</Route></Routes>
        <GoTo to="/create/v1~persistentvolumeclaims" />
      </MemoryRouter>,
    );
    expect((await screen.findByTestId('create')).textContent).toBe('editor:apps/v1/deployments');
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('create').textContent).toBe('editor:v1/persistentvolumeclaims'));
    expect(mounts).toEqual(['apps/v1/deployments', 'v1/persistentvolumeclaims']);
  });

  it('the sidebar and palette point at /software', () => {
    expect(NAV_ITEMS.find((n) => n.id === 'software')?.path).toBe('/software');
    expect(PALETTE_SHORTCUTS.find((n) => n.id === 'helm')?.path).toBe('/software?tab=helm');
  });
});
