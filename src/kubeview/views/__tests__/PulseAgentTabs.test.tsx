// @vitest-environment jsdom
/**
 * Pulse Agent tab routing with the panels stubbed: every `?tab=` id lands on
 * its tab, the session's last tab is reopened, and a `?drawer=` link opens
 * Overview rather than the remembered tab.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { panel } = vi.hoisted(() => ({
  panel: (name: string) => ({ [name]: () => <div data-testid="panel">{name}</div> }),
}));
vi.mock('../pulse-agent/OverviewTab', () => panel('OverviewTab'));
vi.mock('../toolbox/CatalogTab', () => panel('CatalogTab'));
vi.mock('../toolbox/SkillsTab', () => panel('SkillsTab'));
vi.mock('../toolbox/PlansTab', () => panel('PlansTab'));
vi.mock('../toolbox/RunsTab', () => panel('RunsTab'));
vi.mock('../toolbox/ConnectionsTab', () => panel('ConnectionsTab'));
vi.mock('../toolbox/ComponentsTab', () => panel('ComponentsTab'));
vi.mock('../toolbox/UsageTab', () => panel('UsageTab'));
vi.mock('../toolbox/AnalyticsTab', () => panel('AnalyticsTab'));
vi.mock('../MemoryView', () => ({ default: () => <div data-testid="panel">MemoryView</div> }));

import PulseAgentView from '../PulseAgentView';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><PulseAgentView /><Where /></MemoryRouter>);
}

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('Pulse Agent tabs', () => {
  const tabs: Array<[string, string, string]> = [
    ['overview', 'Overview', 'OverviewTab'], ['runs', 'Runs', 'RunsTab'], ['skills', 'Skills', 'SkillsTab'],
    ['plans', 'Plans', 'PlansTab'], ['tools', 'Tools', 'CatalogTab'], ['mcp', 'MCP', 'ConnectionsTab'],
    ['components', 'Components', 'ComponentsTab'], ['usage', 'Usage', 'UsageTab'], ['analytics', 'Analytics', 'AnalyticsTab'],
    ['memory', 'Memory', 'MemoryView'],
  ];

  it.each(tabs)('?tab=%s opens the %s tab and its panel', async (id, label, panelName) => {
    renderAt(`/agent?tab=${id}`);
    expect(screen.getByRole('tab', { name: label }).getAttribute('aria-selected')).toBe('true');
    expect((await screen.findByTestId('panel')).textContent).toBe(panelName);
  });

  it('an unknown ?tab= value falls back to Overview', () => {
    renderAt('/agent?tab=nonsense');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('reopens the session\'s last tab when the URL names none, writing it to the URL', async () => {
    sessionStorage.setItem('agent-tab', 'mcp');
    renderAt('/agent');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'MCP' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('where').textContent).toBe('/agent?tab=mcp');
  });

  it('a ?drawer= link opens Overview, not the tab remembered from this session', async () => {
    sessionStorage.setItem('agent-tab', 'usage');
    renderAt('/agent?drawer=scanners');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('where').textContent).toBe('/agent?drawer=scanners');
  });
});
