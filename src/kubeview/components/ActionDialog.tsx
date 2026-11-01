/**
 * One confirmation flow for state-changing actions.
 *
 * `open(spec)` shows a dialog that says exactly what will happen (with
 * optional inputs, e.g. a replica count) and pins the cluster that was
 * active when it opened. Confirming writes to that cluster only; if the
 * active cluster changed meanwhile, nothing is sent and the dialog says why.
 * A failed write stays on screen in the dialog, so the user
 * sees what the server said and can retry or cancel.
 */
import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from './feedback/ConfirmDialog';
import { Input } from './primitives/Input';
import { useUIStore } from '../store/uiStore';
import { getActiveClusterId } from '../engine/clusterConnection';
import { assertActiveCluster } from '../engine/pendingCluster';
import { PulseError } from '../engine/errors';

export interface ActionInput {
  id: string;
  label: string;
  initial: string;
  type?: 'text' | 'number';
  placeholder?: string;
  readOnly?: boolean;
  min?: number;
  /** Why the value is not acceptable, or null. */
  validate?: (value: string, all: Record<string, string>) => string | null;
}

export interface ActionSpec {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'danger' | 'warning';
  inputs?: ActionInput[];
  /** An extra warning that depends on the inputs (e.g. scaling to 0). */
  warning?: (values: Record<string, string>) => string | null;
  /** Shown in the "cluster changed" refusal: "<what> was not run…". */
  what?: string;
  /** Extra content under the description (lists, notes). */
  body?: React.ReactNode;
  run: (clusterId: string, values: Record<string, string>) => Promise<unknown>;
  success: string | ((values: Record<string, string>) => string);
  successDetail?: string;
  onDone?: () => void;
}

/** A readable sentence for a failed write. */
export function describeWriteError(err: unknown): string {
  if (err instanceof PulseError) {
    if (err.statusCode === 409 || (err.statusCode === 422 && /test|resourceVersion/i.test(err.message))) {
      return 'The object changed since this page loaded it, so nothing was changed. Reload and try again.';
    }
    if (err.statusCode === 403) return `Permission denied: ${err.message}`;
    return err.message || err.userMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

interface Pending { spec: ActionSpec; clusterId: string }

export function useActionDialog(): { open: (spec: ActionSpec) => void; dialog: React.ReactNode } {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const [pending, setPending] = useState<Pending | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback((spec: ActionSpec) => {
    setValues(Object.fromEntries((spec.inputs ?? []).map((i) => [i.id, i.initial])));
    setError(null);
    // Pinned now: switching clusters while this is open must not retarget it.
    setPending({ spec, clusterId: getActiveClusterId() });
  }, []);

  const close = useCallback(() => { if (!busy) setPending(null); }, [busy]);

  const inputErrors = pending
    ? Object.fromEntries((pending.spec.inputs ?? []).map((i) => [i.id, i.validate?.(values[i.id] ?? '', values) ?? null]))
    : {};
  const invalid = Object.values(inputErrors).some(Boolean);

  const confirm = async () => {
    if (!pending || invalid) return;
    const { spec, clusterId } = pending;
    setBusy(true);
    setError(null);
    try {
      assertActiveCluster(clusterId, spec.what ?? spec.title);
      await spec.run(clusterId, values);
      addToast({ type: 'success', title: typeof spec.success === 'function' ? spec.success(values) : spec.success, detail: spec.successDetail });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['detail'] });
      setPending(null);
      spec.onDone?.();
    } catch (err) {
      const message = describeWriteError(err);
      setError(`${spec.confirmLabel} failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const warning = pending?.spec.warning?.(values) ?? null;

  // Portalled: a menu inside a transformed (virtualized) row would otherwise
  // position the "fixed" dialog relative to that row.
  const dialog = pending ? createPortal(
    <ConfirmDialog
      open
      title={pending.spec.title}
      description={pending.spec.description}
      confirmLabel={pending.spec.confirmLabel}
      variant={pending.spec.variant ?? 'warning'}
      loading={busy}
      onClose={close}
      onConfirm={confirm}
      confirmDisabled={invalid}
    >
      {pending.spec.body}
      {(pending.spec.inputs ?? []).length > 0 && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void confirm(); }}
        >
          {pending.spec.inputs!.map((input, idx) => (
            <div key={input.id}>
              <label htmlFor={`action-input-${input.id}`} className="block text-xs text-slate-400 mb-1">{input.label}</label>
              <Input
                id={`action-input-${input.id}`}
                type={input.type ?? 'text'}
                min={input.min}
                inputSize="sm"
                value={values[input.id] ?? ''}
                readOnly={input.readOnly}
                placeholder={input.placeholder}
                autoFocus={idx === 0 && !input.readOnly}
                variant={inputErrors[input.id] ? 'error' : 'default'}
                aria-invalid={!!inputErrors[input.id]}
                onChange={(e) => setValues((v) => ({ ...v, [input.id]: e.target.value }))}
              />
              {inputErrors[input.id] && <p className="mt-1 text-xs text-red-400">{inputErrors[input.id]}</p>}
            </div>
          ))}
          <button type="submit" hidden />
        </form>
      )}
      {warning && <p role="alert" className="mt-3 text-xs text-amber-300">{warning}</p>}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}
    </ConfirmDialog>,
    document.body,
  ) : null;

  return { open, dialog };
}
