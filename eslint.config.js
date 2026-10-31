import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import pulse from './eslint-rules/pulse-guardrails.js';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  // Shared building blocks stay shared (Wave 5a). Primitives and the engine
  // own these; pages use them. Files below still carry a private copy and are
  // allowlisted with the wave that owns their migration — remove an entry when
  // its file is migrated, never add one.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/kubeview/components/primitives/**', 'src/kubeview/engine/**', 'src/**/__tests__/**', 'src/**/*.test.*'],
    plugins: { pulse },
    rules: {
      'pulse/no-private-stat-primitives': 'error',
      'pulse/no-inline-status-colors': 'error',
      'no-restricted-globals': ['error', { name: 'confirm', message: 'Use ConfirmDialog (components/feedback) instead of window.confirm.' }],
      'no-restricted-properties': ['error', { object: 'window', property: 'confirm', message: 'Use ConfirmDialog (components/feedback) instead of window.confirm.' }],
    },
  },
  {
    files: [
      'src/kubeview/views/admin/CertificatesTab.tsx', // Wave 7b (admin ops): StatusDot
      'src/kubeview/views/pulse/ReportTab.tsx', // Wave 6 (dedup/regroup): StatusDot
      'src/kubeview/views/PulseView.tsx', // Wave 6 (dedup/regroup): StatPill
    ],
    rules: { 'pulse/no-private-stat-primitives': 'off' },
  },
  {
    files: [
      'src/kubeview/components/agent/AgentBlastRadius.tsx', // Wave 8 (graphs)
      'src/kubeview/components/topology/overlays/PodGrid.tsx', // Wave 8 (graphs)
      'src/kubeview/components/topology/GraphRenderer.tsx', // Wave 8 (graphs)
      'src/kubeview/components/topology/constants.ts', // Wave 8 (graphs)
      'src/kubeview/views/TopologyView.tsx', // Wave 8 (graphs)
      'src/kubeview/views/argocd/RolloutsTab.tsx', // Wave 7a (workload actions)
      'src/kubeview/views/compute/NodeHexMap.tsx', // Wave 7a (node actions)
      'src/kubeview/views/mission-control/ScannerDrawer.tsx', // Wave 6 (dedup/regroup)
      'src/kubeview/views/inbox/InboxItem.tsx', // Wave 7c (inbox/fix actions)
      'src/kubeview/components/agent/FindingCard.tsx', // Wave 7c (inbox/fix actions)
    ],
    rules: { 'pulse/no-inline-status-colors': 'off' },
  },
  {
    files: ['src/kubeview/views/inbox/DurableRunControls.tsx'], // Wave 7c (inbox/fix actions)
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    ignores: ['dist', 'node_modules', '.rspack_cache'],
  },
];
