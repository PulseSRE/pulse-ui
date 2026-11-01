// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../Tabs';

function Location() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderSynced(initial: string, onValueChange?: (v: string) => void) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Tabs defaultValue="alpha" urlSync={{ values: ['alpha', 'beta', 'gamma'] }} onValueChange={onValueChange}>
        <TabsList aria-label="Example">
          <TabsTrigger value="alpha">Alpha</TabsTrigger>
          <TabsTrigger value="beta">Beta</TabsTrigger>
          <TabsTrigger value="gamma">Gamma</TabsTrigger>
        </TabsList>
        <TabsContent value="alpha">alpha panel</TabsContent>
        <TabsContent value="beta">beta panel</TabsContent>
        <TabsContent value="gamma">gamma panel</TabsContent>
      </Tabs>
      <Location />
    </MemoryRouter>,
  );
}

describe('Tabs with URL sync', () => {
  afterEach(cleanup);

  it('exposes an accessible tablist with the active tab selected', () => {
    renderSynced('/page');
    expect(screen.getByRole('tablist', { name: 'Example' })).toBeTruthy();
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    expect(alpha.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('alpha panel');
  });

  it('opens the tab named in ?tab=', () => {
    renderSynced('/page?tab=gamma&ns=x');
    expect(screen.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('gamma panel');
  });

  it('falls back to the default for an unknown tab value', () => {
    renderSynced('/page?tab=nope');
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
  });

  it('writes the chosen tab to the URL, keeps other params, and drops it for the default', () => {
    const onChange = vi.fn();
    renderSynced('/page?ns=x', onChange);
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByTestId('loc').textContent).toBe('/page?ns=x&tab=beta');
    expect(screen.getByRole('tabpanel').textContent).toBe('beta panel');
    expect(onChange).toHaveBeenCalledWith('beta');

    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
    expect(screen.getByTestId('loc').textContent).toBe('/page?ns=x');
  });

  it('moves between tabs with the arrow keys', async () => {
    renderSynced('/page');
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    const beta = screen.getByRole('tab', { name: 'Beta' });
    await waitFor(() => expect(document.activeElement).toBe(beta));
    await waitFor(() => expect(beta.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('loc').textContent).toBe('/page?tab=beta');
  });
});

describe('Tabs without URL sync', () => {
  afterEach(cleanup);

  it('switches panels locally on click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">first</TabsContent>
        <TabsContent value="b">second</TabsContent>
      </Tabs>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('second');
  });
});
