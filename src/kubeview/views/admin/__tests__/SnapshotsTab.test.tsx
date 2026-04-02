// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

const mockAddToast = vi.fn();
vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector?: any) => {
      const state = { addToast: mockAddToast };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ addToast: mockAddToast }) },
  ),
}));

vi.mock('../../../components/feedback/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, onConfirm, onClose }: any) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock('../../../components/primitives/Panel', () => ({
  Panel: ({ title, children }: any) => <div data-testid="panel"><h3>{title}</h3>{children}</div>,
}));

vi.mock('../../../components/primitives/Card', () => ({
  Card: ({ children, className }: any) => <div data-testid="card" className={className}>{children}</div>,
}));

const mockCaptureSnapshot = vi.fn();
const mockLoadSnapshots = vi.fn();
const mockSaveSnapshots = vi.fn();
const mockCompareSnapshots = vi.fn();

vi.mock('../../../engine/snapshot', () => ({
  loadSnapshots: () => mockLoadSnapshots(),
  saveSnapshots: (snaps: any) => mockSaveSnapshots(snaps),
  captureSnapshot: (label: string) => mockCaptureSnapshot(label),
  compareSnapshots: (a: any, b: any) => mockCompareSnapshots(a, b),
}));

vi.mock('../../../engine/errorToast', () => ({
  showErrorToast: vi.fn(),
}));

import { SnapshotsTab } from '../SnapshotsTab';

function makeSnapshot(id: string, label: string) {
  return {
    id,
    label,
    timestamp: '2026-01-15T10:00:00Z',
    clusterVersion: '4.15.0',
    platform: 'AWS',
    controlPlaneTopology: 'HighlyAvailable',
    nodes: { count: 3, versions: ['v1.30.0'] },
    clusterOperators: [{ name: 'dns', version: '4.15.0', available: true, degraded: false }],
    crds: ['crd1.example.com', 'crd2.example.com'],
    storageClasses: ['gp3'],
    namespaceCount: 50,
  };
}

describe('SnapshotsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSnapshots.mockReturnValue([]);
  });
  afterEach(cleanup);

  it('shows empty state when no snapshots', () => {
    render(<SnapshotsTab />);
    expect(screen.getByText('No Snapshots Yet')).toBeDefined();
    expect(screen.getByText(/Capture a snapshot to record/)).toBeDefined();
  });

  it('shows Capture Snapshot and Import buttons', () => {
    render(<SnapshotsTab />);
    expect(screen.getByText('Capture Snapshot')).toBeDefined();
    expect(screen.getByText('Import')).toBeDefined();
  });

  it('renders saved snapshots list', () => {
    mockLoadSnapshots.mockReturnValue([makeSnapshot('s1', 'Snapshot 1'), makeSnapshot('s2', 'Snapshot 2')]);
    render(<SnapshotsTab />);
    expect(screen.getByText('Snapshot 1')).toBeDefined();
    expect(screen.getByText('Snapshot 2')).toBeDefined();
  });

  it('shows snapshot metadata', () => {
    mockLoadSnapshots.mockReturnValue([makeSnapshot('s1', 'Snap A')]);
    render(<SnapshotsTab />);
    expect(screen.getByText(/v4.15.0/)).toBeDefined();
    expect(screen.getByText(/3 nodes/)).toBeDefined();
    expect(screen.getByText(/2 CRDs/)).toBeDefined();
  });

  it('shows saved snapshots panel title with count', () => {
    mockLoadSnapshots.mockReturnValue([makeSnapshot('s1', 'Snap 1')]);
    render(<SnapshotsTab />);
    expect(screen.getByText('Saved Snapshots (1)')).toBeDefined();
  });

  it('captures snapshot on button click', async () => {
    const snap = makeSnapshot('s-new', 'Snapshot 1');
    mockCaptureSnapshot.mockResolvedValue(snap);
    render(<SnapshotsTab />);
    fireEvent.click(screen.getByText('Capture Snapshot'));
    // Wait for the async capture
    await vi.waitFor(() => {
      expect(mockCaptureSnapshot).toHaveBeenCalledWith('Snapshot 1');
    });
    expect(mockSaveSnapshots).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Snapshot captured' }));
  });

  it('shows delete confirmation dialog', () => {
    mockLoadSnapshots.mockReturnValue([makeSnapshot('s1', 'Snap 1')]);
    render(<SnapshotsTab />);
    // Find and click delete button (XCircle icon button)
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByTestId('confirm-dialog')).toBeDefined();
    expect(screen.getByText(/Delete snapshot "Snap 1"/)).toBeDefined();
  });

  it('renders comparison controls (Left/Right selects)', () => {
    mockLoadSnapshots.mockReturnValue([makeSnapshot('s1', 'Snap 1'), makeSnapshot('s2', 'Snap 2')]);
    render(<SnapshotsTab />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);
  });

  it('shows diff table when two snapshots are selected', () => {
    const snaps = [makeSnapshot('s1', 'Snap 1'), makeSnapshot('s2', 'Snap 2')];
    mockLoadSnapshots.mockReturnValue(snaps);
    mockCompareSnapshots.mockReturnValue([
      { category: 'Cluster', field: 'Version', left: '4.15.0', right: '4.16.0', changed: true },
      { category: 'Nodes', field: 'Count', left: '3', right: '3', changed: false },
    ]);
    render(<SnapshotsTab />);

    // Select left
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'left' } });
    fireEvent.change(selects[1], { target: { value: 'right' } });

    expect(screen.getByText(/Comparison/)).toBeDefined();
    expect(screen.getByText('Show only changes')).toBeDefined();
  });
});
