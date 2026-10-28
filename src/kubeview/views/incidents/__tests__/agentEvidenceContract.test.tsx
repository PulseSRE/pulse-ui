// @vitest-environment jsdom
/**
 * The evidence behind a diagnosis, rendered from what the agent actually sends.
 *
 * The payloads come from `src/kubeview/__fixtures__/agent-contract/investigation.json`,
 * which pulse-agent generates from its real code (tests/test_ui_contract_fixtures.py)
 * and pins: if the agent changes what it emits, its own test fails until the
 * file is regenerated and copied here, and then this test says whether the UI
 * still draws it. Each side used to test its half against payloads it wrote
 * itself, which is how evidence-view cards shipped with props no renderer read.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

import contract from '../../../__fixtures__/agent-contract/investigation.json';
import { AgentComponentRenderer } from '../../../components/agent/AgentComponentRenderer';
import { InvestigationCard } from '../shared/InvestigationCard';
import type { ComponentSpec } from '../../../engine/agentComponents';
import type { InvestigationReport } from '../../../engine/monitorClient';

afterEach(cleanup);

function renderView(widgets: unknown[]) {
  return render(
    <MemoryRouter>
      {widgets.map((w, i) => (
        <AgentComponentRenderer key={i} spec={w as ComponentSpec} />
      ))}
    </MemoryRouter>,
  );
}

describe('evidence view (claim-time header widgets)', () => {
  const supported = contract.evidence_view.supported;

  it('shows the cause, the fix and the confidence', () => {
    renderView(supported);
    expect(screen.getByText('62%')).toBeDefined();
    expect(screen.getByText(contract.investigation_report.supported.suspected_cause)).toBeDefined();
    expect(screen.getByText(/Restore DB_HOST from ConfigMap api-config/)).toBeDefined();
  });

  it('shows every evidence item with its stance and source', () => {
    renderView(supported);
    const items = supported[2].props.items as Array<{ name: string; detail: string }>;
    for (const item of items) {
      expect(screen.getByText(item.name)).toBeDefined();
      expect(screen.getByText(item.detail)).toBeDefined();
    }
  });

  it('marks contradicting evidence differently from supporting evidence', () => {
    renderView([supported[2]]);
    // The status dot is the row's first child; its colour is the stance.
    const dot = (text: string) => (screen.getByText(text).parentElement as HTMLElement).firstElementChild!.className;
    expect(dot('Restarts began 40 minutes before the rollout')).not.toEqual(
      dot('Logs: required environment variable DB_HOST is not set'),
    );
    // And in words, not only colour.
    expect(screen.getByText('contradicts · event · source: get_events')).toBeDefined();
  });

  it('lists the alternatives that were ruled out', () => {
    renderView(supported);
    for (const alt of contract.investigation_report.supported.alternatives_considered) {
      expect(screen.getByText(alt)).toBeDefined();
    }
  });

  it('shows a 0% confidence when nothing supports the cause, instead of hiding it', () => {
    renderView(contract.evidence_view.unsupported);
    expect(screen.getByText('0%')).toBeDefined();
    expect(screen.getByText('Low confidence')).toBeDefined();
  });
});

describe('investigation report card (monitor activity feed)', () => {
  const supported = contract.investigation_report.supported as unknown as InvestigationReport;
  const unsupported = contract.investigation_report.unsupported as unknown as InvestigationReport;

  it('shows the cause, summary and confidence the agent reported', () => {
    render(<InvestigationCard report={supported} />);
    expect(screen.getByText(supported.suspectedCause!)).toBeDefined();
    expect(screen.getByText(supported.summary)).toBeDefined();
    expect(screen.getByText('62% confidence')).toBeDefined();
  });

  it('does not present contradicting evidence as support', () => {
    render(<InvestigationCard report={supported} />);
    const contradicting = screen.getByText('Restarts began 40 minutes before the rollout').closest('li') as HTMLElement;
    const supporting = screen.getByText('Logs: required environment variable DB_HOST is not set').closest('li') as HTMLElement;
    expect(within(contradicting).getByLabelText('contradicts')).toBeDefined();
    expect(within(supporting).getByLabelText('supports')).toBeDefined();
    expect(within(supporting).getByText('get_pod_logs')).toBeDefined();
  });

  it('shows an unsupported diagnosis as 0% rather than leaving the confidence out', () => {
    render(<InvestigationCard report={unsupported} />);
    expect(screen.getByText('0% confidence')).toBeDefined();
    expect(screen.getByText(/no supporting evidence/i)).toBeDefined();
  });

  it('lists the alternatives on request', () => {
    render(<InvestigationCard report={supported} />);
    fireEvent.click(screen.getByText(/Alternatives ruled out \(2\)/));
    expect(screen.getByText('OOM kill: ruled out, exit code 1 not 137')).toBeDefined();
  });
});

