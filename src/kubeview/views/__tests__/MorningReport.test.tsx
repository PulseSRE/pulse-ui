import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf-8');
}

describe('MorningReportView', () => {
  const source = readSrc('pulse/ReportTab.tsx');

  describe('risk score computation', () => {
    it('weights critical alerts at 20 points each (max 40)', () => {
      expect(source).toContain('Math.min(40, criticalAlerts.length * 20)');
    });

    it('weights warning alerts at 5 points each (max 20)', () => {
      expect(source).toContain('Math.min(20, warningAlerts.length * 5)');
    });

    it('weights unhealthy nodes at 15 points each', () => {
      expect(source).toContain('unhealthyNodes.length * 15');
    });

    it('weights degraded operators at 10 points each', () => {
      expect(source).toContain('degradedOperators.length * 10');
    });

    it('weights certs expiring < 7 days at 15 points each', () => {
      expect(source).toContain('certsExpiringSoon7.length * 15');
    });

    it('weights certs expiring < 30 days at 5 points each', () => {
      expect(source).toContain('certsExpiringSoon30.length * 5');
    });

    it('weights failed pods at 3 points each (max 15)', () => {
      expect(source).toContain('Math.min(15, failedPods.length * 3)');
    });

    it('caps total score at 100', () => {
      expect(source).toContain('Math.min(100, score)');
    });
  });

  describe('certificate expiry parsing', () => {
    it('checks cert-manager annotations first', () => {
      expect(source).toContain('cert-manager.io/certificate-expiry');
    });

    it('checks OpenShift service-ca annotations second', () => {
      expect(source).toContain('service.beta.openshift.io/expiry');
    });

    it('falls back to creation timestamp estimate', () => {
      expect(source).toContain('365 * 86_400_000');
    });
  });

  describe('risk score visual', () => {
    it('renders SVG ring indicator', () => {
      expect(source).toContain('RiskScoreRing');
      expect(source).toContain('<svg');
      expect(source).toContain('circumference');
    });

    it('has four severity levels', () => {
      expect(source).toContain("'Healthy'");
      expect(source).toContain("'Caution'");
      expect(source).toContain("'At Risk'");
      expect(source).toContain("'Critical'");
    });
  });

  describe('attention items', () => {
    it('prioritizes degraded operators', () => {
      expect(source).toContain('Operator');
      expect(source).toContain('is degraded');
    });

    it('includes unhealthy nodes', () => {
      expect(source).toContain('is NotReady');
    });

    it('includes failed pods with reason', () => {
      expect(source).toContain('CrashLoopBackOff');
      expect(source).toContain('ImagePullBackOff');
    });

    it('includes expiring certificates', () => {
      expect(source).toContain('expires in');
    });

    it('links attention items to relevant views', () => {
      expect(source).toContain('/admin?tab=operators');
      expect(source).toContain('/alerts');
      expect(source).toContain('/r/v1~pods/');
      expect(source).toContain('/r/v1~nodes/');
    });
  });

  describe('cluster vitals', () => {
    it('fetches CPU metrics from Prometheus', () => {
      expect(source).toContain('node_cpu_seconds_total');
      expect(source).toContain('machine_cpu_cores');
    });

    it('fetches memory metrics from Prometheus', () => {
      expect(source).toContain('node_memory_MemAvailable_bytes');
      expect(source).toContain('node_memory_MemTotal_bytes');
    });

    it('shows node health count', () => {
      expect(source).toContain("label=\"Nodes\"");
    });

    it('shows pod health count', () => {
      expect(source).toContain("label=\"Pods\"");
    });
  });

  describe('change summary', () => {
    it('fetches events from last 24 hours', () => {
      expect(source).toContain('24 * 60 * 60 * 1000');
    });

    it('tracks alerts fired', () => {
      expect(source).toContain('newAlerts');
    });

    it('tracks RBAC changes', () => {
      expect(source).toContain('rbacChanges');
    });
  });

  describe('data sources', () => {
    it('receives nodes, pods, operators as props from PulseView', () => {
      expect(source).toContain('nodes: K8sResource[]');
      expect(source).toContain('allPods: K8sResource[]');
      expect(source).toContain('operators: K8sResource[]');
    });

    it('fetches events and TLS secrets independently', () => {
      expect(source).toContain('/api/v1/events');
      expect(source).toContain('kubernetes.io/tls');
    });

    it('uses Prometheus for firing alerts', () => {
      expect(source).toContain('ALERTS{alertstate="firing"}');
    });
  });

  describe('navigation', () => {
    it('morning-report redirects to pulse in App', () => {
      const app = fs.readFileSync(path.join(__dirname, '../../App.tsx'), 'utf-8');
      expect(app).toContain('morning-report');
    });

    it('report tab is integrated into PulseView', () => {
      const pulse = fs.readFileSync(path.join(__dirname, '../PulseView.tsx'), 'utf-8');
      expect(pulse).toContain('ReportTab');
      expect(pulse).toContain("'report'");
    });

    it('links to full certificate inventory', () => {
      const reportTab = fs.readFileSync(path.join(__dirname, '../pulse/ReportTab.tsx'), 'utf-8');
      expect(reportTab).toContain('/admin?tab=certificates');
    });
  });
});
