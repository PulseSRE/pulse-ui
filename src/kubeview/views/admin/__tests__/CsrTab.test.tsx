// @vitest-environment jsdom
/**
 * Certificate signing requests: approve, deny and bulk-approve send exactly
 * the approval-subresource PUT, to the cluster the dialog was opened on, and
 * failures stay visible in the dialog.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json, k8sStatus, REMOTE } from '../../../__tests__/actionHarness';
import { CsrTab, PendingCsrNotice } from '../CsrTab';

const h = createHarness();
const LIST = '/apis/certificates.k8s.io/v1/certificatesigningrequests';

function csr(name: string, opts: { signer?: string; user?: string; groups?: string[]; approved?: boolean } = {}) {
  return {
    apiVersion: 'certificates.k8s.io/v1',
    kind: 'CertificateSigningRequest',
    metadata: { name, uid: `uid-${name}`, resourceVersion: '42', creationTimestamp: new Date(Date.now() - 600000).toISOString() },
    spec: {
      signerName: opts.signer ?? 'kubernetes.io/kubelet-serving',
      username: opts.user ?? `system:node:${name}`,
      groups: opts.groups ?? ['system:nodes', 'system:authenticated'],
      usages: ['digital signature', 'server auth'],
      request: 'LS0t',
    },
    status: opts.approved ? { conditions: [{ type: 'Approved', status: 'True' }], certificate: 'Y2VydA==' } : {},
  };
}

const ITEMS = [
  csr('csr-node-a'),
  csr('csr-node-b'),
  csr('csr-other', { signer: 'kubernetes.io/kube-apiserver-client', user: 'alice', groups: ['system:authenticated'] }),
  csr('csr-done', { approved: true }),
];

beforeEach(() => {
  h.setup();
  h.state.handler = (r) => (r.method === 'GET' && r.path === LIST ? json({ items: ITEMS }) : json({}));
});
afterEach(() => { cleanup(); h.teardown(); });

const go = () => {};

describe('CsrTab', () => {
  it('lists pending requests with requester, signer and usages; approve PUTs an Approved condition to /approval', async () => {
    h.renderUi(<CsrTab go={go} />);
    const row = await screen.findByTestId('csr-csr-other');
    expect(within(row).getByText('alice')).toBeTruthy();
    expect(within(row).getByText('kubernetes.io/kube-apiserver-client')).toBeTruthy();
    expect(within(row).getByText('digital signature, server auth')).toBeTruthy();
    expect(screen.queryByTestId('csr-csr-done')).toBeNull(); // pending only by default

    fireEvent.click(within(row).getByRole('button', { name: 'Approve csr-other' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will issue a certificate to alice/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(h.writes()).toHaveLength(1));
    const put = h.writes()[0];
    expect(put.method).toBe('PUT');
    expect(put.path).toBe(`${LIST}/csr-other/approval`);
    expect(put.body.metadata.resourceVersion).toBe('42');
    expect(put.body.status.conditions).toEqual([expect.objectContaining({ type: 'Approved', status: 'True' })]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('deny PUTs a Denied condition', async () => {
    h.renderUi(<CsrTab go={go} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny csr-node-a' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0].body.status.conditions[0]).toMatchObject({ type: 'Denied', status: 'True' });
  });

  it('bulk approve names every kubelet-serving CSR it will approve and sends one PUT each — and no others', async () => {
    h.renderUi(<CsrTab go={go} />);
    fireEvent.click(await screen.findByRole('button', { name: /Approve 2 kubelet serving CSRs/ }));
    const list = within(await screen.findByRole('dialog')).getByRole('list', { name: 'Requests to approve' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'csr-node-a — system:node:csr-node-a',
      'csr-node-b — system:node:csr-node-b',
    ]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.writes()).toHaveLength(2));
    expect(h.writes().map((w) => w.path)).toEqual([`${LIST}/csr-node-a/approval`, `${LIST}/csr-node-b/approval`]);
  });

  it('a refused approval (403) stays in the dialog with the API message', async () => {
    h.state.handler = (r) => (r.method === 'GET' ? json({ items: ITEMS }) : k8sStatus(403, 'cannot approve certificate signing requests for signerName kubernetes.io/kube-apiserver-client'));
    h.renderUi(<CsrTab go={go} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve csr-other' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/cannot approve certificate signing requests/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('bulk approval reports each failure and how many succeeded', async () => {
    h.state.handler = (r) => {
      if (r.method === 'GET') return json({ items: ITEMS });
      return r.path.includes('csr-node-b') ? k8sStatus(409, 'the object has been modified') : json({});
    };
    h.renderUi(<CsrTab go={go} />);
    fireEvent.click(await screen.findByRole('button', { name: /Approve 2 kubelet serving CSRs/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('1 of 2 approved; 1 failed')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Failed approvals' })).getByText(/csr-node-b: .*modified/)).toBeTruthy();
  });

  it('refuses when the active cluster changed after the dialog opened, and sends nothing', async () => {
    h.renderUi(<CsrTab go={go} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve csr-other' }));
    await screen.findByRole('dialog');
    h.setActive(REMOTE);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/was not run: it was prepared on/)).toBeTruthy();
    expect(h.writes()).toHaveLength(0);
  });

  it('disables approve/deny without update permission on certificatesigningrequests/approval', async () => {
    h.state.denied.add('update certificatesigningrequests/approval');
    h.renderUi(<CsrTab go={go} />);
    await screen.findByTestId('csr-csr-other');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve csr-other' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Deny csr-other' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the list failed instead of "no pending requests", with a retry', async () => {
    h.state.handler = () => k8sStatus(403, 'certificatesigningrequests is forbidden');
    h.renderUi(<CsrTab go={go} />);
    expect(await screen.findByText('Certificate signing requests could not be loaded')).toBeTruthy();
    expect(screen.queryByText(/No pending certificate signing requests/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('PendingCsrNotice (Compute)', () => {
  it('shows the pending count and links to Admin › Certificate requests', async () => {
    const visited: string[] = [];
    h.renderUi(<PendingCsrNotice go={(p) => visited.push(p)} />);
    fireEvent.click(await screen.findByRole('button', { name: /3 certificate signing requests are pending approval/ }));
    expect(visited).toEqual(['/admin?tab=csrs']);
  });

  it('renders nothing when no CSR is pending', async () => {
    h.state.handler = () => json({ items: [csr('done', { approved: true })] });
    const { container } = h.renderUi(<PendingCsrNotice go={() => {}} />);
    await waitFor(() => expect(h.state.requests.length).toBeGreaterThan(0));
    expect(container.textContent).toBe('');
  });
});
