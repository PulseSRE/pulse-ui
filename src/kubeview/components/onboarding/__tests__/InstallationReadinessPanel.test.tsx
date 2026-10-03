// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstallationReadinessPanel } from '../InstallationReadinessPanel';
import { INSTALLATION_CHECK_IDS, parseInstallationReadiness, type InstallationReadiness } from '../../../engine/installationReadiness';
import { useFleetStore } from '../../../store/fleetStore';

function report(): InstallationReadiness {
  return { status: 'unknown', checked_at: '2026-10-03T06:00:00+00:00', scope: 'agent installation credentials', checks: INSTALLATION_CHECK_IDS.map(id => ({ id, status: id === 'provider_connectivity' ? 'unknown' : 'healthy', message: id === 'provider_connectivity' ? 'No nonbillable provider probe is available' : `${id} read succeeded`, remediation: id === 'provider_connectivity' ? 'Verify model access in an authorized end-to-end test' : '', source: 'bounded service-account probe' })), limitations: ['A list response does not prove workload recovery.'] };
}
let client: QueryClient;
beforeEach(() => { useFleetStore.setState({ activeClusterId: 'local' }); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
function mount() { return render(<QueryClientProvider client={client}><InstallationReadinessPanel /></QueryClientProvider>); }
function reply(data: unknown) { return { ok: true, status: 200, json: async () => data }; }

describe('installation readiness diagnostic contract', () => {
  it.each(INSTALLATION_CHECK_IDS)('rejects a report missing %s rather than implying installation success', missing => {
    const data = report(); data.checks = data.checks.filter(check => check.id !== missing);
    expect(() => parseInstallationReadiness(data)).toThrow('Readiness checks are missing');
  });
  it('rejects a healthy summary with unknown checks and duplicate diagnostic IDs', () => {
    expect(() => parseInstallationReadiness({ ...report(), status: 'healthy' })).toThrow('summary conflicts');
    const data = report(); data.checks.push(data.checks[0]);
    expect(() => parseInstallationReadiness(data)).toThrow('duplicate');
  });
  it.each([null, {}, { ...report(), checked_at: 'bad-date' }, { ...report(), limitations: 'none' }])('fails closed on malformed reports %#', data => {
    expect(() => parseInstallationReadiness(data)).toThrow();
  });
  it('accepts additional named checks without losing mandatory coverage', () => {
    const data = report(); data.checks.push({ id: 'optional_extension', status: 'unknown', message: 'Not probed', remediation: '', source: 'extension' });
    expect(parseInstallationReadiness(data).checks).toHaveLength(10);
  });
});

describe('installation readiness operator flow', () => {
  it('shows unknown model connectivity separately from successful database and permission checks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(report())); vi.stubGlobal('fetch', fetchMock); mount();
    expect(await screen.findByText('Readiness not established')).toBeDefined();
    expect(screen.getByText('Model provider connectivity')).toBeDefined();
    expect(screen.getByText('Unknown')).toBeDefined();
    expect(screen.getByText(/Next step: Verify model access/)).toBeDefined();
    expect(screen.getByText('Database')).toBeDefined();
    expect(screen.getByText(/not your browser identity/)).toBeDefined();
    expect(screen.getByText('What these checks do not prove')).toBeDefined();
    expect(screen.queryByText('Reported checks passed')).toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/agent/readiness', undefined);
  });
  it('exposes failed permission, provider and database remediation without changing permissions', async () => {
    const data = report(); data.status = 'degraded';
    for (const id of ['provider_configuration', 'database', 'kubernetes_logs']) {
      const check = data.checks.find(c => c.id === id)!; check.status = 'unhealthy'; check.message = `${id} unavailable`; check.remediation = `Configure ${id} and retry`;
    }
    const fetchMock = vi.fn().mockResolvedValue(reply(data)); vi.stubGlobal('fetch', fetchMock); mount();
    expect(await screen.findByText('Installation needs attention')).toBeDefined();
    expect(screen.getAllByText('Needs attention')).toHaveLength(3);
    expect(screen.getByText('Next step: Configure kubernetes_logs and retry')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 503])('treats HTTP %s as unknown, provides a retry and never reads server error bodies', async status => {
    const json = vi.fn(); const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json }); vi.stubGlobal('fetch', fetchMock); mount();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Readiness unknown.'));
    expect(screen.queryByText('Reported checks passed')).toBeNull(); expect(json).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(reply(report())); fireEvent.click(screen.getByText('Re-check installation'));
    expect(await screen.findByText('Readiness not established')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  it('reports invalid JSON without displaying the proxy error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('secret internal provider error body'); } })); mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not valid JSON');
    expect(alert.textContent).not.toContain('secret internal provider');
  });
  it('makes a failed refresh unknown and labels retained healthy results as previous, not current', async () => {
    const data = report(); data.status = 'healthy'; data.checks.forEach(check => { check.status = 'healthy'; });
    const fetchMock = vi.fn().mockResolvedValue(reply(data)); vi.stubGlobal('fetch', fetchMock); mount();
    expect(await screen.findByText('Reported checks passed')).toBeDefined();
    fetchMock.mockResolvedValue({ ok: false, status: 503 }); fireEvent.click(screen.getByText('Re-check installation'));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText('Reported checks passed')).toBeNull();
    expect(screen.getByText('Previous report — awaiting a successful current check')).toBeDefined();
    expect(screen.getAllByText('Check passed (previous report)')).toHaveLength(9);
  });
  it('states deployment cluster scope even while another fleet cluster is selected', async () => {
    useFleetStore.setState({ activeClusterId: 'remote' }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(report()))); mount();
    expect(await screen.findByText(/not the selected fleet cluster/)).toBeDefined();
    expect(await screen.findByText(/Scope: agent installation credentials/)).toBeDefined();
  });
  it('does not issue duplicate rechecks while a check is pending', async () => {
    let release!: (value: unknown) => void; const fetchMock = vi.fn(() => new Promise(resolve => { release = resolve; })); vi.stubGlobal('fetch', fetchMock); mount();
    expect(screen.getByRole('status').textContent).toContain('not established');
    const button = screen.getByRole('button', { name: 'Checking installation…' }); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1); release(reply(report())); await screen.findByText('Readiness not established');
  });
});
