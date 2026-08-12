import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ReactRefreshRspackPlugin as ReactRefreshPlugin } from '@rspack/plugin-react-refresh';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fetchHelmRepoIndex } from './src/dev/helmRepoProxy';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

const isDev = process.env.NODE_ENV === 'development';

function getOCToken(): string {
  if (process.env.OC_TOKEN) return process.env.OC_TOKEN;
  try {
    return execSync('oc whoami -t 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function getConsoleURL(): string {
  if (process.env.CONSOLE_URL) return process.env.CONSOLE_URL;
  try {
    const json = execSync('curl -sk http://localhost:8001/apis/config.openshift.io/v1/consoles/cluster 2>/dev/null', { encoding: 'utf-8' });
    const parsed = JSON.parse(json) as { status?: { consoleURL?: string } };
    return parsed.status?.consoleURL ?? '';
  } catch {
    return '';
  }
}


export default defineConfig({
  entry: {
    main: './src/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    chunkFilename: '[name].[contenthash:8].js',
    publicPath: '/',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'builtin:swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                },
                transform: {
                  react: {
                    runtime: 'automatic',
                    development: isDev,
                    refresh: isDev,
                  },
                },
              },
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: ['postcss-loader'],
        type: 'css',
        sideEffects: true,
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: 'asset',
      },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      __APP_VERSION__: JSON.stringify(pkg.version),
    }),
    new rspack.HtmlRspackPlugin({
      template: './public/index.html',
      title: 'OpenShift Pulse',
    }),
    isDev && new ReactRefreshPlugin(),
  ].filter(Boolean),
  optimization: {
    minimize: !isDev,
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
        },
        react: {
          test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
          name: 'react',
          priority: 20,
        },
        styles: {
          type: 'css',
          name: 'styles',
          chunks: 'all',
          enforce: true,
          priority: 30,
        },
      },
    },
  },
  devServer: {
    port: 9000,
    hot: true,
    historyApiFallback: {
      disableDotRule: true,
    },
    open: true,
    setupMiddlewares: (middlewares: unknown[]) => {
      // Proxy for fetching Helm chart repo indexes (avoids CORS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      middlewares.unshift(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/helmrepo')) return next();
        const url = new URL(req.url, 'http://localhost');
        const repoUrl = url.searchParams.get('url');
        if (!repoUrl) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing url parameter');
          return;
        }
        try {
          const text = await fetchHelmRepoIndex(repoUrl);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(text);
        } catch (err: unknown) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Failed to fetch chart index: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      return middlewares;
    },
    proxy: [
      ...(getConsoleURL() ? [{
        context: ['/api/helm'],
        target: getConsoleURL(),
        changeOrigin: true,
        secure: false,
        headers: {
          Authorization: `Bearer ${getOCToken()}`,
        },
      }] : []),
      {
        context: ['/api/kubernetes'],
        target: process.env.K8S_API_URL || 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
        ws: true,
        pathRewrite: (path: string) => path.replace(/^\/api\/kubernetes/, ''),
      },
      ...(process.env.THANOS_URL ? [{
        context: ['/api/prometheus'],
        target: process.env.THANOS_URL,
        changeOrigin: true,
        secure: false,
        pathRewrite: (path: string) => path.replace(/^\/api\/prometheus/, ''),
        headers: {
          Authorization: `Bearer ${getOCToken()}`,
        },
      }] : []),
      ...(() => {
        const agentToken = process.env.PULSE_AGENT_WS_TOKEN;
        return [{
          context: ['/api/agent'],
          target: process.env.PULSE_AGENT_URL || 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          ws: true,
          pathRewrite: (path: string) => {
            const stripped = path.replace(/^\/api\/agent/, '');
            if (!agentToken) return stripped;
            // WS connections need query-param token (no header support in browser WS API).
            // REST requests use Authorization header (added below) — query param kept
            // only for WS upgrade compatibility.
            if (stripped.startsWith('/ws/')) {
              const sep = stripped.includes('?') ? '&' : '?';
              return `${stripped}${sep}token=${agentToken}`;
            }
            return stripped;
          },
          ...(agentToken ? {
            headers: {
              'Authorization': `Bearer ${agentToken}`,
              'X-Forwarded-Access-Token': 'e2e-test-user',
            },
          } : {}),
        }];
      })(),
      ...(process.env.ALERTMANAGER_URL ? [{
        context: ['/api/alertmanager'],
        target: process.env.ALERTMANAGER_URL,
        changeOrigin: true,
        secure: false,
        pathRewrite: (path: string) => path.replace(/^\/api\/alertmanager/, ''),
        headers: {
          Authorization: `Bearer ${getOCToken()}`,
        },
      }] : []),
    ],
  },
  performance: {
    hints: false,
  },
  experiments: {
    css: true,
  },
});
