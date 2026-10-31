// @vitest-environment jsdom
/**
 * Links supplied by the agent: router navigation for internal paths, a new
 * tab with rel=noopener for external URLs, and plain text with a tooltip for
 * paths Pulse has no page for.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AgentLink } from '../AgentLink';
import { StaticAgentTable } from '../renderers/DataRenderer';
import { AgentMetricCard, AgentBarList, AgentResourceCounts } from '../renderers/VisualizationRenderer';
import { DynamicComponent } from '../DynamicComponent';

vi.mock('../../../engine/componentRegistry', () => ({
  fetchComponentRegistry: () => Promise.resolve({
    linked_stat: {
      description: 'stat with link', category: 'metrics', required_fields: ['value'], optional_fields: ['link'],
      supports_mutations: [], example: {}, is_container: false,
      layout: { type: 'stat_card', label: '{{title}}', value: '{{value}}', link: '{{link}}' },
    },
  }),
}));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderInApp(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="/start" element={ui} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AgentLink', () => {
  it('internal path → router link (no full reload)', () => {
    renderInApp(<AgentLink link="/r/v1~pods?ns=team-a">pods</AgentLink>);
    const a = screen.getByText('pods').closest('a')!;
    expect(a.getAttribute('href')).toBe('/r/v1~pods?ns=team-a');
    expect(a.getAttribute('target')).toBeNull();
    fireEvent.click(a);
    expect(screen.getByTestId('where').textContent).toBe('/r/v1~pods?ns=team-a');
  });

  it('external URL → new tab, noopener noreferrer', () => {
    renderInApp(<AgentLink link="https://docs.openshift.com/x">docs</AgentLink>);
    const a = screen.getByText('docs').closest('a')!;
    expect(a.getAttribute('href')).toBe('https://docs.openshift.com/x');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('unknown internal path → text with a tooltip, not a link', () => {
    renderInApp(<AgentLink link="/welcome">old</AgentLink>);
    const el = screen.getByText('old');
    expect(el.closest('a')).toBeNull();
    expect(el.getAttribute('title')).toContain('/welcome');
  });

  it('legacy /incidents links go to the Inbox activity tab', () => {
    renderInApp(<AgentLink link="/incidents?tab=actions">fix</AgentLink>);
    expect(screen.getByText('fix').closest('a')!.getAttribute('href')).toBe('/inbox?tab=activity');
  });
});

describe('DataRenderer cells', () => {
  const spec = {
    kind: 'data_table' as const,
    columns: [
      { id: 'name', header: 'Name' },
      { id: 'namespace', header: 'Namespace' },
      { id: 'node', header: 'Node' },
      { id: 'mount', header: 'Mount' },
      { id: 'logs', header: 'Logs' },
    ],
    rows: [{ name: 'web-1', namespace: 'shop', node: 'w1', mount: '/var/log', logs: '/logs/shop/web-1', _gvr: 'v1~pods' }],
  };

  it('links resource, namespace, node and logs cells through the router', () => {
    renderInApp(<StaticAgentTable spec={spec} />);
    expect(screen.getByText('shop').closest('a')!.getAttribute('href')).toBe('/project/shop');
    expect(screen.getByText('w1').closest('a')!.getAttribute('href')).toBe('/r/v1~nodes/_/w1');
    const logs = screen.getByText('View Logs').closest('a')!;
    expect(logs.getAttribute('href')).toBe('/logs/shop/web-1');
    fireEvent.click(logs);
    expect(screen.getByTestId('where').textContent).toBe('/logs/shop/web-1');
  });

  it('does not turn a value starting with "/" into a link unless the column is a link column', () => {
    renderInApp(<StaticAgentTable spec={spec} />);
    expect(screen.getByText('/var/log').closest('a')).toBeNull();
  });
});

describe('VisualizationRenderer links', () => {
  it('metric card follows an internal link through the router', () => {
    renderInApp(<AgentMetricCard spec={{ kind: 'metric_card', title: 'Pods', value: '3', link: '/r/v1~pods?ns=shop' }} />);
    fireEvent.click(screen.getByText('Pods').closest('button')!);
    expect(screen.getByTestId('where').textContent).toBe('/r/v1~pods?ns=shop');
  });

  it('metric card with an unknown link is not clickable and says why', () => {
    renderInApp(<AgentMetricCard spec={{ kind: 'metric_card', title: 'Old', value: '1', link: '/incidentz' }} />);
    expect(screen.getByText('Old').closest('button')).toBeNull();
    expect(screen.getByText('Old').closest('[title]')!.getAttribute('title')).toContain('/incidentz');
  });

  it('metric card opens an external link in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderInApp(<AgentMetricCard spec={{ kind: 'metric_card', title: 'Docs', value: '1', link: 'https://example.com/a' }} />);
    fireEvent.click(screen.getByText('Docs').closest('button')!);
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
  });

  it('bar list gvr items link to the resource list, not a hash URL', () => {
    renderInApp(<AgentBarList spec={{ kind: 'bar_list', items: [{ label: 'deployments', value: 3, gvr: 'apps~v1~deployments' }] }} />);
    expect(screen.getByText('deployments').closest('a')!.getAttribute('href')).toBe('/r/apps~v1~deployments');
  });

  it('resource_counts cards open the namespaced list (?ns= is honoured by TableView)', () => {
    renderInApp(<AgentResourceCounts spec={{ kind: 'resource_counts', namespace: 'shop', items: [{ resource: 'pods', count: 4, gvr: 'v1~pods' }] }} />);
    fireEvent.click(screen.getByText('pods').closest('button')!);
    expect(screen.getByTestId('where').textContent).toBe('/r/v1~pods?ns=shop');
  });
});

describe('DynamicComponent links', () => {
  it('follows a known link and refuses an unknown one', async () => {
    renderInApp(<DynamicComponent spec={{ kind: 'linked_stat', title: 'Nodes', value: '3', link: '/compute' }} />);
    await waitFor(() => expect(screen.getByText('Nodes')).toBeDefined());
    fireEvent.click(screen.getByText('Nodes').closest('button')!);
    expect(screen.getByTestId('where').textContent).toBe('/compute');
  });

  it('renders an unknown link as a non-clickable card with a tooltip', async () => {
    renderInApp(<DynamicComponent spec={{ kind: 'linked_stat', title: 'Gone', value: '1', link: '/welcome' }} />);
    await waitFor(() => expect(screen.getByText('Gone')).toBeDefined());
    expect(screen.getByText('Gone').closest('button')).toBeNull();
    expect(screen.getByText('Gone').closest('[title]')!.getAttribute('title')).toContain('/welcome');
  });
});
