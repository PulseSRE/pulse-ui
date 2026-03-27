import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useArgoCDStore } from './argoCDStore';
import { k8sGet } from '../engine/query';

export type WizardStep = 'operator' | 'git-config' | 'select-resources' | 'export' | 'first-app' | 'done';

export interface ExportSelections {
  clusterName: string;
  categoryIds: string[];
  namespaces: string[];
  exportMode: 'pr' | 'direct';
}

export interface ExportSummary {
  resourceCount: number;
  categories: string[];
  namespaces: string[];
  prUrl?: string;
  clusterName: string;
}

interface GitOpsSetupState {
  wizardOpen: boolean;
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  dismissed: boolean;

  operatorPhase: 'idle' | 'creating' | 'pending' | 'installing' | 'succeeded' | 'failed';
  operatorError: string | null;

  /** Categories selected for app-of-apps export (e.g. 'deployments', 'services') */
  selectedCategories: string[];
  /** Namespaces to export for app-of-apps pattern */
  selectedNamespaces: string[];
  /** Summary of the last export */
  exportSummary: ExportSummary | null;
  /** Selections for export step */
  exportSelections: ExportSelections;

  openWizard: (resumeAt?: WizardStep) => void;
  closeWizard: () => void;
  setStep: (step: WizardStep) => void;
  markStepComplete: (step: WizardStep) => void;
  setOperatorPhase: (phase: GitOpsSetupState['operatorPhase'], error?: string) => void;
  setSelectedCategories: (categories: string[]) => void;
  setSelectedNamespaces: (namespaces: string[]) => void;
  setExportSummary: (summary: ExportSummary) => void;
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

      selectedCategories: [],
      selectedNamespaces: [],
      exportSummary: null,
      exportSelections: { clusterName: '', categoryIds: ['cluster-config', 'operators'], namespaces: [], exportMode: 'pr' },

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
      setExportSummary: (summary) => set({ exportSummary: summary }),
      setExportSelections: (partial) => set((s) => ({ exportSelections: { ...s.exportSelections, ...partial } })),

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
      }),
    },
  ),
);
