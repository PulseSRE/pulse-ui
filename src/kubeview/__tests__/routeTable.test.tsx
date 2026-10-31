// @vitest-environment jsdom
/**
 * The route table and the mounted routes cannot drift: every <Route path>
 * rendered by routes/resourceRoutes.tsx and routes/domainRoutes.tsx is in the
 * table, and every table entry is mounted.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { resourceRoutes, domainRoutes } from '../routes';
import { RESOURCE_ROUTES, DOMAIN_ROUTES } from '../engine/routeTable';
import NotFoundView from '../views/NotFoundView';

function collectPaths(node: React.ReactNode): string[] {
  const out: string[] = [];
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { path?: string; children?: React.ReactNode };
    if (typeof props.path === 'string') out.push(props.path);
    if (props.children && child.type !== Route) out.push(...collectPaths(props.children));
    else if (child.type === React.Fragment) out.push(...collectPaths(props.children));
  });
  return out;
}

describe('route table ↔ mounted routes', () => {
  it('resourceRoutes mounts exactly RESOURCE_ROUTES', () => {
    expect(collectPaths(resourceRoutes()).sort()).toEqual(Object.values(RESOURCE_ROUTES).sort());
  });

  it('domainRoutes mounts exactly DOMAIN_ROUTES', () => {
    expect(collectPaths(domainRoutes()).sort()).toEqual(Object.values(DOMAIN_ROUTES).sort());
  });
});

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

describe('NotFoundView', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  function renderAt(entries: string[]) {
    return render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/pulse" element={<Where />} />
          <Route path="/inbox" element={<Where />} />
          <Route path="*" element={<NotFoundView />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('names the bad path and logs it instead of silently redirecting', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt(['/welcome?from=menu']);
    expect(screen.getByText('Page not found')).toBeDefined();
    expect(screen.getByText('/welcome?from=menu')).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/welcome?from=menu'));
  });

  it('"Go to Pulse" opens /pulse', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt(['/incidents']);
    fireEvent.click(screen.getByRole('button', { name: /Go to Pulse/ }));
    expect(screen.getByTestId('where').textContent).toBe('/pulse');
  });

  it('"Back" returns to the previous page', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt(['/inbox?tab=activity', '/nope']);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByTestId('where').textContent).toBe('/inbox?tab=activity');
  });
});
