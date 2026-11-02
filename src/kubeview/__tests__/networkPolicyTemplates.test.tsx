// @vitest-environment jsdom
/**
 * Wave 10: the default-deny NetworkPolicy template used to deny all ingress
 * with no allow-from-router rule, so creating it from Security or Networking
 * silently broke every Route in the namespace. It now ships the deny policy
 * together with an allow-from-openshift-ingress policy, and a separate egress
 * template keeps DNS working.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';

const goSpy = vi.fn();
vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => goSpy }));

import { renderCreateTemplate, createTemplateUrl } from '../engine/createTemplates';
import { parseManifest } from '../engine/manifest';
import { mockFetchRoutes, renderWithClient } from './helpers/honestStates';
import NetworkingView from '../views/NetworkingView';

type Policy = {
  kind: string;
  metadata: { name: string; namespace: string };
  spec: {
    podSelector: Record<string, unknown>;
    policyTypes: string[];
    ingress?: Array<{ from: Array<{ namespaceSelector?: { matchLabels: Record<string, string> } }> }>;
    egress?: Array<{ to: Array<{ namespaceSelector?: { matchLabels: Record<string, string> } }>; ports: Array<{ protocol: string; port: number }> }>;
  };
};

function policies(id: string, ns: string): Policy[] {
  const yaml = renderCreateTemplate(id, ns);
  expect(yaml, id).not.toBeNull();
  const { documents, errors } = parseManifest(yaml!, 'default');
  expect(errors).toEqual([]);
  return documents.map((d) => d.object as unknown as Policy);
}

describe('default-deny template', () => {
  it('denies ingress but lets the OpenShift router in, so Routes keep working', () => {
    // The allow policy comes first: documents are created in order, so a
    // failure after the first never leaves the namespace deny-only.
    const [allowRouter, deny, ...rest] = policies('default-deny', 'shop');
    expect(rest).toHaveLength(0);

    expect(deny.kind).toBe('NetworkPolicy');
    expect(deny.metadata).toEqual({ name: 'default-deny-ingress', namespace: 'shop' });
    expect(deny.spec.podSelector).toEqual({});
    expect(deny.spec.policyTypes).toEqual(['Ingress']);
    expect(deny.spec.ingress).toBeUndefined();

    expect(allowRouter.metadata).toEqual({ name: 'allow-from-openshift-ingress', namespace: 'shop' });
    expect(allowRouter.spec.podSelector).toEqual({});
    expect(allowRouter.spec.policyTypes).toEqual(['Ingress']);
    expect(allowRouter.spec.ingress).toEqual([
      { from: [
        { namespaceSelector: { matchLabels: { 'policy-group.network.openshift.io/ingress': '' } } },
        // The router with the HostNetwork endpoint publishing strategy.
        { namespaceSelector: { matchLabels: { 'policy-group.network.openshift.io/host-network': '' } } },
      ] },
    ]);
  });

  it('does not restrict egress, and says why the router rule is there', () => {
    const yaml = renderCreateTemplate('default-deny', 'shop')!;
    for (const p of policies('default-deny', 'shop')) expect(p.spec.policyTypes).not.toContain('Egress');
    expect(yaml).toMatch(/Allows the OpenShift router \(ingress controller\)/);
    expect(yaml).toMatch(/policy-group\.network\.openshift\.io\/ingress/);
    expect(yaml).toMatch(/HostNetwork endpoint publishing strategy/);
    expect(yaml).not.toMatch(/also when the router uses/);
  });

  it('refuses an invalid namespace', () => {
    expect(renderCreateTemplate('default-deny', 'Bad NS')).toBeNull();
    expect(renderCreateTemplate('default-deny-egress', 'Bad NS')).toBeNull();
  });
});

describe('default-deny egress template', () => {
  it('denies egress except DNS to openshift-dns on 53 and 5353, UDP and TCP', () => {
    const [p, ...rest] = policies('default-deny-egress', 'shop');
    expect(rest).toHaveLength(0);
    expect(p.metadata).toEqual({ name: 'default-deny-egress-allow-dns', namespace: 'shop' });
    expect(p.spec.podSelector).toEqual({});
    expect(p.spec.policyTypes).toEqual(['Egress']);
    expect(p.spec.egress).toHaveLength(1);
    expect(p.spec.egress![0].to).toEqual([{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'openshift-dns' } } }]);
    const ports = p.spec.egress![0].ports.map((x) => `${x.protocol}/${x.port}`).sort();
    expect(ports).toEqual(['TCP/53', 'TCP/5353', 'UDP/53', 'UDP/5353']);
  });

  it('has its own create link', () => {
    expect(createTemplateUrl('default-deny-egress', 'shop')).toBe('/create/networking.k8s.io~v1~networkpolicies?template=default-deny-egress&namespace=shop');
  });
});

describe('Networking audit "Create Policy" opens the reviewed templates', () => {
  beforeEach(() => { goSpy.mockReset(); vi.unstubAllGlobals(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const list = (items: unknown[]) => ({ body: { kind: 'List', items } });

  it('ingress: default-deny with the router allowed; egress: deny with DNS allowed', async () => {
    mockFetchRoutes({
      '/api/v1/services': list([{ metadata: { name: 'web', namespace: 'shop', uid: 's1' }, spec: { type: 'ClusterIP' } }]),
      '/apis/networking.k8s.io/v1/ingresses': list([]),
      '/apis/route.openshift.io/v1/routes': list([]),
      // "pay" has an ingress policy but no egress policy.
      '/apis/networking.k8s.io/v1/networkpolicies': list([{ metadata: { name: 'deny', namespace: 'pay', uid: 'n1' }, spec: { podSelector: {}, policyTypes: ['Ingress'] } }]),
      '/api/v1/endpoints': list([]),
      'ingresscontrollers': { status: 404, body: { code: 404 } },
    });
    renderWithClient(<NetworkingView />);

    const row = (title: string) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-audit-outcome]'));
      const r = rows.find((x) => x.querySelector('span.text-sm')?.textContent === title);
      if (!r) throw new Error(`no audit row ${title}`);
      return r;
    };

    await waitFor(() => expect(row('Network Policies').dataset.auditOutcome).toBe('fail'));
    fireEvent.click(within(row('Network Policies')).getAllByRole('button')[0]);
    fireEvent.click(await within(row('Network Policies')).findByRole('button', { name: /Create Policy/ }));
    expect(goSpy).toHaveBeenLastCalledWith('/create/networking.k8s.io~v1~networkpolicies?template=default-deny&namespace=shop', expect.any(String));

    await waitFor(() => expect(row('Egress Network Policies').dataset.auditOutcome).toBe('fail'));
    fireEvent.click(within(row('Egress Network Policies')).getAllByRole('button')[0]);
    fireEvent.click(await within(row('Egress Network Policies')).findByRole('button', { name: /Create Policy/ }));
    expect(goSpy).toHaveBeenLastCalledWith('/create/networking.k8s.io~v1~networkpolicies?template=default-deny-egress&namespace=pay', expect.any(String));
  });
});
