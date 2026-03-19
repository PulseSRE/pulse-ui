// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ addTab: vi.fn(), openCommandPalette: vi.fn() }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import WelcomeView from '../WelcomeView';

function renderView() {
  return render(<MemoryRouter><WelcomeView /></MemoryRouter>);
}

describe('WelcomeView', () => {
  afterEach(cleanup);

  it('renders ShiftOps title', () => {
    renderView();
    expect(screen.getByText('ShiftOps')).toBeDefined();
  });

  it('shows quick start actions', () => {
    renderView();
    expect(screen.getAllByText('Cluster Pulse').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Find Resources')).toBeDefined();
    expect(screen.getByText('Production Readiness')).toBeDefined();
  });

  it('shows page links', () => {
    renderView();
    expect(screen.getByText('Workloads')).toBeDefined();
    expect(screen.getByText('Networking')).toBeDefined();
    expect(screen.getByText('Compute')).toBeDefined();
    expect(screen.getByText('Storage')).toBeDefined();
    expect(screen.getByText('Builds')).toBeDefined();
    expect(screen.getByText('Administration')).toBeDefined();
  });

  it('shows keyboard shortcuts', () => {
    renderView();
    expect(screen.getByText(/Command Palette/)).toBeDefined();
    expect(screen.getByText(/Resource Browser/)).toBeDefined();
  });
});
