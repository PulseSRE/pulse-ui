// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));
vi.mock('../../engine/gvr', () => ({ K8S_BASE: '' }));

import PodTerminal from '../PodTerminal';
import { registerCluster, unregisterCluster } from '../../engine/clusterConnection';
import { terminalTargets, defaultTerminalTarget } from '../../engine/terminalTargets';

const defaultProps = {
  namespace: 'default',
  podName: 'nginx-abc-xyz',
  containerName: 'nginx',
  onClose: vi.fn(),
};

function renderTerminal(props: Partial<typeof defaultProps> = {}) {
  return render(<PodTerminal {...defaultProps} {...props} />);
}

describe('PodTerminal', () => {
  afterEach(() => {
    cleanup();
    defaultProps.onClose.mockClear();
  });

  it('renders container name and pod name in header', () => {
    renderTerminal();
    expect(screen.getByText('nginx')).toBeDefined();
    expect(screen.getByText('nginx-abc-xyz')).toBeDefined();
    expect(screen.getByText('default')).toBeDefined();
  });

  it('shows dollar-sign prompt and command input', () => {
    renderTerminal();
    expect(screen.getByText('$')).toBeDefined();
    expect(screen.getByPlaceholderText('Enter command...')).toBeDefined();
  });

  it('displays initial system lines with container info', () => {
    renderTerminal();
    expect(screen.getByText('default/nginx-abc-xyz')).toBeDefined();
    expect(screen.getByText('container: nginx')).toBeDefined();
  });

  it('shows node-specific suggestions when isNode is true', () => {
    renderTerminal({ isNode: true });
    expect(screen.getByText(/cat \/etc\/os-release/)).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    renderTerminal();
    // There are multiple "Close" titled buttons; use the last one (the X button)
    const closeBtns = screen.getAllByTitle('Close');
    fireEvent.click(closeBtns[closeBtns.length - 1]);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders copy and clear buttons', () => {
    renderTerminal();
    expect(screen.getByTitle('Copy output')).toBeDefined();
    expect(screen.getByTitle('Clear (Ctrl+L)')).toBeDefined();
  });
});

class FakeSocket {
  static urls: string[] = [];
  binaryType = '';
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { FakeSocket.urls.push(url); setTimeout(() => this.onclose?.(), 0); }
  close() {}
}

async function run(cmd: string) {
  const input = screen.getByPlaceholderText('Enter command...');
  fireEvent.change(input, { target: { value: cmd } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await new Promise((r) => setTimeout(r, 5));
}

describe('PodTerminal container choice and cluster', () => {
  afterEach(() => { cleanup(); FakeSocket.urls = []; vi.unstubAllGlobals(); });

  const containers = [
    { name: 'oauth-proxy', kind: 'container' as const, running: true },
    { name: 'app', kind: 'container' as const, running: true },
    { name: 'debug-x1', kind: 'ephemeral' as const, running: false },
  ];

  it('lets you switch containers, and runs commands in the one chosen', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    render(<PodTerminal {...defaultProps} containerName="app" containers={containers} />);
    const picker = screen.getByLabelText('Container') as HTMLSelectElement;
    expect(picker.value).toBe('app');
    expect(screen.getByText('debug-x1 (debug) (not running)')).toBeDefined();

    await run('ls');
    expect(FakeSocket.urls[0]).toContain('container=app');

    fireEvent.change(picker, { target: { value: 'oauth-proxy' } });
    await run('ls');
    expect(FakeSocket.urls[1]).toContain('container=oauth-proxy');
  });

  // Regression: commands went to whichever cluster was active when they ran,
  // not the cluster the pod was opened on.
  it('sends commands to the pod\'s own cluster', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    registerCluster({ id: 'east', name: 'East', connectionType: 'acm-proxy', target: 'east' });
    try {
      render(<PodTerminal {...defaultProps} clusterId="east" />);
      await run('whoami');
      expect(FakeSocket.urls[0]).toContain(encodeURIComponent('east'));
      expect(FakeSocket.urls[0]).toContain('/proxy/api/v1/namespaces/default/pods/nginx-abc-xyz/exec');
    } finally {
      unregisterCluster('east');
    }
  });

  it('refuses to run when the pod\'s cluster is gone, instead of using another', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    render(<PodTerminal {...defaultProps} clusterId="removed" />);
    await run('whoami');
    expect(FakeSocket.urls).toEqual([]);
    expect(screen.getByText(/no longer connected/)).toBeDefined();
  });
});

describe('terminalTargets', () => {
  const pod = {
    spec: { containers: [{ name: 'oauth-proxy' }, { name: 'app' }], ephemeralContainers: [{ name: 'debug-1' }] },
    status: {
      containerStatuses: [{ name: 'oauth-proxy', state: { running: {} } }, { name: 'app', state: { running: {} } }],
      ephemeralContainerStatuses: [{ name: 'debug-1', state: { running: {} } }],
    },
  };

  it('lists regular and ephemeral containers with their running state', () => {
    expect(terminalTargets(pod)).toEqual([
      { name: 'oauth-proxy', kind: 'container', running: true },
      { name: 'app', kind: 'container', running: true },
      { name: 'debug-1', kind: 'ephemeral', running: true },
    ]);
  });

  it('defaults to the app container, not a sidecar listed first', () => {
    expect(defaultTerminalTarget(terminalTargets(pod))).toBe('app');
  });

  it('prefers a running container when the app container is down', () => {
    const crashed = { ...pod, status: { containerStatuses: [{ name: 'oauth-proxy', state: { running: {} } }, { name: 'app', state: {} }] } };
    expect(defaultTerminalTarget(terminalTargets(crashed))).toBe('oauth-proxy');
  });
});
