// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CommandPalette from '../components/CommandPalette';

const navigateMock = vi.fn();
let paletteOpen = true;
const closeMock = vi.fn();

vi.mock('@/store/useUIStore', () => ({
  useUIStore: () => ({
    commandPaletteOpen: paletteOpen,
    closeCommandPalette: closeMock,
    openCommandPalette: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

describe('Enhanced Command Palette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paletteOpen = true;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders when open', () => {
    renderPalette();
    expect(screen.getByPlaceholderText(/Search resources/)).toBeDefined();
  });

  it('does not render when closed', () => {
    paletteOpen = false;
    renderPalette();
    expect(screen.queryByPlaceholderText(/Search resources/)).toBeNull();
  });

  it('shows navigation items by default', () => {
    renderPalette();
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Pods')).toBeDefined();
    expect(screen.getByText('Alerts')).toBeDefined();
  });

  it('shows Pages section header', () => {
    renderPalette();
    expect(screen.getByText('Pages')).toBeDefined();
  });

  it('filters navigation items by query', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/Search resources/), { target: { value: 'deploy' } });
    expect(screen.getByText('Deployments')).toBeDefined();
    expect(screen.getByText('Deploy New')).toBeDefined();
  });

  it('shows help text with command examples', () => {
    renderPalette();
    expect(screen.getByText(/restart pod nginx/)).toBeDefined();
  });

  it('parses quick action: restart pod', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/Search resources/), { target: { value: 'restart pod nginx-abc' } });
    expect(screen.getByText('Quick Action')).toBeDefined();
    expect(screen.getByText(/restart/)).toBeDefined();
  });

  it('parses quick action: scale deployment', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/Search resources/), { target: { value: 'scale deploy api to 5' } });
    expect(screen.getByText('Quick Action')).toBeDefined();
    expect(screen.getByText(/scale/)).toBeDefined();
    expect(screen.getByText(/to 5/)).toBeDefined();
  });

  it('parses quick action: logs pod', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/Search resources/), { target: { value: 'logs pod worker-1' } });
    expect(screen.getByText('Quick Action')).toBeDefined();
  });

  it('closes on Escape', () => {
    renderPalette();
    fireEvent.keyDown(screen.getByPlaceholderText(/Search resources/), { key: 'Escape' });
    expect(closeMock).toHaveBeenCalled();
  });

  it('navigates on Enter for nav item', () => {
    renderPalette();
    fireEvent.keyDown(screen.getByPlaceholderText(/Search resources/), { key: 'Enter' });
    // First item in the list should navigate
    expect(navigateMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });

  it('saves and displays recent items', () => {
    renderPalette();
    // Select an item to add it to recents
    fireEvent.keyDown(screen.getByPlaceholderText(/Search resources/), { key: 'Enter' });
    cleanup();

    // Re-render, should show Recent section
    renderPalette();
    expect(screen.getByText('Recent')).toBeDefined();
  });

  it('keyboard navigation with ArrowDown/ArrowUp', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Should not throw, selection should work
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalled();
  });

  it('triggers resource search on 2+ character query', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [
          { metadata: { name: 'nginx-pod-1', namespace: 'default' } },
          { metadata: { name: 'nginx-pod-2', namespace: 'prod' } },
        ],
      }),
    });

    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/Search resources/), { target: { value: 'nginx' } });

    await waitFor(() => {
      expect(screen.getByText('Resources')).toBeDefined();
      expect(screen.getAllByText('nginx-pod-1').length).toBeGreaterThanOrEqual(1);
    }, { timeout: 2000 });
  });

  it('shows No results for unmatched query', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/Search resources/), { target: { value: 'xyznotexist123' } });
    expect(screen.getByText('No results found')).toBeDefined();
  });

  it('closes on overlay click', () => {
    renderPalette();
    const overlay = document.querySelector('.compass-command-palette-overlay');
    if (overlay) fireEvent.click(overlay);
    expect(closeMock).toHaveBeenCalled();
  });

  it('shows keyboard shortcuts for items that have them', () => {
    renderPalette();
    expect(screen.getByText('G D')).toBeDefined(); // Dashboard shortcut
    expect(screen.getByText('G P')).toBeDefined(); // Pods shortcut
  });
});
