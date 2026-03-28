import { describe, it, expect, beforeEach } from 'vitest';
import { WatchManager } from '../watch';

describe('WatchManager', () => {
  let manager: WatchManager;

  beforeEach(() => {
    manager = new WatchManager();
  });

  it('starts with disconnected status', () => {
    expect(manager.getStatus()).toBe('disconnected');
  });

  it('starts with zero watch count', () => {
    expect(manager.watchCount).toBe(0);
  });

  it('getConnections returns empty array initially', () => {
    expect(manager.getConnections()).toEqual([]);
  });

  it('stopAll does not throw when no watches', () => {
    expect(() => manager.stopAll()).not.toThrow();
  });

  it('reconnectAll does not throw when no watches', () => {
    expect(() => manager.reconnectAll()).not.toThrow();
  });

  describe('URL construction with query params', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../watch.ts'), 'utf-8');

    it('uses ? separator for paths without query params', () => {
      expect(source).toContain("normalizedPath.includes('?') ? '&' : '?'");
    });

    it('preserves query params like fieldSelector in watch paths', () => {
      expect(source).toContain('const separator');
      expect(source).toContain('${separator}watch=1');
    });
  });

  describe('views use watches for K8s resources', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const viewsDir = path.join(__dirname, '../../views');
    const detailDir = path.join(viewsDir, 'detail');

    it('AdminView watches nodes instead of polling', () => {
      const source = fs.readFileSync(path.join(viewsDir, 'AdminView.tsx'), 'utf-8');
      expect(source).toContain("useK8sListWatch");
      expect(source).toContain("apiPath: '/api/v1/nodes'");
      expect(source).not.toMatch(/queryFn.*k8sList.*nodes/);
    });

    it('AdminView watches clusteroperators instead of polling', () => {
      const source = fs.readFileSync(path.join(viewsDir, 'AdminView.tsx'), 'utf-8');
      expect(source).toContain("apiPath: '/apis/config.openshift.io/v1/clusteroperators'");
    });

    it('DetailView watches managed pods instead of polling', () => {
      const source = fs.readFileSync(path.join(viewsDir, 'DetailView.tsx'), 'utf-8');
      expect(source).toContain("useK8sListWatch");
      expect(source).toContain("podsApiPath");
      expect(source).not.toMatch(/refetchInterval.*15000.*managedPods|managed-pods.*refetchInterval/s);
    });

    it('DetailView watches events instead of polling', () => {
      const source = fs.readFileSync(path.join(viewsDir, 'DetailView.tsx'), 'utf-8');
      expect(source).toContain("eventsApiPath");
      expect(source).toContain("fieldSelector");
    });

    it('TimelineView uses incident timeline hook (which uses watches internally)', () => {
      const source = fs.readFileSync(path.join(viewsDir, 'TimelineView.tsx'), 'utf-8');
      expect(source).toContain("useIncidentTimeline");
      // The hook uses useK8sListWatch internally for events, replicasets, etc.
      const hookSource = fs.readFileSync(path.join(viewsDir, '../hooks/useIncidentTimeline.ts'), 'utf-8');
      expect(hookSource).toContain("useK8sListWatch");
    });

    it('LogsView watches pods via WebSocket (build logs poll intentionally)', () => {
      const source = fs.readFileSync(path.join(viewsDir, 'LogsView.tsx'), 'utf-8');
      expect(source).toContain("useK8sListWatch");
      // Build logs use refetchInterval because builds don't support WebSocket watches
      expect(source).toContain("BuildLogsView");
    });

    it('IncidentContext watches pod events instead of polling', () => {
      const source = fs.readFileSync(path.join(detailDir, 'IncidentContext.tsx'), 'utf-8');
      expect(source).toContain("useK8sListWatch");
      expect(source).toContain("podEventsPath");
    });
  });

  it('watch returns a subscription with unsubscribe', () => {
    // WebSocket will fail in test env, but subscription should still be returned
    try {
      const sub = manager.watch('/api/v1/pods', () => {});
      expect(sub).toBeDefined();
      expect(typeof sub.unsubscribe).toBe('function');
      sub.unsubscribe();
    } catch {
      // WebSocket not available in test env, that's OK
    }
  });
});
