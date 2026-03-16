import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import ReactRefreshPlugin from '@rspack/plugin-react-refresh';
import { execSync } from 'child_process';
import path from 'path';

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
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: 'asset',
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: './public/index.html',
      title: 'OpenShift Console',
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
          const target = repoUrl.endsWith('/index.yaml') ? repoUrl : `${repoUrl.replace(/\/$/, '')}/index.yaml`;
          const response = await fetch(target, { signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw new Error(`${response.status}`);
          const text = await response.text();
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
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
        pathRewrite: (path: string) => path.replace(/^\/api\/kubernetes/, ''),
      },
      {
        context: ['/api/prometheus'],
        target: process.env.THANOS_URL || 'https://thanos-querier-openshift-monitoring.apps.rhamilto.devcluster.openshift.com',
        changeOrigin: true,
        secure: false,
        pathRewrite: (path: string) => path.replace(/^\/api\/prometheus/, ''),
        headers: {
          Authorization: `Bearer ${getOCToken()}`,
        },
      },
      {
        context: ['/api/alertmanager'],
        target: process.env.ALERTMANAGER_URL || 'https://alertmanager-main-openshift-monitoring.apps.rhamilto.devcluster.openshift.com',
        changeOrigin: true,
        secure: false,
        pathRewrite: (path: string) => path.replace(/^\/api\/alertmanager/, ''),
        headers: {
          Authorization: `Bearer ${getOCToken()}`,
        },
      },
    ],
  },
  performance: {
    hints: false,
  },
  experiments: {
    css: true,
  },
});
