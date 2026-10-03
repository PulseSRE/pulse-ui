// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- Mocks ----

const addToastMock = vi.fn();

vi.mock('../../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = { addToast: addToastMock };
    return selector(state);
  },
}));

const mockK8sList = vi.fn();
const mockK8sPatch = vi.fn();

vi.mock('../../../engine/query', () => ({
  k8sList: (...args: any[]) => mockK8sList(...args),
  k8sPatch: (...args: any[]) => mockK8sPatch(...args),
}));

vi.mock('../../../engine/dateUtils', () => ({
  timeAgo: (ts: string) => '2 hours ago',
}));

import { RollbackPanel } from '../RollbackPanel';

function makeDeployment(name = 'my-app', uid = 'deploy-uid-1') {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      namespace: 'default',
      uid,
      resourceVersion: '42',
      creationTimestamp: '2026-03-18T10:00:00Z',
    },
    spec: {
      selector: { matchLabels: { app: 'my-app' } },
      template: {
        metadata: { labels: { app: 'my-app' } },
        spec: {
          containers: [
            { name: 'app', image: 'nginx:1.25', resources: { limits: { cpu: '500m', memory: '256Mi' } } },
          ],
        },
      },
    },
    status: {},
  };
}

function makeReplicaSet(revision: number, image: string, ownerUid: string, replicas = 1) {
  return {
    apiVersion: 'apps/v1',
    kind: 'ReplicaSet',
    metadata: {
      name: `my-app-rs-${revision}`,
      namespace: 'default',
      uid: `rs-uid-${revision}`,
      creationTimestamp: `2026-03-${10 + revision}T10:00:00Z`,
      annotations: { 'deployment.kubernetes.io/revision': String(revision) },
      ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'my-app', uid: ownerUid }],
    },
    spec: {
      replicas,
      template: {
        metadata: { labels: { app: 'my-app' } },
        spec: {
          containers: [{ name: 'app', image, resources: { limits: { cpu: '500m', memory: '256Mi' } } }],
        },
      },
    },
    status: { replicas, readyReplicas: replicas },
  };
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('RollbackPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders nothing for non-Deployment resources', () => {
    const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'p', namespace: 'default' }, spec: {}, status: {} };
    const { container } = render(<RollbackPanel resource={pod as any} namespace="default" />, { wrapper: wrapper() });
    expect(container.innerHTML).toBe('');
  });

  it('shows revision history header for Deployments', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1', 2),
      makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0),
    ]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    expect(screen.getByText('Revision History')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('2 revisions')).toBeTruthy());
  });

  it('shows current badge on highest revision', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1', 2),
      makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0),
    ]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('Current')).toBeTruthy());
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
  });

  it('filters out ReplicaSets not owned by this Deployment', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(3, 'nginx:1.25', 'deploy-uid-1'),
      makeReplicaSet(1, 'nginx:1.23', 'other-uid'),
    ]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('1 revision')).toBeTruthy());
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.queryByText('#1')).toBeNull();
  });

  it('shows rollback button only for non-current revisions', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1', 2),
      makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0),
    ]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('#1')).toBeTruthy());
    const rollbackButtons = screen.getAllByText('Rollback');
    // Only one rollback button (for revision 1, not for current revision 2)
    expect(rollbackButtons).toHaveLength(1);
  });

  it('opens confirm dialog on rollback click and patches on confirm', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1', 2),
      makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0),
    ]);
    mockK8sPatch.mockResolvedValue({});

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('Rollback')).toBeTruthy());

    fireEvent.click(screen.getByText('Rollback'));

    // Confirm dialog should appear
    await waitFor(() => expect(screen.getByText(/Rollback to revision #1/)).toBeTruthy());

    // Click the confirm button in the dialog
    const confirmBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockK8sPatch).toHaveBeenCalledWith(
        '/apis/apps/v1/namespaces/default/deployments/my-app',
        [
          { op: 'test', path: '/metadata/resourceVersion', value: '42' },
          { op: 'replace', path: '/spec/template', value: expect.objectContaining({
            spec: expect.objectContaining({
              containers: [expect.objectContaining({ image: 'nginx:1.24' })],
            }),
          }) },
        ],
        'application/json-patch+json',
      );
    });

    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Rollback to revision 1 started' }),
    );
  });

  it('replaces the entire template, removing newly introduced scheduling and container fields', async () => {
    const deployment = makeDeployment();
    const currentTemplate = {
      ...deployment.spec.template,
      spec: {
        ...deployment.spec.template.spec,
        nodeSelector: { unavailable: 'true' },
        containers: [
          { ...deployment.spec.template.spec.containers[0], env: [{ name: 'BAD', value: 'true' }] },
          { name: 'bad-sidecar', image: 'broken:latest' },
        ],
      },
    };
    const target = makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0);
    Object.assign(target.spec.template.metadata.labels, { 'pod-template-hash': 'old-hash' });
    mockK8sList.mockResolvedValue([makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1'), target]);
    let restoredTemplate = currentTemplate as unknown;
    mockK8sPatch.mockImplementation(async (_path, patch, contentType) => {
      expect(contentType).toBe('application/json-patch+json');
      expect(patch[0]).toEqual({ op: 'test', path: '/metadata/resourceVersion', value: '42' });
      expect(patch[1].op).toBe('replace');
      expect(patch[1].path).toBe('/spec/template');
      restoredTemplate = patch[1].value;
      return {};
    });
    render(<RollbackPanel resource={{ ...deployment, spec: { ...deployment.spec, template: currentTemplate } } as any} namespace="default" />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByText('Rollback'));
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!);
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(restoredTemplate).toEqual({
      ...target.spec.template,
      metadata: { labels: { app: 'my-app' } },
    });
    expect(target.spec.template.metadata.labels).toHaveProperty('pod-template-hash', 'old-hash');
  });

  it('does not overwrite a deployment changed since the displayed version', async () => {
    mockK8sList.mockResolvedValue([makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1'), makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1')]);
    mockK8sPatch.mockImplementation(async (_path, patch) => {
      // Simulate Kubernetes rejecting an atomic JSON Patch test on a newer resource.
      if (patch[0].op === 'test' && patch[0].value !== '43') throw new Error('Resource version changed');
      return {};
    });
    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByText('Rollback'));
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!);
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', detail: 'Resource version changed' })));
    expect(addToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('shows error toast when rollback fails', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1', 2),
      makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0),
    ]);
    mockK8sPatch.mockRejectedValue(new Error('Forbidden'));

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('Rollback')).toBeTruthy());
    fireEvent.click(screen.getByText('Rollback'));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const confirmBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Rollback failed', detail: 'Forbidden' }),
      );
    });
  });

  it('shows diff details when expanding a non-current revision', async () => {
    mockK8sList.mockResolvedValue([
      makeReplicaSet(2, 'nginx:1.25', 'deploy-uid-1', 2),
      makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1', 0),
    ]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('#1')).toBeTruthy());

    // Click revision 1 row to expand
    fireEvent.click(screen.getByText('#1'));

    await waitFor(() => {
      expect(screen.getByText(/image.*nginx:1.25.*->.*nginx:1.24/)).toBeTruthy();
    });
  });

  it('shows loading state while fetching revisions', () => {
    mockK8sList.mockReturnValue(new Promise(() => {})); // never resolves

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    expect(screen.getByText('Loading revision history...')).toBeTruthy();
  });

  it('shows error when fetching revisions fails', async () => {
    mockK8sList.mockRejectedValue(new Error('Network error'));

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load revisions.*Network error/)).toBeTruthy();
    });
  });

  it('can collapse and expand the panel', async () => {
    mockK8sList.mockResolvedValue([makeReplicaSet(1, 'nginx:1.24', 'deploy-uid-1')]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => expect(screen.getByText('#1')).toBeTruthy());

    // Collapse
    fireEvent.click(screen.getByText('Revision History'));
    expect(screen.queryByText('#1')).toBeNull();

    // Expand again
    fireEvent.click(screen.getByText('Revision History'));
    await waitFor(() => expect(screen.getByText('#1')).toBeTruthy());
  });

  it('fetches ReplicaSets with correct label selector', async () => {
    mockK8sList.mockResolvedValue([]);

    render(<RollbackPanel resource={makeDeployment() as any} namespace="default" />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(mockK8sList).toHaveBeenCalledWith(
        expect.stringContaining('/apis/apps/v1/namespaces/default/replicasets?labelSelector='),
      );
      expect(mockK8sList).toHaveBeenCalledWith(
        expect.stringContaining('app%3Dmy-app'),
      );
    });
  });
});
