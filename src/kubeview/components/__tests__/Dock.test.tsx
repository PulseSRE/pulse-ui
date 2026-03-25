// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const _mockUIState: Record<string, any> = {
  dockPanel: 'logs',
  dockHeight: 250,
  dockContext: null,
  setDockHeight: vi.fn(),
  openDock: vi.fn(),
  closeDock: vi.fn(),
};

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector(_mockUIState),
}));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import { Dock } from '../Dock';

function renderDock() {
  return render(<Dock />);
}

describe('Dock', () => {
  afterEach(() => {
    cleanup();
    _mockUIState.dockPanel = 'logs';
    _mockUIState.openDock.mockClear();
    _mockUIState.closeDock.mockClear();
  });

  it('renders panel toggle buttons for Logs, Terminal, Events', () => {
    renderDock();
    expect(screen.getAllByText('Logs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Terminal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Events').length).toBeGreaterThanOrEqual(1);
  });

  it('shows logs content when dockPanel is logs', () => {
    _mockUIState.dockPanel = 'logs';
    renderDock();
    expect(screen.getByText(/Navigate to a pod/)).toBeDefined();
  });

  it('shows terminal content when dockPanel is terminal', () => {
    _mockUIState.dockPanel = 'terminal';
    renderDock();
    expect(screen.getByText('$ _')).toBeDefined();
  });

  it('shows events content when dockPanel is events', () => {
    _mockUIState.dockPanel = 'events';
    renderDock();
    expect(screen.getByText('No events')).toBeDefined();
  });

  it('calls closeDock when close button is clicked', () => {
    renderDock();
    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(_mockUIState.closeDock).toHaveBeenCalled();
  });
});
