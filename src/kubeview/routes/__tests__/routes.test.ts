import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('route modules', () => {
  const routesDir = path.join(__dirname, '..');

  describe('resourceRoutes', () => {
    const source = fs.readFileSync(path.join(routesDir, 'resourceRoutes.tsx'), 'utf-8');

    it('exports resourceRoutes function', () => {
      expect(source).toContain('export function resourceRoutes()');
    });

    it('defines all resource route paths', () => {
      const paths = [
        'path="r/:gvr"',
        'path="r/:gvr/:namespace/:name"',
        'path="r/:gvr/_/:name"',
        'path="yaml/:gvr/:namespace/:name"',
        'path="yaml/:gvr/_/:name"',
        'path="logs/:namespace/:name"',
        'path="node-logs/:name"',
        'path="metrics/:gvr/:namespace/:name"',
        'path="metrics/:gvr/_/:name"',
        'path="create/:gvr"',
        'path="deps/:gvr/:namespace/:name"',
      ];
      for (const p of paths) {
        expect(source).toContain(p);
      }
    });

    it('lazy-loads heavy view components', () => {
      const lazyViews = [
        'YamlEditorView', 'LogsView', 'MetricsView',
        'CreateView', 'DependencyView', 'NodeLogsView',
      ];
      for (const view of lazyViews) {
        expect(source).toContain(`lazy(() => import('../views/${view}'))`);
      }
    });

    it('uses parseGvr to convert ~ to /', () => {
      expect(source).toContain("gvr.replace(/~/g, '/')");
    });
  });

  describe('domainRoutes', () => {
    const source = fs.readFileSync(path.join(routesDir, 'domainRoutes.tsx'), 'utf-8');

    it('exports domainRoutes function', () => {
      expect(source).toContain('export function domainRoutes()');
    });

    it('defines all domain view paths', () => {
      const paths = [
        'path="workloads"', 'path="networking"', 'path="compute"',
        'path="storage"', 'path="builds"', 'path="crds"',
        'path="security"', 'path="access-control"', 'path="users"',
        'path="admin"', 'path="alerts"',
      ];
      for (const p of paths) {
        expect(source).toContain(p);
      }
    });

    it('lazy-loads all domain views', () => {
      const views = [
        'AccessControlView', 'UserManagementView', 'StorageView',
        'AdminView', 'AlertsView', 'WorkloadsView', 'NetworkingView',
        'ComputeView', 'BuildsView', 'CRDsView', 'SecurityView',
      ];
      for (const view of views) {
        expect(source).toContain(`lazy(() => import('../views/${view}'))`);
      }
    });
  });

  describe('redirects', () => {
    const source = fs.readFileSync(path.join(routesDir, 'redirects.tsx'), 'utf-8');

    it('exports redirectRoutes function', () => {
      expect(source).toContain('export function redirectRoutes()');
    });

    it('defines all legacy redirects', () => {
      const redirects = [
        { from: 'software', to: '/create/v1~pods' },
        { from: 'operators', to: '/admin' },
        { from: 'operatorhub', to: '/create/v1~pods?tab=operators' },
        { from: 'dashboard', to: '/pulse' },
        { from: 'morning-report', to: '/pulse' },
        { from: 'troubleshoot', to: '/pulse' },
        { from: 'config-compare', to: '/admin' },
        { from: 'timeline', to: '/admin?tab=timeline' },
      ];
      for (const r of redirects) {
        expect(source).toContain(`path="${r.from}"`);
        expect(source).toContain(`to="${r.to}"`);
      }
    });
  });

  describe('barrel export', () => {
    const source = fs.readFileSync(path.join(routesDir, 'index.ts'), 'utf-8');

    it('re-exports all route modules', () => {
      expect(source).toContain("export { resourceRoutes } from './resourceRoutes'");
      expect(source).toContain("export { domainRoutes } from './domainRoutes'");
      expect(source).toContain("export { redirectRoutes } from './redirects'");
    });
  });

  describe('App.tsx integration', () => {
    const appSource = fs.readFileSync(path.join(routesDir, '..', 'App.tsx'), 'utf-8');

    it('imports from routes barrel', () => {
      expect(appSource).toContain("from './routes'");
    });

    it('composes all route groups', () => {
      expect(appSource).toContain('resourceRoutes()');
      expect(appSource).toContain('domainRoutes()');
      expect(appSource).toContain('redirectRoutes()');
    });

    it('keeps Shell, Welcome, and Pulse in App directly', () => {
      expect(appSource).toContain('Shell');
      expect(appSource).toContain('WelcomeView');
      expect(appSource).toContain('PulseView');
    });

    it('is concise (under 50 lines)', () => {
      const lines = appSource.split('\n').length;
      expect(lines).toBeLessThanOrEqual(50);
    });
  });
});

