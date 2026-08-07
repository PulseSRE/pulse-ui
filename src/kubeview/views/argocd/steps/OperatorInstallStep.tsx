import React from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useOperatorInstall, type InstallPhase } from '../../../hooks/useOperatorInstall';
import { useArgoCDStore } from '../../../store/argoCDStore';
import { useGitOpsSetupStore } from '../../../store/gitopsSetupStore';
import { cn } from '@/lib/utils';

interface Props {
  onComplete: () => void;
}

const PHASE_LABELS: Record<InstallPhase, string> = {
  idle: '',
  creating: 'Creating subscription...',
  pending: 'Waiting for install plan...',
  installing: 'Installing operator...',
  succeeded: 'OpenShift GitOps is ready!',
  failed: 'Installation failed',
};

export function OperatorInstallStep({ onComplete }: Props) {
  // Check if already installed
  const argoAvailable = useArgoCDStore((s) => s.available);
  const markComplete = useGitOpsSetupStore((s) => s.markStepComplete);
  const { install, phase, error, reset } = useOperatorInstall();

  // Auto-advance if already installed
  React.useEffect(() => {
    if (argoAvailable) {
      markComplete('operator');
      const timer = setTimeout(onComplete, 1000);
      return () => clearTimeout(timer);
    }
  }, [argoAvailable]);

  // Auto-advance on success
  React.useEffect(() => {
    if (phase === 'succeeded') {
      markComplete('operator');
      let cancelled = false;
      (async () => {
        await useArgoCDStore.getState().detect();
        if (!cancelled) onComplete();
      })();
      return () => { cancelled = true; };
    }
  }, [phase]);

  const handleInstall = () => {
    install({
      packageName: 'openshift-gitops-operator',
      channel: 'latest',
      source: 'redhat-operators',
      sourceNamespace: 'openshift-marketplace',
      targetNamespace: 'openshift-operators',
    });
  };

  if (argoAvailable) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
        <h3 className="text-lg font-medium text-slate-100">OpenShift GitOps is installed</h3>
        <p className="text-sm text-slate-400 mt-2">Proceeding to next step...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-slate-100">Install OpenShift GitOps</h3>
        <p className="text-sm text-slate-400 mt-1">
          This will install the OpenShift GitOps operator, which deploys ArgoCD in the
          <code className="text-xs bg-slate-800 px-1 py-0.5 rounded-sm mx-1">openshift-gitops</code> namespace.
        </p>
      </div>

      {phase === 'idle' && (
        <button
          onClick={handleInstall}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Install OpenShift GitOps
        </button>
      )}

      {phase !== 'idle' && phase !== 'failed' && (
        <div className="flex items-center gap-3">
          {phase === 'succeeded' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : (
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          )}
          <span className={cn('text-sm', phase === 'succeeded' ? 'text-emerald-400' : 'text-slate-300')}>
            {PHASE_LABELS[phase]}
          </span>
        </div>
      )}

      {phase === 'failed' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error || 'Installation failed'}
          </div>
          <button onClick={() => reset()} className="text-sm text-blue-400 hover:text-blue-300">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
