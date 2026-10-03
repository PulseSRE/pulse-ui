import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Isolated component/network acceptance: never starts Pulse, containers or a cluster.
export default mergeConfig(base, defineConfig({
  test: {
    include: [
      'src/kubeview/__tests__/release-safety.acceptance.test.tsx',
      'src/kubeview/__tests__/cluster-scope.integration.test.tsx',
      'src/kubeview/hooks/__tests__/useK8sListWatch.test.ts',
      'src/kubeview/engine/__tests__/agentClient-reconnect.test.ts',
      'src/kubeview/views/mission-control/__tests__/TrustPolicy.test.tsx',
    ],
    passWithNoTests: false,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/ui-acceptance.xml' },
  },
}));
