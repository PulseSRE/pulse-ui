// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { SubpageHeader } from '../SubpageHeader';
import { registerCluster, resetConnections } from '../../../engine/clusterConnection';

afterEach(() => { cleanup(); resetConnections(); });

describe('SubpageHeader', () => {
  it('renders one <h1> and the trail domain › kinds › name › subpage', () => {
    render(<SubpageHeader subpage="Logs" resource={{ gvrUrl: 'v1~pods', kind: 'Pod', namespace: 'shop', name: 'web-1' }} go={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Logs: web-1']);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Workloads' }).getAttribute('href')).toBe('/workloads');
    expect(within(nav).getByRole('link', { name: 'Pods' }).getAttribute('href')).toBe('/r/v1~pods?ns=shop');
    expect(within(nav).getByRole('link', { name: 'web-1' }).getAttribute('href')).toBe('/r/v1~pods/shop/web-1');
    expect(within(nav).getByText('Logs').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTitle('Namespace').textContent).toBe('shop');
  });

  it('back names its destination and links to the parent resource', () => {
    render(<SubpageHeader subpage="YAML" resource={{ gvrUrl: 'apps~v1~deployments', kind: 'Deployment', namespace: 'shop', name: 'web' }} go={vi.fn()} />);
    const back = screen.getByRole('link', { name: 'Back to deployment web' });
    expect(back.getAttribute('href')).toBe('/r/apps~v1~deployments/shop/web');
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });

  it('a plain click navigates in the app; modified and middle clicks are left to the browser', () => {
    const go = vi.fn();
    render(<SubpageHeader subpage="Metrics" resource={{ gvrUrl: 'v1~nodes', kind: 'Node', name: 'worker-1' }} go={go} />);
    const back = screen.getByRole('link', { name: 'Back to node worker-1' });
    expect(back.getAttribute('href')).toBe('/r/v1~nodes/_/worker-1');
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(fireEvent.click(back, init)).toBe(true);
    }
    expect(go).not.toHaveBeenCalled();
    expect(fireEvent.click(back)).toBe(false);
    expect(go).toHaveBeenCalledWith('/r/v1~nodes/_/worker-1', 'worker-1');
    fireEvent.click(screen.getByRole('link', { name: 'Compute' }));
    expect(go).toHaveBeenLastCalledWith('/compute', 'Compute');
  });

  it('without a name (Create) the parent is the kind\'s list', () => {
    const go = vi.fn();
    render(<SubpageHeader subpage="Create" resource={{ gvrUrl: 'networking.k8s.io~v1~networkpolicies', kind: 'NetworkPolicy' }} go={go} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create NetworkPolicy');
    const back = screen.getByRole('link', { name: 'Back to NetworkPolicies' });
    expect(back.getAttribute('href')).toBe('/r/networking.k8s.io~v1~networkpolicies');
    fireEvent.click(back);
    expect(go).toHaveBeenCalledWith('/r/networking.k8s.io~v1~networkpolicies', 'NetworkPolicies');
  });

  it('missing: the name is plain text and back goes to the list, not the missing object', () => {
    render(<SubpageHeader subpage="Logs" resource={{ gvrUrl: 'v1~pods', kind: 'Pod', namespace: 'shop', name: 'web-1' }} go={vi.fn()} missing />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).queryByRole('link', { name: 'web-1' })).toBeNull();
    expect(within(nav).getByText('web-1').tagName).toBe('SPAN');
    expect(screen.queryByRole('link', { name: 'Back to pod web-1' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Pods' }).getAttribute('href')).toBe('/r/v1~pods?ns=shop');
  });

  it('a kind with no domain page starts at its list', () => {
    render(<SubpageHeader subpage="YAML" resource={{ gvrUrl: 'v1~configmaps', kind: 'ConfigMap', namespace: 'shop', name: 'cfg' }} go={vi.fn()} />);
    const links = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('link').map((a) => a.textContent || a.getAttribute('aria-label'));
    expect(links).toEqual(['Back to ConfigMap cfg', 'ConfigMaps', 'cfg']);
  });

  it('names the cluster when more than one is connected, and only then', () => {
    const { unmount } = render(<SubpageHeader subpage="Logs" resource={{ gvrUrl: 'v1~pods', kind: 'Pod', namespace: 'a', name: 'p' }} go={vi.fn()} clusterId="local" />);
    expect(screen.queryByTitle('Cluster')).toBeNull();
    unmount();
    registerCluster({ id: 'east', name: 'prod-east', connectionType: 'acm-proxy', target: 'east' });
    render(<SubpageHeader subpage="Logs" resource={{ gvrUrl: 'v1~pods', kind: 'Pod', namespace: 'a', name: 'p' }} go={vi.fn()} clusterId="east" />);
    expect(screen.getByTitle('Cluster').textContent).toBe('prod-east');
  });
});