describe('deployment manifest security', () => {
  const manifest = fs.readFileSync(
    path.join(__dirname, '../../../../deploy/deployment.yaml'), 'utf-8'
  );

  it('does not bind cluster-admin', () => {
    expect(manifest).not.toContain('cluster-admin');
  });

  it('uses a minimal ClusterRole', () => {
    expect(manifest).toContain('openshiftpulse-reader');
  });

  it('does not contain hardcoded secrets', () => {
    expect(manifest).not.toContain('openshiftpulse-oauth-secret-v1');
    expect(manifest).not.toContain('openshiftpulse-secret-cookie');
  });

  it('uses secret file mounts for oauth-proxy', () => {
    expect(manifest).toContain('--client-secret-file=/etc/oauth/client-secret');
    expect(manifest).toContain('--cookie-secret-file=/etc/oauth/cookie-secret');
  });

  it('does not contain hardcoded cluster URLs', () => {
    expect(manifest).not.toContain('rhamilto.devcluster.openshift.com');
  });

  it('has placeholder redirect URI', () => {
    expect(manifest).toContain('REPLACE_WITH_CLUSTER_ROUTE');
  });

  it('documents secret generation', () => {
    expect(manifest).toContain('openssl rand -base64 32');
  });

  it('explains that user permissions use forwarded OAuth token', () => {
    expect(manifest).toContain('X-Forwarded-Access-Token');
  });
});

describe('rspack.config.ts', () => {
  const config = fs.readFileSync(
    path.join(__dirname, '../../../../rspack.config.ts'), 'utf-8'
  );

  it('does not contain hardcoded cluster URLs', () => {
    expect(config).not.toContain('rhamilto.devcluster.openshift.com');
  });

  it('conditionally enables prometheus proxy only when THANOS_URL is set', () => {
    expect(config).toContain('process.env.THANOS_URL ?');
  });

  it('conditionally enables alertmanager proxy only when ALERTMANAGER_URL is set', () => {
    expect(config).toContain('process.env.ALERTMANAGER_URL ?');
  });
});

describe('stale auth cleanup', () => {
  it('root nginx.conf is deleted', () => {
    const exists = fs.existsSync(path.join(__dirname, '../../../../nginx.conf'));
    expect(exists).toBe(false);
  });

  it('entrypoint.sh does not inject SA token', () => {
    const entrypoint = fs.readFileSync(
      path.join(__dirname, '../../../../entrypoint.sh'), 'utf-8'
    );
    expect(entrypoint).not.toContain('SA_TOKEN');
    expect(entrypoint).not.toContain('sed');
    expect(entrypoint).toContain("exec nginx -g 'daemon off;'");
  });

  it('Dockerfile does not copy nginx.conf', () => {
    const dockerfile = fs.readFileSync(
      path.join(__dirname, '../../../../Dockerfile'), 'utf-8'
    );
    expect(dockerfile).not.toContain('COPY nginx.conf');
    expect(dockerfile).toContain('COPY entrypoint.sh');
  });
});
