import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useArgoCDStore } from './argoCDStore';
import { k8sGet } from '../engine/query';

export type WizardStep = 'operator' | 'git-config' | 'first-app' | 'select-resources' | 'export' | 'done';

interface ExportProgress {
  category: string;
  totalFiles: number;
  committedFiles: number;
  errors: string[];
}

interface GitOpsSetupState {
  wizardOpen: boolean;
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  dismissed: boolean;

  operatorPhase: 'idle' | 'creating' | 'pending' | 'installing' | 'succeeded' | 'failed';
  operatorError: string | null;

  selectedCategories: string[];
  selectedNamespaces: string[];
  clusterName: string;
  exportProgress: ExportProgress | null;
  exportMode: 'direct-commit' | 'pull-request';

  openWizard: (resumeAt?: WizardStep) => void;
  closeWizard: () => void;
  setStep: (step: WizardStep) => void;
  markStepComplete: (step: WizardStep) => void;
  setOperatorPhase: (phase: GitOpsSetupState['operatorPhase'], error?: string) => void;
  setSelectedCategories: (categories: string[]) => void;
  setSelectedNamespaces: (namespaces: string[]) => void;
  setClusterName: (name: string) => void;
  setExportProgress: (progress: ExportProgress | null) => void;
  setExportMode: (mode: 'direct-commit' | 'pull-request') => void;
  detectCompletedSteps: () => Promise<void>;
}

export const useGitOpsSetupStore = create<GitOpsSetupState>()(
  persist(
    (set, get) => ({
      wizardOpen: false,
      currentStep: 'operator',
      completedSteps: [],
      dismissed: false,
      operatorPhase: 'idle',
      operatorError: null,

      selectedCategories: ['cluster-config', 'operators'],
      selectedNamespaces: [],
      clusterName: '',
      exportProgress: null,
      exportMode: 'pull-request',

      openWizard: (resumeAt) => {
        const step = resumeAt || get().currentStep;
        set({ wizardOpen: true, currentStep: step, dismissed: false });
      },

      closeWizard: () => set({ wizardOpen: false }),

      setStep: (step) => set({ currentStep: step }),

      markStepComplete: (step) => {
        const completed = get().completedSteps;
        if (!completed.includes(step)) {
          set({ completedSteps: [...completed, step] });
        }
      },

      setOperatorPhase: (phase, error) =>
        set({ operatorPhase: phase, operatorError: error || null }),

      setSelectedCategories: (categories) => set({ selectedCategories: categories }),
      setSelectedNamespaces: (namespaces) => set({ selectedNamespaces: namespaces }),
      setClusterName: (name) => set({ clusterName: name }),
      setExportProgress: (progress) => set({ exportProgress: progress }),
      setExportMode: (mode) => set({ exportMode: mode }),

      detectCompletedSteps: async () => {
        const completed: WizardStep[] = [];
        let resumeStep: WizardStep = 'operator';

        // Check operator
        const argoStore = useArgoCDStore.getState();
        if (!argoStore.detected) {
          await argoStore.detect();
        }
        if (useArgoCDStore.getState().available) {
          completed.push('operator');
          resumeStep = 'git-config';
        }

        // Check git config (K8s Secret)
        try {
          await k8sGet('/api/v1/namespaces/openshiftpulse/secrets/openshiftpulse-gitops-config');
          completed.push('git-config');
          resumeStep = 'first-app';
        } catch {
          // Not configured
        }

        // Check if apps exist
        if (useArgoCDStore.getState().applications.length > 0) {
          completed.push('first-app');
          resumeStep = 'done';
        }

        set({ completedSteps: completed, currentStep: completed.length === 3 ? 'done' : resumeStep });
      },
    }),
    {
      name: 'openshiftpulse-gitops-setup',
      partialize: (state) => ({
        completedSteps: state.completedSteps,
        dismissed: state.dismissed,
        selectedCategories: state.selectedCategories,
        selectedNamespaces: state.selectedNamespaces,
        clusterName: state.clusterName,
        exportMode: state.exportMode,
      }),
    },
  ),
);
