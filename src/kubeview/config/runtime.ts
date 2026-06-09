interface HelmInstallRuntimeConfig {
  runnerImage?: string;
  serviceAccountName?: string;
}

interface OpenShiftPulseRuntimeConfig {
  helmInstall?: HelmInstallRuntimeConfig;
}

declare global {
  interface Window {
    __OPENSHIFTPULSE_CONFIG__?: OpenShiftPulseRuntimeConfig;
  }
}

export function getHelmInstallRuntimeConfig(): Required<HelmInstallRuntimeConfig> {
  return {
    runnerImage: window.__OPENSHIFTPULSE_CONFIG__?.helmInstall?.runnerImage ?? '',
    serviceAccountName: window.__OPENSHIFTPULSE_CONFIG__?.helmInstall?.serviceAccountName ?? 'openshiftpulse-helm-installer',
  };
}
