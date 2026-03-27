import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useArgoCDStore } from './argoCDStore';
import { k8sGet } from '../engine/query';

export type WizardStep = 'operator' | 'git-config' | 'select-resources' | 'first-app' | 'done';

interface ExportSelections {
  clusterName: string;
  categoryIds: string[];
  namespaces: string[];
  exportMode: 'pr' | 'direct';
}

interface GitOpsSetupState {
  wizardOpen: boolean;
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  dismissed: boolean;

  operatorPhase: 'idle' | 'creating' | 'pending' | 'installing' | 'succeeded' | 'failed';
  operatorError: string | null;

  exportSelections: ExportSelections;

  openWizard: (resumeAt?: WizardStep) => void;
  closeWizard: () => void;
  setStep: (step: WizardStep) => void;
  markStepComplete: (step: WizardStep) => void;
  setOperatorPhase: (phase: GitOpsSetupState['operatorPhase'], error?: string) => void;
  setExportSelections: (selections: Partial<ExportSelections>) => void;
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

      exportSelections: {
        clusterName: '',
        categoryIds: ['workloads', 'networking', 'config', 'storage'],
        namespaces: [],
        exportMode: 'pr',
      },

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

      setExportSelections: (selections) =>
        set((state) => ({
          exportSelections: { ...state.exportSelections, ...selections },
        })),

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
          resumeStep = 'select-resources';
        } catch {
          // Not configured
        }

        // Check if apps exist
        if (useArgoCDStore.getState().applications.length > 0) {
          completed.push('select-resources');
          completed.push('first-app');
          resumeStep = 'done';
        }

        set({ completedSteps: completed, currentStep: completed.length === 4 ? 'done' : resumeStep });
      },
    }),
    {
      name: 'openshiftpulse-gitops-setup',
      partialize: (state) => ({
        completedSteps: state.completedSteps,
        dismissed: state.dismissed,
      }),
    },
  ),
);
