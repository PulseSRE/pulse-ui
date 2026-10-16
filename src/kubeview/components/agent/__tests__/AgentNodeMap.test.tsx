// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentNodeMap } from '../AgentNodeMap';
import type { NodeMapSpec } from '../../../engine/agentComponents';

vi.mock('../../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

describe('AgentNodeMap', () => {
  it('renders nodes that omit roles, podCount and podCap', () => {
    // The shape the agent's registry example taught the model to emit. Before
    // the defaults in AgentNodeMap, NodeHexMap threw on roles.join() and the
    // widget showed "failed to render".
    const spec = {
      kind: 'node_map',
      title: 'Cluster Nodes',
      nodes: [
        { name: 'worker-1', status: 'ready', cpuPct: 45.2 },
        { name: 'worker-2', status: 'pressure', cpuPct: 91 },
      ],
    } as unknown as NodeMapSpec;

    render(<AgentNodeMap spec={spec} />);

    expect(screen.getAllByText('Cluster Nodes').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/worker-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/worker-2/).length).toBeGreaterThan(0);
  });

  it('renders an empty node list without throwing', () => {
    const spec = { kind: 'node_map', title: 'No Nodes' } as unknown as NodeMapSpec;
    render(<AgentNodeMap spec={spec} />);
    expect(screen.getAllByText('No Nodes').length).toBeGreaterThan(0);
  });
});
