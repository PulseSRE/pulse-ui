// @vitest-environment jsdom
/**
 * SLOs: the service is picked from the local cluster's Deployments (the agent
 * matches `deployment="<name>"` with no namespace, which the picker states),
 * and an SLO can be edited — re-registered under the same service and type.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, json } from '../../../__tests__/actionHarness';
import { SLOTab, deploymentNamespacesByName } from '../SLOTab';

const h = createHarness();
const SLO = { service: 'checkout', type: 'availability', target: 0.995, window_days: 28, description: 'checkout up', alert_level: 'ok', current_value: 0.999, error_budget_remaining: 0.8, burn_rate: 0.5 };

beforeEach(() => {
  h.setup();
  h.state.handler = (r) => {
    if (r.url.endsWith('/api/agent/slo') && r.method === 'GET') return json({ slos: [SLO], total: 1 });
    if (r.path === '/apis/apps/v1/deployments') return json({ items: [
      { metadata: { name: 'checkout', namespace: 'shop' } },
      { metadata: { name: 'web', namespace: 'shop' } },
      { metadata: { name: 'web', namespace: 'staging' } },
    ] });
    if (r.method === 'POST') return json({ status: 'registered' });
    return json({});
  };
});
afterEach(() => { cleanup(); h.teardown(); });

describe('SLO deployment picker', () => {
  it('groups deployments by name', () => {
    const m = deploymentNamespacesByName([{ metadata: { name: 'web', namespace: 'a' } }, { metadata: { name: 'web', namespace: 'b' } }]);
    expect(m.get('web')).toEqual(['a', 'b']);
  });

  it('picks a deployment and warns when its name exists in several namespaces', async () => {
    h.renderUi(<SLOTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Add SLO/ }));
    const picker = await screen.findByRole('combobox', { name: 'Deployment' });
    await waitFor(() => expect(within(picker).getAllByRole('option').length).toBe(3));
    fireEvent.change(picker, { target: { value: 'web' } });
    expect(screen.getByRole('note').textContent).toMatch(/2 namespaces have a Deployment named web \(shop, staging\).*measured together/);
    fireEvent.click(screen.getByRole('button', { name: 'Create SLO' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0].body).toMatchObject({ service: 'web', type: 'availability' });
  });
});

describe('Edit SLO', () => {
  it('prefills the form, keeps service and type fixed, and re-registers after confirmation', async () => {
    h.renderUi(<SLOTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit SLO checkout availability' }));
    expect(screen.getByText('Edit SLO — checkout (availability)')).toBeTruthy();
    const target = screen.getByPlaceholderText('99.9') as HTMLInputElement;
    expect(target.value).toBe('99.5');
    expect((screen.getByLabelText('Deployment') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(target, { target: { value: '99.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Replaces the availability SLO for checkout with target 99.9% over 28 days/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(h.writes()).toHaveLength(1));
    expect(h.writes()[0]).toMatchObject({ method: 'POST', url: '/api/agent/slo' });
    expect(h.writes()[0].body).toEqual({ service: 'checkout', type: 'availability', target: 0.999, window_days: 28, description: 'checkout up' });
  });

  it('keeps the form open and says the update failed', async () => {
    const base = h.state.handler;
    h.state.handler = (r) => (r.method === 'POST' ? json({ detail: 'window_days must be between 1 and 90' }, 422) : base(r));
    h.renderUi(<SLOTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit SLO checkout availability' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('The SLO was not updated')).toBeTruthy();
    expect(screen.getByText('Edit SLO — checkout (availability)')).toBeTruthy();
  });
});
