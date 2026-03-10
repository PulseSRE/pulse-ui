import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface QuickStartGuideProps {
  open: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to OpenShift',
    description:
      'The OpenShift Console provides a unified interface for managing your containerized applications, infrastructure resources, and cluster operations. Use it to deploy, monitor, and troubleshoot workloads across your cluster.',
  },
  {
    title: 'Navigate Resources',
    description:
      'The sidebar organizes resources into sections: Workloads for Pods, Deployments, and StatefulSets; Networking for Services, Routes, and Ingress; Storage for PersistentVolumes and Claims; and Administration for cluster-wide settings.',
  },
  {
    title: 'Deploy a Workload',
    description:
      'Use the "Deploy Workload" button in the header to quickly deploy a container image. Provide the image name, configure replicas and environment variables, then review and deploy in three simple steps.',
  },
  {
    title: 'Monitor Your Cluster',
    description:
      'Navigate to Observe > Cluster Health to view real-time metrics, resource utilization, and the overall health of your cluster. Check alerts, dashboards, and pod resource consumption from the Observe section.',
  },
  {
    title: 'Manage Security',
    description:
      'The Security section provides tools for RBAC auditing, network policy visualization, pod security standards enforcement, and secret rotation management. Keep your cluster secure with these built-in tools.',
  },
];

const QuickStartGuide: React.FC<QuickStartGuideProps> = ({ open, onClose }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) {
      setStep(0);
    }
  }, [open]);

  const handleNext = useCallback(() => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, []);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const currentStep = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="compass-deploy-overlay" />
        <Dialog.Content className="compass-deploy-content">
          <div className="compass-deploy-steps">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`compass-deploy-dot${i < step ? ' compass-deploy-dot--active' : ''}${i === step ? ' compass-deploy-dot--active' : ''}`}
              />
            ))}
          </div>

          <Dialog.Title className="compass-deploy-title">
            {currentStep.title}
          </Dialog.Title>

          <Dialog.Description className="compass-deploy-desc">
            Step {step + 1} of {STEPS.length}
          </Dialog.Description>

          <div className="compass-deploy-field">
            <p>{currentStep.description}</p>
          </div>

          <div className="compass-deploy-actions">
            {!isFirst && (
              <button
                type="button"
                className="compass-deploy-btn compass-deploy-btn--back"
                onClick={handleBack}
              >
                Back
              </button>
            )}

            {!isLast && (
              <button
                type="button"
                className="compass-deploy-btn compass-deploy-btn--next"
                onClick={handleNext}
              >
                Next
              </button>
            )}

            {isLast && (
              <button
                type="button"
                className="compass-deploy-btn compass-deploy-btn--deploy"
                onClick={onClose}
              >
                Done
              </button>
            )}
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className="compass-deploy-close"
              aria-label="Close"
              onClick={onClose}
            >
              &#x2715;
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default QuickStartGuide;
