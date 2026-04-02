// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../../components/primitives/Panel', () => ({
  Panel: ({ title, children }: any) => <div data-testid="panel"><h3>{title}</h3>{children}</div>,
}));

vi.mock('../../../components/primitives/Card', () => ({
  Card: ({ children, className }: any) => <div data-testid="card" className={className}>{children}</div>,
}));

vi.mock('../../../components/primitives/MetricGrid', () => ({
  MetricGrid: ({ children }: any) => <div data-testid="metric-grid">{children}</div>,
}));

vi.mock('../../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../engine/formatting', () => ({
  parseResourceValue: (v: string) => {
    if (v.endsWith('Gi')) return parseFloat(v) * 1024 * 1024 * 1024;
    if (v.endsWith('m')) return parseFloat(v) / 1000;
    return parseFloat(v) || 0;
  },
  formatResourceValue: (v: string, key: string) => v,
}));

import { QuotasTab } from '../QuotasTab';

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderWithQuery(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
    </QueryClientProvider>
  );
}

function makeQuota(name: string, ns: string, hard: Record<string, string> = {}, used: Record<string, string> = {}) {
  return {
    metadata: { name, namespace: ns, uid: `q-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: { hard },
    status: { hard, used },
  };
}

function makeLimitRange(name: string, ns: string) {
  return {
    metadata: { name, namespace: ns, uid: `lr-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      limits: [
        {
          type: 'Container',
          default: { cpu: '500m', memory: '512Mi' },
          defaultRequest: { cpu: '100m', memory: '128Mi' },
          max: { cpu: '2', memory: '2Gi' },
          min: { cpu: '50m', memory: '64Mi' },
        },
      ],
    },
  };
}

describe('QuotasTab', () => {
  const go = vi.fn();
  afterEach(cleanup);

  it('shows summary cards with zero counts when empty', () => {
    renderWithQuery(<QuotasTab quotas={[]} limitRanges={[]} go={go} />);
    const allTexts = screen.getAllByText('0');
    expect(allTexts.length).toBeGreaterThan(0);
    expect(screen.getByText('Resource Quotas')).toBeDefined();
    expect(screen.getByText('Limit Ranges')).toBeDefined();
  });

  it('shows empty quota message and create button', () => {
    renderWithQuery(<QuotasTab quotas={[]} limitRanges={[]} go={go} />);
    expect(screen.getByText('No resource quotas configured')).toBeDefined();
    expect(screen.getByText('Create ResourceQuota')).toBeDefined();
  });

  it('shows empty limit range message and create button', () => {
    renderWithQuery(<QuotasTab quotas={[]} limitRanges={[]} go={go} />);
    expect(screen.getByText('No limit ranges configured')).toBeDefined();
    expect(screen.getByText('Create LimitRange')).toBeDefined();
  });

  it('renders quota with resource usage', () => {
    const quota = makeQuota('compute-quota', 'prod', { cpu: '4', memory: '8Gi' }, { cpu: '2', memory: '4Gi' });
    renderWithQuery(<QuotasTab quotas={[quota]} limitRanges={[]} go={go} />);
    expect(screen.getByText('compute-quota')).toBeDefined();
    // "prod" may appear multiple times (namespace badge + quota usage panel)
    expect(screen.getAllByText('prod').length).toBeGreaterThan(0);
    // "cpu" appears in both cluster quota usage and per-quota section
    expect(screen.getAllByText('cpu').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('memory').length).toBeGreaterThanOrEqual(1);
  });

  it('renders limit range with table', () => {
    const lr = makeLimitRange('core-limits', 'dev');
    renderWithQuery(<QuotasTab quotas={[]} limitRanges={[lr]} go={go} />);
    expect(screen.getByText('core-limits')).toBeDefined();
    expect(screen.getAllByText('dev').length).toBeGreaterThan(0);
    // "Container" may appear as type for multiple resource rows
    expect(screen.getAllByText('Container').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Default')).toBeDefined();
    expect(screen.getByText('Max')).toBeDefined();
    expect(screen.getByText('Min')).toBeDefined();
  });

  it('navigates on quota click', () => {
    const quota = makeQuota('my-quota', 'ns1', { cpu: '2' }, { cpu: '1' });
    renderWithQuery(<QuotasTab quotas={[quota]} limitRanges={[]} go={go} />);
    fireEvent.click(screen.getByText('my-quota'));
    expect(go).toHaveBeenCalledWith('/r/v1~resourcequotas/ns1/my-quota', 'my-quota');
  });

  it('navigates on limit range click', () => {
    const lr = makeLimitRange('my-lr', 'ns2');
    renderWithQuery(<QuotasTab quotas={[]} limitRanges={[lr]} go={go} />);
    fireEvent.click(screen.getByText('my-lr'));
    expect(go).toHaveBeenCalledWith('/r/v1~limitranges/ns2/my-lr', 'my-lr');
  });

  it('shows summary card counts', () => {
    const quota = makeQuota('q1', 'ns1', { cpu: '2' }, { cpu: '1' });
    const lr = makeLimitRange('lr1', 'ns2');
    renderWithQuery(<QuotasTab quotas={[quota]} limitRanges={[lr]} go={go} />);
    // Should show "1" for each count somewhere
    const ones = screen.getAllByText('1');
    expect(ones.length).toBeGreaterThanOrEqual(2);
  });

  it('shows cluster quota usage panel when quotas have resources', () => {
    const quota = makeQuota('q1', 'ns1', { cpu: '4' }, { cpu: '2' });
    renderWithQuery(<QuotasTab quotas={[quota]} limitRanges={[]} go={go} />);
    expect(screen.getByText('Cluster Quota Usage')).toBeDefined();
  });
});
