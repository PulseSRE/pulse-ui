// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { UpgradeProgressPanel } from '../UpgradeProgressPanel';
import type { ClusterVersion } from '../../../engine/types';

afterEach(cleanup);

const cvWith = (reason: string, message: string) => ({
  metadata: { name: 'version' },
  spec: { channel: 'fast-5.0' },
  status: { desired: { version: '5.0.1' }, history: [{ state: 'Completed', version: '5.0.1' }], conditions: [{ type: 'Upgradeable', status: 'False', reason, message }] },
}) as unknown as ClusterVersion;

const renderPanel = (cv: ClusterVersion) => render(
  <UpgradeProgressPanel clusterVersion={cv} isUpdating={false} nodes={[]} machineConfigPools={[]} pdbs={[]} pods={[]} availableUpdates={[]} onReapplyUpdate={() => {}} />,
);

describe('Upgradeable=False banner', () => {
  it('titles the banner in words and keeps the raw reason code as a detail', () => {
    renderPanel(cvWith('RiskNameNotCompatibleWithReasonProperty', 'Risk "Foo" uses a name that is not valid as a reason.'));
    expect(screen.getByTestId('upgradeable-title').textContent).toBe('Minor updates are blocked: Risk name not compatible with reason property');
    expect(screen.getByTestId('upgradeable-title').textContent).not.toContain('RiskNameNotCompatibleWithReasonProperty');
    expect(screen.getByTestId('upgradeable-reason-code').textContent).toContain('RiskNameNotCompatibleWithReasonProperty');
    expect(screen.getByText(/uses a name that is not valid/)).toBeTruthy();
    // Not an admin-ack gate: no advice to run oc adm upgrade for an admin-acks key.
    expect(screen.queryByText(/admin-acks/)).toBeNull();
  });

  it('still points at the admin-acks key for AdminAckRequired', () => {
    renderPanel(cvWith('AdminAckRequired', 'Kubernetes 1.34 removes APIs.'));
    expect(screen.getByTestId('upgradeable-title').textContent).toBe('Minor updates are blocked: An administrator acknowledgement is required');
    expect(screen.getByText(/admin-acks/)).toBeTruthy();
  });
});
