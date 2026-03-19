import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src/kubeview');

describe('Sparkline component', () => {
  it('exports Sparkline and MetricCard components', async () => {
    const mod = await import('../Sparkline');
    expect(typeof mod.Sparkline).toBe('function');
    expect(typeof mod.MetricCard).toBe('function');
  });

  it('Sparkline renders pure SVG without external chart library', () => {
    const source = fs.readFileSync(path.join(SRC, 'components/metrics/Sparkline.tsx'), 'utf-8');
    expect(source).toContain('<svg');
    expect(source).toContain('<path');
    expect(source).not.toContain('chart.js');
    expect(source).not.toContain('recharts');
    expect(source).not.toContain('d3');
  });

  it('MetricCard supports thresholds for color changes', () => {
    const source = fs.readFileSync(path.join(SRC, 'components/metrics/Sparkline.tsx'), 'utf-8');
    expect(source).toContain('thresholds');
    expect(source).toContain('warning');
    expect(source).toContain('critical');
  });

  it('uses queryRange for time-series data', () => {
    const source = fs.readFileSync(path.join(SRC, 'components/metrics/Sparkline.tsx'), 'utf-8');
    expect(source).toContain('queryRange');
    expect(source).toContain('getTimeRange');
  });

  it('ReportTab uses MetricCard for CPU, Memory, Network, Disk', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/pulse/ReportTab.tsx'), 'utf-8');
    expect(source).toContain('MetricCard');
    expect(source).toContain('title="CPU"');
    expect(source).toContain('title="Memory"');
    expect(source).toContain('Network In');
    expect(source).toContain('Disk I/O');
  });
});

describe('RBAC integration in TableView', () => {
  it('imports useCanI hook', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/TableView.tsx'), 'utf-8');
    expect(source).toContain("useCanI");
  });

  it('checks create, update, and delete permissions', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/TableView.tsx'), 'utf-8');
    expect(source).toContain('canDelete');
    expect(source).toContain('canUpdate');
    expect(source).toContain('canCreate');
  });

  it('hides Create button when user lacks create permission', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/TableView.tsx'), 'utf-8');
    expect(source).toContain('{canCreate &&');
  });

  it('hides Delete button when user lacks delete permission', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/TableView.tsx'), 'utf-8');
    expect(source).toContain('{canDelete &&');
  });

  it('disables Edit YAML when user lacks update permission', () => {
    const source = fs.readFileSync(path.join(SRC, 'views/TableView.tsx'), 'utf-8');
    expect(source).toContain('No update permission');
    expect(source).toContain('disabled={!canUpdate}');
  });
});
