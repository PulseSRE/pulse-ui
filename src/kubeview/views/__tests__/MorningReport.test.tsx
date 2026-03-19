import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf-8');
}

describe('ReportTab (Pulse Report)', () => {
  const source = readSrc('pulse/ReportTab.tsx');

  describe('risk score computation', () => {
    it('weights critical alerts at 20 points each (max 40)', () => {
      expect(source).toContain('Math.min(40, criticalAlerts.length * 20)');
    });

    it('weights unhealthy nodes at 15 points each', () => {
      expect(source).toContain('unhealthyNodes.length * 15');
    });

    it('weights degraded operators at 10 points each', () => {
      expect(source).toContain('degradedOperators.length * 10');
    });

    it('caps total score at 100', () => {
      expect(source).toContain('Math.min(100,');
    });
  });

  describe('risk score visual', () => {
    it('renders SVG ring', () => {
      expect(source).toContain('RiskScoreRing');
      expect(source).toContain('<svg');
    });

    it('has four severity levels', () => {
      expect(source).toContain("'Healthy'");
      expect(source).toContain("'Caution'");
      expect(source).toContain("'At Risk'");
      expect(source).toContain("'Critical'");
    });

    it('has details popover for score breakdown', () => {
      expect(source).toContain('Score Breakdown');
      expect(source).toContain('showScoreDetails');
    });
  });

  describe('attention items', () => {
    it('shows degraded operators', () => {
      expect(source).toContain('degraded');
    });

    it('shows NotReady nodes', () => {
      expect(source).toContain('NotReady');
    });

    it('includes failed pods with reason', () => {
      expect(source).toContain('CrashLoopBackOff');
    });

    it('links to relevant views', () => {
      expect(source).toContain('/admin?tab=operators');
      expect(source).toContain('/alerts');
      expect(source).toContain('/r/v1~pods/');
    });

    it('only shows when there are problems', () => {
      expect(source).toContain('attentionItems.length > 0');
    });
  });

  describe('cluster vitals', () => {
    it('shows CPU and Memory sparklines', () => {
      expect(source).toContain('title="CPU"');
      expect(source).toContain('title="Memory"');
    });

    it('shows node count', () => {
      expect(source).toContain('readyNodes.length');
      expect(source).toContain('nodes.length');
    });

    it('shows pod count for user namespaces', () => {
      expect(source).toContain('runningPods.length');
      expect(source).toContain('userPods.length');
    });
  });

  describe('certificate expiry', () => {
    it('only shows certs expiring within 30 days', () => {
      expect(source).toContain('urgentCerts');
      expect(source).toContain('Certificates Expiring Soon');
    });

    it('links to full cert inventory', () => {
      expect(source).toContain('/admin?tab=certificates');
    });
  });

  describe('data sources', () => {
    it('receives nodes, pods, operators as props', () => {
      expect(source).toContain('nodes: K8sResource[]');
      expect(source).toContain('allPods: K8sResource[]');
    });

    it('fetches TLS secrets', () => {
      expect(source).toContain('kubernetes.io/tls');
    });

    it('uses Prometheus for firing alerts', () => {
      expect(source).toContain('ALERTS{alertstate="firing"}');
    });
  });

  describe('healthy state', () => {
    it('shows all clear when no problems', () => {
      expect(source).toContain('All clear');
      expect(source).toContain('no issues detected');
    });

    it('links to alerts, certs, readiness from healthy state', () => {
      expect(source).toContain('/alerts');
      expect(source).toContain('/admin?tab=certificates');
      expect(source).toContain('/admin?tab=readiness');
    });
  });

  describe('integration', () => {
    it('is used in PulseView', () => {
      const pulse = readSrc('PulseView.tsx');
      expect(pulse).toContain('ReportTab');
    });
  });
});
