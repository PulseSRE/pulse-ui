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

function getGCPToken(): string {
  if (process.env.GCP_ACCESS_TOKEN) return process.env.GCP_ACCESS_TOKEN;
  try {
    return execSync('gcloud auth print-access-token 2>/dev/null', { encoding: 'utf-8' }).trim();
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
    historyApiFallback: true,
    open: true,
    proxy: [
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
      {
        context: ['/api/ai'],
        target: `https://${process.env.ANTHROPIC_VERTEX_REGION || 'us-east5'}-aiplatform.googleapis.com`,
        changeOrigin: true,
        secure: true,
        pathRewrite: () => {
          const project = process.env.ANTHROPIC_VERTEX_PROJECT_ID || 'itpc-gcp-product-all-claude';
          const region = process.env.ANTHROPIC_VERTEX_REGION || 'us-east5';
          const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6@20250514';
          return `/v1/projects/${project}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;
        },
        headers: {
          Authorization: `Bearer ${getGCPToken()}`,
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
