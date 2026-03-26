// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import fs from 'fs';
import path from 'path';

const mockFleetState: Record<string, any> = {
  fleetMode: 'multi',
  clusters: [],
  activeClusterId: 'local',
  acmAvailable: false,
  acmDetecting: false,
  setActiveCluster: vi.fn(),
  refreshAllHealth: vi.fn(),
  detectACM: vi.fn(),
};

vi.mock('../../store/fleetStore', () => ({
  useFleetStore: (sel?: (s: any) => any) => sel ? sel(mockFleetState) : mockFleetState,
}));

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (sel: (s: any) => any) => sel({ addToast: vi.fn() }),
    { getState: () => ({}) },
  ),
}));

vi.mock('../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import FleetView from '../FleetView';

describe('FleetView navigation links', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../FleetView.tsx'), 'utf-8'
  );

  it('has Resources navigation link to fleet resource browser', () => {
    expect(source).toContain('/fleet/r/apps~v1~deployments');
    expect(source).toContain('Resources');
  });

  it('has Workloads navigation link', () => {
    expect(source).toContain('/fleet/workloads');
    expect(source).toContain('Workloads');
  });

  it('has Alerts navigation link', () => {
    expect(source).toContain('/fleet/alerts');
    expect(source).toContain('Alerts');
  });

  it('has Compare navigation link', () => {
    expect(source).toContain('/fleet/compare');
    expect(source).toContain('Compare');
  });

  it('imports navigation icons', () => {
    expect(source).toContain('Layers');
    expect(source).toContain('Bell');
    expect(source).toContain('GitCompare');
    expect(source).toContain('Box');
  });
});

describe('FleetView empty state', () => {
  it('shows "No clusters connected" EmptyState when clusters array is empty in multi-cluster mode', () => {
    mockFleetState.fleetMode = 'multi';
    mockFleetState.clusters = [];

    render(
      <MemoryRouter>
        <FleetView />
      </MemoryRouter>,
    );

    expect(screen.getByText('No clusters connected')).toBeDefined();
    expect(screen.getByText(/Fleet mode requires Red Hat Advanced Cluster Management/)).toBeDefined();
  });
});
