// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockNavigate = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams],
  };
});

let mockPodQueryResult: any = { data: undefined, isLoading: false, error: null };
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => mockPodQueryResult,
  };
});

vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../components/logs/LogStream', () => ({
  default: ({ podName, containerName, previous }: any) => (
    <div data-testid="log-stream">LogStream: {podName} {containerName}{previous ? ' (previous)' : ''}</div>
  ),
}));
vi.mock('../../components/logs/MultiContainerLogs', () => ({
  default: ({ podName, containers, previous }: any) => (
    <div data-testid="multi-container-logs">MultiContainerLogs: {podName} ({containers.length} containers) [{containers.map((c: any) => `${c.name}:${c.type}`).join(',')}]{previous ? ' (previous)' : ''}</div>
  ),
}));
vi.mock('../../components/logs/MultiPodLogs', () => ({
  default: () => <div data-testid="multi-pod-logs">MultiPodLogs</div>,
}));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import LogsView from '../LogsView';

function renderView(props: { namespace: string; podName: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LogsView {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LogsView', () => {
  afterEach(() => {
    cleanup();
    mockPodQueryResult = { data: undefined, isLoading: false, error: null };
    mockSearchParams = new URLSearchParams();
    mockNavigate.mockReset();
  });

  it('renders heading with pod name and namespace', () => {
    mockPodQueryResult = {
      data: { spec: { containers: [{ name: 'app' }] }, status: { containerStatuses: [{ name: 'app', state: { running: {} } }] } },
      isLoading: false,
      error: null,
    };
    renderView({ namespace: 'default', podName: 'my-pod' });
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('my-pod')).toBeDefined();
    expect(screen.getByText('default')).toBeDefined();
  });

  it('shows LogStream for single-container pod', () => {
    mockPodQueryResult = {
      data: { spec: { containers: [{ name: 'app' }] }, status: { containerStatuses: [{ name: 'app', state: { running: {} } }] } },
      isLoading: false,
      error: null,
    };
    renderView({ namespace: 'default', podName: 'my-pod' });
    expect(screen.getByTestId('log-stream')).toBeDefined();
    expect(screen.getByText(/LogStream: my-pod app/)).toBeDefined();
  });

  it('shows MultiContainerLogs for multi-container pod', () => {
    mockPodQueryResult = {
      data: {
        spec: { containers: [{ name: 'app' }, { name: 'sidecar' }] },
        status: {
          containerStatuses: [
            { name: 'app', state: { running: {} } },
            { name: 'sidecar', state: { running: {} } },
          ],
        },
      },
      isLoading: false,
      error: null,
    };
    renderView({ namespace: 'default', podName: 'my-pod' });
    expect(screen.getByTestId('multi-container-logs')).toBeDefined();
    expect(screen.getByText(/2 containers/)).toBeDefined();
  });

  it('shows error message on fetch failure', () => {
    mockPodQueryResult = { data: undefined, isLoading: false, error: new Error('404 Not Found') };
    renderView({ namespace: 'default', podName: 'missing-pod' });
    expect(screen.getByText(/Could not load pod missing-pod/)).toBeDefined();
    expect(screen.getByText(/404 Not Found/)).toBeDefined();
  });

  it('the Previous instance toggle switches the stream to the previous instance', () => {
    mockPodQueryResult = {
      data: { spec: { containers: [{ name: 'app' }] }, status: { containerStatuses: [{ name: 'app', restartCount: 3, state: { running: {} } }] } },
      isLoading: false,
      error: null,
    };
    renderView({ namespace: 'default', podName: 'my-pod' });
    expect(screen.getByText('LogStream: my-pod app')).toBeDefined();
    fireEvent.click(screen.getByLabelText(/Previous instance \(3 restarts\)/));
    expect(screen.getByText('LogStream: my-pod app (previous)')).toBeDefined();
  });

  it('lists ephemeral (debug) containers alongside app and init containers', () => {
    mockPodQueryResult = {
      data: {
        spec: { containers: [{ name: 'app' }], initContainers: [{ name: 'setup' }], ephemeralContainers: [{ name: 'debug-x1' }] },
        status: { ephemeralContainerStatuses: [{ name: 'debug-x1', state: { running: {} } }] },
      },
      isLoading: false,
      error: null,
    };
    renderView({ namespace: 'default', podName: 'my-pod' });
    expect(screen.getByText(/\[app:container,setup:init,debug-x1:ephemeral\]/)).toBeDefined();
    fireEvent.click(screen.getByLabelText(/Previous instance/));
    expect(screen.getByText(/\(previous\)/)).toBeDefined();
  });

  it('shows loading skeleton while pod data loads', () => {
    mockPodQueryResult = { data: undefined, isLoading: true, error: null };
    const { container } = renderView({ namespace: 'default', podName: 'my-pod' });
    expect(container.querySelector('.kv-skeleton')).toBeDefined();
  });

  it('shows EmptyState with guidance when workload has no pods', () => {
    mockSearchParams = new URLSearchParams({ selector: 'app=nginx', kind: 'Deployment' });
    renderView({ namespace: 'default', podName: 'nginx' });
    expect(screen.getByText('No pods found')).toBeDefined();
    expect(screen.getByText(/scaled to zero/)).toBeDefined();
    expect(screen.getByText(/label selector/)).toBeDefined();
  });

  it('shows Back to workload button that navigates back', () => {
    mockSearchParams = new URLSearchParams({ selector: 'app=nginx', kind: 'Deployment' });
    renderView({ namespace: 'default', podName: 'nginx' });
    const backButton = screen.getByText('Back to workload');
    expect(backButton).toBeDefined();
    fireEvent.click(backButton);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
