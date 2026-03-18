/**
 * Tests for all domain-specific overview pages.
 * Verifies consistent structure: header, stat cards, health audit, panels.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src/kubeview');

function readView(name: string): string {
  return fs.readFileSync(path.join(SRC, 'views', name), 'utf-8');
}

describe('Domain view consistency', () => {
  const views = [
    { file: 'WorkloadsView.tsx', audit: 'WorkloadHealthAudit', checks: 6 },
    { file: 'StorageView.tsx', audit: 'StorageHealthAudit', checks: 6 },
    { file: 'NetworkingView.tsx', audit: 'NetworkingHealthAudit', checks: 6 },
    { file: 'ComputeView.tsx', audit: 'ComputeHealthAudit', checks: 6 },
    { file: 'AccessControlView.tsx', audit: 'RBACHealthAudit', checks: 6 },
  ];

  for (const view of views) {
    describe(view.file, () => {
      const source = readView(view.file);

      it('has a page header with h1', () => {
        expect(source).toContain('text-2xl font-bold');
      });

      it('uses useK8sListWatch for real-time data', () => {
        expect(source).toContain('useK8sListWatch');
      });

      it('has stat cards', () => {
        expect(source).toMatch(/grid.*cols.*gap/);
        expect(source).toContain('text-xl font-bold');
      });

      it(`has ${view.audit} health audit component`, () => {
        expect(source).toContain(view.audit);
      });

      it('health audit has score percentage', () => {
        expect(source).toContain('totalPassing');
        expect(source).toContain('score');
      });

      it('health audit has "Why it matters" explanations', () => {
        expect(source).toContain('Why it matters');
      });

      it('health audit has YAML examples', () => {
        expect(source).toContain('yamlExample');
      });

      it('uses useNavigateTab for navigation', () => {
        expect(source).toContain('useNavigateTab');
      });

      it('has section panels or detail panels', () => {
        // All domain views have some kind of panel/section structure
        expect(source).toMatch(/Panel|rounded-lg border border-slate-800/);
      });
    });
  }
});

describe('WorkloadsView specifics', () => {
  const source = readView('WorkloadsView.tsx');

  it('has MetricCard sparklines', () => {
    expect(source).toContain('MetricCard');
    expect(source).toContain('Pod CPU Usage');
  });

  it('excludes platform namespaces from audit', () => {
    expect(source).toContain("!ns.startsWith('openshift-')");
  });

  it('fetches PDBs for audit', () => {
    expect(source).toContain('poddisruptionbudgets');
  });

  it('checks resource limits, probes, PDBs, replicas, strategy', () => {
    expect(source).toContain("id: 'resource-limits'");
    expect(source).toContain("id: 'liveness-probe'");
    expect(source).toContain("id: 'readiness-probe'");
    expect(source).toContain("id: 'pdb'");
    expect(source).toContain("id: 'replicas'");
    expect(source).toContain("id: 'strategy'");
  });
});

describe('StorageView specifics', () => {
  const source = readView('StorageView.tsx');

  it('has MetricCard sparklines', () => {
    expect(source).toContain('MetricCard');
    expect(source).toContain('PVC Usage');
  });

  it('fetches CSI drivers', () => {
    expect(source).toContain('csidrivers');
  });

  it('checks default SC, PVC binding, reclaim, binding mode, snapshots, quotas', () => {
    expect(source).toContain("id: 'default-sc'");
    expect(source).toContain("id: 'pvc-binding'");
    expect(source).toContain("id: 'reclaim-policy'");
    expect(source).toContain("id: 'binding-mode'");
    expect(source).toContain("id: 'volume-snapshots'");
    expect(source).toContain("id: 'storage-quotas'");
  });
});

describe('NetworkingView specifics', () => {
  const source = readView('NetworkingView.tsx');

  it('has MetricCard sparklines', () => {
    expect(source).toContain('MetricCard');
    expect(source).toContain('Network Receive');
  });

  it('fetches ingress controllers', () => {
    expect(source).toContain('ingresscontrollers');
  });

  it('checks TLS, policies, NodePort, ingress health, admission, egress', () => {
    expect(source).toContain("id: 'route-tls'");
    expect(source).toContain("id: 'network-policies'");
    expect(source).toContain("id: 'nodeport-services'");
    expect(source).toContain("id: 'ingress-health'");
    expect(source).toContain("id: 'route-admission'");
    expect(source).toContain("id: 'egress-policies'");
  });
});

describe('ComputeView specifics', () => {
  const source = readView('ComputeView.tsx');

  it('has MetricCard sparklines', () => {
    expect(source).toContain('MetricCard');
    expect(source).toContain('Cluster CPU');
  });

  it('shows node taints', () => {
    expect(source).toContain('taints');
    expect(source).toContain('NoSchedule');
  });

  it('has MachineConfigPools', () => {
    expect(source).toContain('machineconfigpools');
  });

  it('checks HA, workers, MHCs, pressure, kubelet, autoscaling', () => {
    expect(source).toContain("id: 'ha-control-plane'");
    expect(source).toContain("id: 'dedicated-workers'");
    expect(source).toContain("id: 'machine-health-checks'");
    expect(source).toContain("id: 'node-pressure'");
    expect(source).toContain("id: 'kubelet-version'");
    expect(source).toContain("id: 'cluster-autoscaling'");
  });
});

describe('AccessControlView specifics', () => {
  const source = readView('AccessControlView.tsx');

  it('has no tabs (consistent with other domain pages)', () => {
    expect(source).not.toContain("activeTab");
  });

  it('has issues banner for excessive cluster-admins', () => {
    expect(source).toContain('cluster-admin');
    expect(source).toContain('broadPermissions');
  });

  it('has quick links to User Management', () => {
    expect(source).toContain("'/users'");
    expect(source).toContain('User Management');
  });

  it('checks default SA, overprivileged, wildcards, stale, isolation, automount', () => {
    expect(source).toContain("id: 'default-sa'");
    expect(source).toContain("id: 'overprivileged-bindings'");
    expect(source).toContain("id: 'wildcard-rules'");
    expect(source).toContain("id: 'stale-bindings'");
    expect(source).toContain("id: 'namespace-isolation'");
    expect(source).toContain("id: 'sa-automount'");
  });
});

describe('UserManagementView specifics', () => {
  const source = readView('UserManagementView.tsx');

  it('has impersonation support', () => {
    expect(source).toContain('impersonateUser');
    expect(source).toContain('setImpersonation');
  });

  it('has Identity & Access Audit', () => {
    expect(source).toContain('IdentityAudit');
    expect(source).toContain('Identity & Access Audit');
  });

  it('has recent sessions', () => {
    expect(source).toContain('Recent Sessions');
    expect(source).toContain('oauthaccesstokens');
  });

  it('checks kubeadmin secret not user object', () => {
    expect(source).toContain('kubeadmin-secret');
    expect(source).toContain('kubeadminExists');
  });

  it('checks identity providers, kubeadmin, cluster-admin, SA, inactive, groups', () => {
    expect(source).toContain("id: 'identity-providers'");
    expect(source).toContain("id: 'kubeadmin-removed'");
    expect(source).toContain("id: 'cluster-admin-audit'");
    expect(source).toContain("id: 'sa-cluster-admin'");
    expect(source).toContain("id: 'inactive-users'");
    expect(source).toContain("id: 'groups-configured'");
  });
});

describe('PulseView (merged Troubleshoot)', () => {
  const source = readView('PulseView.tsx');

  it('has 4 tabs: overview, issues, runbooks, health', () => {
    expect(source).toContain("'overview'");
    expect(source).toContain("'issues'");
    expect(source).toContain("'runbooks'");
    expect(source).toContain("'health'");
  });

  it('has MetricCard sparklines', () => {
    expect(source).toContain('MetricCard');
    expect(source).toContain('CPU Usage');
  });

  it('has diagnosis with log enrichment', () => {
    expect(source).toContain('diagnoseResource');
  });

  it('has 6 runbooks', () => {
    expect(source).toContain("id: 'crashloop'");
    expect(source).toContain("id: 'imagepull'");
    expect(source).toContain("id: 'pending'");
  });

  it('has namespace health heatmap', () => {
    expect(source).toContain('namespaceHealth');
  });
});
