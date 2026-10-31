// @vitest-environment jsdom
/**
 * Helm releases are listed once — on the Helm Charts tab, with their actions —
 * each at its highest revision ("rev N", chart and version from the release
 * record). Installed only counts them and links there. Listing is
 * cluster-wide in all-namespaces mode, per-namespace otherwise.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useUIStore } from '../../../store/uiStore';
import { createHarness, json } from '../../../__tests__/actionHarness';
import { InstalledTab } from '../InstalledTab';
import { HelmReleases } from '../HelmReleases';
import { releaseSecret } from './helmTestUtils';

const h = createHarness();

const ITEMS = [
  releaseSecret('shop', 'team-a', 1, 'superseded', '15.0.0'),
  releaseSecret('shop', 'team-a', 3, 'deployed', '15.2.0', { replicaCount: 2 }),
  releaseSecret('shop', 'team-a', 2, 'superseded', '15.1.0'),
  releaseSecret('shop', 'team-b', 1, 'failed', '15.0.0'),
];

beforeEach(() => {
  h.setup();
  h.state.handler = (r) => (r.path.includes('labelSelector=owner%3Dhelm') ? json({ items: ITEMS }) : json({ items: [] }));
});
afterEach(() => { cleanup(); h.teardown(); });

describe('Helm releases list', () => {
  it('lists every namespace, one row per release at its highest revision, with chart version', async () => {
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    const rows = await screen.findAllByTestId('helm-release-shop');
    expect(h.state.requests.map((r) => r.path)).toContain('/api/v1/secrets?labelSelector=owner%3Dhelm');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('rev 3')).toBeTruthy();
    expect(within(rows[0]).getByText('chart nginx 15.2.0')).toBeTruthy();
    expect(within(rows[0]).getByText('deployed')).toBeTruthy();
    expect(within(rows[1]).getByText('team-b')).toBeTruthy();
    expect(within(rows[1]).getByText('failed')).toBeTruthy();
  });

  it('shows the values of the current revision', async () => {
    h.renderUi(<HelmReleases nsFilter="team-a" charts={[]} />);
    const [row] = await screen.findAllByTestId('helm-release-shop');
    expect(h.state.requests.map((r) => r.path)).toContain('/api/v1/namespaces/team-a/secrets?labelSelector=owner%3Dhelm');
    fireEvent.click(within(row).getByRole('button', { name: 'Values of shop' }));
    expect((await screen.findByLabelText('Release values')).textContent).toContain('replicaCount: 2');
  });

  it('says the list failed instead of "No Helm releases installed"', async () => {
    h.state.handler = () => new Response('{}', { status: 403, statusText: 'Forbidden' });
    h.renderUi(<HelmReleases nsFilter={undefined} charts={[]} />);
    expect(await screen.findByText('Helm releases could not be listed')).toBeTruthy();
    expect(screen.queryByText(/No Helm releases installed/)).toBeNull();
  });
});

describe('Installed tab', () => {
  it('counts releases and links to the one managed list instead of repeating it', async () => {
    useUIStore.setState({ selectedNamespace: '*' } as never);
    h.renderUi(<InstalledTab />);
    await waitFor(() => expect(screen.getByText('team-a/shop, team-b/shop')).toBeTruthy());
    expect(screen.queryByText('rev 3')).toBeNull();
    expect(screen.getByRole('button', { name: /Manage releases/ })).toBeTruthy();
  });
});
