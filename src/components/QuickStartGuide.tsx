import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';

interface QuickStartGuideProps {
  open: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  description: string;
  action?: { label: string; href: string };
  tips?: string[];
}

const STEPS: Step[] = [
  {
    title: 'Welcome to OpenShift Console',
    description: 'Your cluster management dashboard — deploy apps, monitor health, troubleshoot issues, and manage access, all from one place.',
    tips: [
      'Press ⌘K (or Ctrl+K) anytime to open the Command Palette',
      'Search for any resource by name across the entire cluster',
      'Type commands like "restart pod nginx" or "scale deploy api to 3"',
    ],
  },
  {
    title: 'Dashboard — Your Starting Point',
    description: 'The Dashboard shows cluster health, firing alerts with one-click silence, CPU/memory utilization, node status, and recent events.',
    action: { label: 'Go to Dashboard', href: '/home/overview' },
    tips: [
      'Health score combines node readiness, pod health, and alert status',
      'Click "Deploy" to launch a container image in seconds',
      'Alerts can be silenced directly from the dashboard',
    ],
  },
  {
    title: 'Applications — Deploy & Manage',
    description: 'Everything about your workloads: Deployments, Pods, Services, Routes, Storage, Secrets, and CI/CD pipelines.',
    action: { label: 'Deploy Something', href: '/developer/add' },
    tips: [
      'Scale deployments with inline ± buttons — no detail page needed',
      'Restart or view logs for any pod with one click',
      'Create any resource with the "Create" button on each page',
    ],
  },
  {
    title: 'Observe — Monitor & Alert',
    description: 'Query Prometheus metrics with PromQL, view firing alerts, browse Grafana dashboards, and track resource usage by namespace.',
    action: { label: 'View Alerts', href: '/observe/alerts' },
    tips: [
      'Silence firing alerts directly from the alerts page',
      'Run PromQL queries on the Metrics page with live chart rendering',
      'Check Security Overview for RBAC audit and pod security compliance',
    ],
  },
  {
    title: 'Cluster — Nodes & Operations',
    description: 'Manage nodes (cordon, drain, uncordon), operators, cluster settings, updates, and TLS certificates.',
    action: { label: 'View Nodes', href: '/compute/nodes' },
    tips: [
      'Cordon and drain nodes directly from the Nodes page',
      'Certificate Management shows real X.509 expiry dates',
      'Download certificate PEM files or trigger renewal',
    ],
  },
  {
    title: 'Troubleshoot — Guided Diagnostics',
    description: 'Pick a namespace, scan for unhealthy resources, then drill into events, logs, and suggested fix actions.',
    action: { label: 'Start Troubleshooting', href: '/home/troubleshoot' },
    tips: [
      'Finds failing pods, high-restart containers, and degraded deployments',
      'Shows pod logs inline for quick diagnosis',
      'Suggests actions: Restart Pod, Scale Up, Check Logs',
    ],
  },
  {
    title: 'Keyboard Shortcuts',
    description: 'Power users can navigate the entire app without touching the mouse.',
    tips: [
      '⌘K / Ctrl+K — Open Command Palette',
      'Type resource names to search across all types',
      'Type "restart pod nginx" to execute actions from the palette',
      'Arrow keys + Enter to navigate palette results',
      'Esc — Close any dialog or palette',
    ],
  },
];

const QuickStartGuide: React.FC<QuickStartGuideProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const handleNext = useCallback(() => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, []);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleAction = useCallback((href: string) => {
    onClose();
    navigate(href);
  }, [onClose, navigate]);

  const currentStep = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="compass-deploy-overlay os-deploy__overlay" />
        <Dialog.Content className="compass-deploy-content os-deploy__content">
          <div className="compass-deploy-steps os-deploy__steps">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`compass-deploy-dot os-deploy__dot${i <= step ? ' compass-deploy-dot--active os-deploy__dot--active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setStep(i)}
              />
            ))}
          </div>

          <Dialog.Title className="compass-deploy-title os-deploy__title">
            {currentStep.title}
          </Dialog.Title>

          <Dialog.Description className="compass-deploy-desc os-deploy__desc">
            Step {step + 1} of {STEPS.length}
          </Dialog.Description>

          <div style={{ margin: '16px 0' }}>
            <p style={{ lineHeight: 1.6, marginBottom: 12 }}>{currentStep.description}</p>

            {currentStep.tips && currentStep.tips.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {currentStep.tips.map((tip, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{tip}</li>
                ))}
              </ul>
            )}

            {currentStep.action && (
              <button
                type="button"
                className="compass-deploy-btn compass-deploy-btn--next os-deploy__btn--next"
                style={{ marginTop: 16 }}
                onClick={() => handleAction(currentStep.action!.href)}
              >
                {currentStep.action.label} →
              </button>
            )}
          </div>

          <div className="compass-deploy-actions os-deploy__actions">
            {!isFirst && (
              <button type="button" className="compass-deploy-btn compass-deploy-btn--back os-deploy__btn--back" onClick={handleBack}>
                Back
              </button>
            )}
            {!isLast && (
              <button type="button" className="compass-deploy-btn compass-deploy-btn--next os-deploy__btn--next" onClick={handleNext}>
                Next
              </button>
            )}
            {isLast && (
              <button type="button" className="compass-deploy-btn compass-deploy-btn--deploy os-deploy__btn--deploy" onClick={onClose}>
                Get Started
              </button>
            )}
          </div>

          <Dialog.Close asChild>
            <button type="button" className="compass-deploy-close os-deploy__close" aria-label="Close" onClick={onClose}>
              &#x2715;
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default QuickStartGuide;
