// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import type { TrackedError } from '../../../store/errorStore';

// --- Mocks ---

const mockResolveError = vi.fn();
const mockClearResolved = vi.fn();
let mockErrors: TrackedError[] = [];

vi.mock('../../../store/errorStore', () => ({
  useErrorStore: (selector?: any) => {
    const state = {
      errors: mockErrors,
      resolveError: mockResolveError,
      clearResolved: mockClearResolved,
    };
    return selector ? selector(state) : state;
  },
}));

const mockExpandAISidebar = vi.fn();
const mockSetAISidebarMode = vi.fn();
vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector?: any) => {
      const state = { expandAISidebar: mockExpandAISidebar, setAISidebarMode: mockSetAISidebarMode };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ expandAISidebar: mockExpandAISidebar, setAISidebarMode: mockSetAISidebarMode }) },
  ),
}));

const mockConnectAndSend = vi.fn();
vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: any) => {
      const state = { connectAndSend: mockConnectAndSend };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ connectAndSend: mockConnectAndSend }) },
  ),
}));

import { ErrorsTab } from '../ErrorsTab';

// --- Fixtures ---

function makeError(overrides: Partial<TrackedError> = {}): TrackedError {
  return {
    id: overrides.id ?? 'err-1',
    timestamp: overrides.timestamp ?? Date.now(),
    category: overrides.category ?? 'permission',
    message: overrides.message ?? 'forbidden: User cannot list pods',
    userMessage: overrides.userMessage ?? "You don't have permission to list pods",
    statusCode: overrides.statusCode ?? 403,
    operation: overrides.operation ?? 'list',
    resourceKind: overrides.resourceKind ?? 'Pod',
    resourceName: overrides.resourceName,
    namespace: overrides.namespace ?? 'default',
    suggestions: overrides.suggestions ?? ['Check your role bindings'],
    resolved: overrides.resolved ?? false,
    resolvedAt: overrides.resolvedAt,
    userAction: overrides.userAction,
  };
}

describe('ErrorsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockErrors = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state when no errors exist', () => {
    render(<ErrorsTab />);
    expect(screen.getByText('No errors tracked')).toBeDefined();
    expect(screen.getByText('Errors from K8s API operations will appear here')).toBeDefined();
  });

  it('renders error list when errors exist', () => {
    mockErrors = [makeError()];
    render(<ErrorsTab />);
    expect(screen.getByText("You don't have permission to list pods")).toBeDefined();
    expect(screen.getByText('Permission')).toBeDefined();
  });

  it('shows filter buttons with counts', () => {
    mockErrors = [
      makeError({ id: 'e1', category: 'permission' }),
      makeError({ id: 'e2', category: 'permission' }),
      makeError({ id: 'e3', category: 'server', userMessage: 'Server error', statusCode: 500 }),
    ];
    render(<ErrorsTab />);

    expect(screen.getByText('All (3)')).toBeDefined();
    expect(screen.getByText('Unresolved (3)')).toBeDefined();
    expect(screen.getByText('Permission (2)')).toBeDefined();
    expect(screen.getByText('Server (1)')).toBeDefined();
  });

  it('filters by category when filter button is clicked', () => {
    mockErrors = [
      makeError({ id: 'e1', category: 'permission', userMessage: 'Perm error' }),
      makeError({ id: 'e2', category: 'server', userMessage: 'Server error', statusCode: 500 }),
    ];
    render(<ErrorsTab />);

    fireEvent.click(screen.getByText('Server (1)'));
    expect(screen.getByText('Server error')).toBeDefined();
    expect(screen.queryByText('Perm error')).toBeNull();
  });

  it('filters to unresolved errors only', () => {
    mockErrors = [
      makeError({ id: 'e1', resolved: false, userMessage: 'Active error' }),
      makeError({ id: 'e2', resolved: true, userMessage: 'Fixed error' }),
    ];
    render(<ErrorsTab />);

    fireEvent.click(screen.getByText('Unresolved (1)'));
    expect(screen.getByText('Active error')).toBeDefined();
    expect(screen.queryByText('Fixed error')).toBeNull();
  });

  it('shows status code when > 0', () => {
    mockErrors = [makeError({ statusCode: 403 })];
    render(<ErrorsTab />);
    expect(screen.getByText('403')).toBeDefined();
  });

  it('hides status code when 0', () => {
    mockErrors = [makeError({ statusCode: 0 })];
    render(<ErrorsTab />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows resource details when available', () => {
    mockErrors = [makeError({ operation: 'list', resourceKind: 'Pod', resourceName: 'nginx', namespace: 'production' })];
    render(<ErrorsTab />);
    expect(screen.getByText('list Pod/nginx in production')).toBeDefined();
  });

  it('shows suggestions as bullet list', () => {
    mockErrors = [makeError({ suggestions: ['Try again', 'Contact admin'] })];
    render(<ErrorsTab />);
    expect(screen.getByText(/Try again/)).toBeDefined();
    expect(screen.getByText(/Contact admin/)).toBeDefined();
  });

  it('calls resolveError when Resolve button is clicked', () => {
    mockErrors = [makeError({ id: 'err-42' })];
    render(<ErrorsTab />);

    fireEvent.click(screen.getByText('Resolve'));
    expect(mockResolveError).toHaveBeenCalledWith('err-42', 'dismissed');
  });

  it('opens agent dock and sends message when Ask AI is clicked', () => {
    mockErrors = [makeError({ userMessage: 'Cannot list pods', message: 'forbidden: cannot list pods' })];
    render(<ErrorsTab />);

    fireEvent.click(screen.getByText('Ask AI'));
    expect(mockExpandAISidebar).toHaveBeenCalled();
    // askPulse forwards an optional resource context; none applies here.
    expect(mockConnectAndSend).toHaveBeenCalledWith(
      expect.stringContaining('Cannot list pods'),
      undefined,
    );
  });

  it('shows Clear Resolved button only when resolved errors exist', () => {
    mockErrors = [makeError({ resolved: false })];
    render(<ErrorsTab />);
    expect(screen.queryByText('Clear Resolved')).toBeNull();
  });

  it('shows Clear Resolved button when resolved errors exist and calls clearResolved', () => {
    mockErrors = [makeError({ resolved: true })];
    render(<ErrorsTab />);

    const btn = screen.getByText('Clear Resolved');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(mockClearResolved).toHaveBeenCalled();
  });

  it('does not show Resolve / Ask AI buttons for resolved errors', () => {
    mockErrors = [makeError({ resolved: true })];
    render(<ErrorsTab />);

    expect(screen.queryByText('Resolve')).toBeNull();
    expect(screen.queryByText('Ask AI')).toBeNull();
  });

  it('shows detailed message when it differs from userMessage', () => {
    mockErrors = [makeError({ userMessage: 'Short', message: 'Detailed technical info' })];
    render(<ErrorsTab />);
    expect(screen.getByText('Detailed technical info')).toBeDefined();
  });

  it('hides detailed message when same as userMessage', () => {
    mockErrors = [makeError({ userMessage: 'Same message', message: 'Same message' })];
    render(<ErrorsTab />);
    // Only one instance of the text should exist (in the heading)
    const matches = screen.getAllByText('Same message');
    expect(matches.length).toBe(1);
  });
});
