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
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'Use ConfirmDialog (components/feedback) instead of window.confirm.' },
        { object: 'globalThis', property: 'confirm', message: 'Use ConfirmDialog (components/feedback) instead of globalThis.confirm.' },
        { object: 'self', property: 'confirm', message: 'Use ConfirmDialog (components/feedback) instead of self.confirm.' },
      ],
    },
  },
  // Colour tokens (consistency 8/12). Everywhere, primitives and engine
  // included: warning is amber, never yellow, and muted text uses the
  // text-muted / text-faint tokens, which meet WCAG AA on the dark surfaces.
  // scripts/codemods/text-tokens.mjs fixes what these report. There is no
  // file allowlist: a deliberate exception carries its own
  // `eslint-disable-next-line pulse/<rule> -- <why>` comment.
  {
    files: ['src/**/*.{ts,tsx}'],
    // views/ is migrated by part 2 of this change (the same codemod); remove
    // 'src/kubeview/views/**' from this list there.
    ignores: ['src/**/__tests__/**', 'src/**/*.test.*', 'src/kubeview/views/**'],
    plugins: { pulse },
    rules: {
      'pulse/no-yellow': 'error',
      'pulse/no-low-contrast-text': 'error',
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
      'src/kubeview/components/topology/constants.ts', // Wave 8 (graphs)
      'src/kubeview/views/TopologyView.tsx', // Wave 8 (graphs)
      'src/kubeview/views/TimelineView.tsx', // Wave 8 (graphs)
      'src/kubeview/views/argocd/RolloutsTab.tsx', // consistency 8/12, part 2
      'src/kubeview/views/compute/NodeHexMap.tsx', // consistency 8/12, part 2
      'src/kubeview/views/mission-control/ScannerDrawer.tsx', // consistency 8/12, part 2
      'src/kubeview/views/inbox/InboxItem.tsx', // consistency 8/12, part 2
      'src/kubeview/views/inbox/InboxGroup.tsx', // consistency 8/12, part 2
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
