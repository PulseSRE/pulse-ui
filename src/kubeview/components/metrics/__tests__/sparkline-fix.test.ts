import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src/kubeview');

describe('Sparkline/MetricCard fixes', () => {
  const source = fs.readFileSync(path.join(SRC, 'components/metrics/Sparkline.tsx'), 'utf-8');

  it('computes time range inside queryFn, not at render time', () => {
    // getTimeRange should be called inside queryFn, not outside
    expect(source).not.toMatch(/const \[start, end\] = getTimeRange\(duration\);\s*\n\s*const \{ data/);
    // Should be inside the queryFn callback
    expect(source).toMatch(/queryFn:\s*\(\)\s*=>\s*\{[\s\S]*?getTimeRange\(duration\)/);
  });

  it('catches queryRange errors gracefully', () => {
    // Both Sparkline and MetricCard should catch errors
    const catchCount = (source.match(/\.catch\(\(\)\s*=>\s*\[\]\)/g) || []).length;
    expect(catchCount).toBeGreaterThanOrEqual(2);
  });

  it('does not call getTimeRange at module or render level', () => {
    // getTimeRange should only appear inside queryFn blocks
    const lines = source.split('\n');
    for (const line of lines) {
      if (line.includes('getTimeRange') && !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.includes('import')) {
        // Should be inside a function body (indented), not at top level
        expect(line.match(/^\s+/)).not.toBeNull();
      }
    }
  });
});

describe('ActionPanel removal', () => {
  it('Shell does not import or render ActionPanel', () => {
    const shell = fs.readFileSync(path.join(SRC, 'components/Shell.tsx'), 'utf-8');
    expect(shell).not.toContain('ActionPanel');
    expect(shell).not.toContain('actionPanelOpen');
  });

  it('Cmd+. opens resource browser not action panel', () => {
    const shortcuts = fs.readFileSync(path.join(SRC, 'hooks/useKeyboardShortcuts.ts'), 'utf-8');
    // Cmd+. should toggle browser
    expect(shortcuts).toContain("state.toggleBrowser()");
    // Should NOT reference action panel
    expect(shortcuts).not.toContain('openActionPanel');
    expect(shortcuts).not.toContain('actionPanelOpen');
  });
});

describe('Health audits exist on all overview pages', () => {
  it('WorkloadsView has WorkloadHealthAudit', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/WorkloadsView.tsx'), 'utf-8');
    expect(source).toContain('WorkloadHealthAudit');
    expect(source).toContain("id: 'resource-limits'");
    expect(source).toContain("id: 'liveness-probe'");
    expect(source).toContain("id: 'readiness-probe'");
    expect(source).toContain("id: 'pdb'");
    expect(source).toContain("id: 'replicas'");
    expect(source).toContain("id: 'strategy'");
  });

  it('StorageView has StorageHealthAudit', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/StorageView.tsx'), 'utf-8');
    expect(source).toContain('StorageHealthAudit');
    expect(source).toContain("id: 'default-sc'");
    expect(source).toContain("id: 'pvc-binding'");
    expect(source).toContain("id: 'reclaim-policy'");
    expect(source).toContain("id: 'binding-mode'");
    expect(source).toContain("id: 'volume-snapshots'");
    expect(source).toContain("id: 'storage-quotas'");
  });

  it('NetworkingView has NetworkingHealthAudit', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/NetworkingView.tsx'), 'utf-8');
    expect(source).toContain('NetworkingHealthAudit');
    expect(source).toContain("id: 'route-tls'");
    expect(source).toContain("id: 'network-policies'");
    expect(source).toContain("id: 'nodeport-services'");
    expect(source).toContain("id: 'ingress-health'");
    expect(source).toContain("id: 'route-admission'");
    expect(source).toContain("id: 'egress-policies'");
  });

  it('ComputeView has ComputeHealthAudit', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/ComputeView.tsx'), 'utf-8');
    expect(source).toContain('ComputeHealthAudit');
    expect(source).toContain("id: 'ha-control-plane'");
    expect(source).toContain("id: 'dedicated-workers'");
    expect(source).toContain("id: 'machine-health-checks'");
    expect(source).toContain("id: 'node-pressure'");
    expect(source).toContain("id: 'kubelet-version'");
    expect(source).toContain("id: 'cluster-autoscaling'");
  });

  it('all audits use shared HealthAuditPanel with "Why it matters" and yamlExample', () => {
    const files = ['views/WorkloadsView.tsx', 'views/StorageView.tsx', 'views/NetworkingView.tsx', 'views/ComputeView.tsx'];
    for (const file of files) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf-8');
      expect(source).toContain('HealthAuditPanel');
      expect(source).toContain('yamlExample');
    }
    // Shared component renders "Why it matters", score, and totalPassing
    const panel = fs.readFileSync(path.join(SRC, 'components/audit/HealthAuditPanel.tsx'), 'utf-8');
    expect(panel).toContain('Why it matters');
    expect(panel).toContain('score');
    expect(panel).toContain('totalPassing');
  });
});
