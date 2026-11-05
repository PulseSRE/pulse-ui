// @vitest-environment jsdom
/**
 * The Helm badge reads revision and status from the release's storage
 * Secrets' labels, listed metadata-only: no release record (and so no
 * values) is fetched for it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { createHarness, json } from '../../__tests__/actionHarness';
import { HelmOwnerBadge } from '../HelmOwnership';
import type { K8sResource } from '../../engine/renderers';

const h = createHarness();
beforeEach(() => {
  h.setup();
  h.state.handler = (r) => (r.path.includes('/secrets?labelSelector=')
    ? json({ kind: 'PartialObjectMetadataList', items: [6, 7].map((v) => ({ metadata: { name: `sh.helm.release.v1.checkout.v${v}`, labels: { owner: 'helm', name: 'checkout', version: String(v), status: v === 7 ? 'deployed' : 'superseded' } } })) })
    : undefined);
});
afterEach(() => { cleanup(); h.teardown(); });

it('shows the latest revision from labels, fetched metadata-only', async () => {
  const dep = { kind: 'Deployment', metadata: { name: 'checkout', namespace: 'shop', labels: { 'app.kubernetes.io/managed-by': 'Helm' }, annotations: { 'meta.helm.sh/release-name': 'checkout' } } } as unknown as K8sResource;
  h.renderUi(<HelmOwnerBadge resource={dep} />);
  expect((await screen.findByText(/Helm · checkout rev 7/))).toBeTruthy();
  const req = h.state.requests.find((r) => r.path.includes('/secrets?labelSelector='))!;
  expect(req.headers.Accept).toBe('application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1');
});

describe('no badge', () => {
  it('without the managed-by label and release annotation', () => {
    h.renderUi(<HelmOwnerBadge resource={{ kind: 'Deployment', metadata: { name: 'x', namespace: 'shop' } } as K8sResource} />);
    expect(screen.queryByTestId('helm-owner-badge')).toBeNull();
    expect(h.state.requests).toHaveLength(0);
  });
});
