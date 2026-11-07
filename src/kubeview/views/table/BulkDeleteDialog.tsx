import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import type { K8sResource } from '../../engine/renderers';

interface BulkDeleteDialogProps {
  /** Selected rows the current search/filter shows. */
  visible: K8sResource[];
  /** Selected rows a search or column filter now hides. */
  hidden: K8sResource[];
  onConfirm: (targets: K8sResource[]) => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

function label(r: K8sResource): string {
  return r.metadata.namespace ? `${r.metadata.namespace}/${r.metadata.name}` : r.metadata.name;
}

/**
 * Confirm a bulk delete by listing exactly what will be deleted.
 *
 * A selection survives a search, so rows picked before the search could be
 * out of sight when Delete is pressed. Those are only deleted when the user
 * explicitly includes them here; by default the hidden ones are left alone.
 */
export function BulkDeleteDialog({ visible, hidden, onConfirm, onClose, loading = false }: BulkDeleteDialogProps) {
  const [includeHidden, setIncludeHidden] = useState(false);
  const targets = includeHidden ? [...visible, ...hidden] : visible;
  const n = targets.length;
  const noun = `resource${n === 1 ? '' : 's'}`;

  return (
    <ConfirmDialog
      open
      title={`Delete ${n} ${noun}?`}
      description={n === 0
        ? 'None of the selected rows are shown by the current search. Include them below to delete them.'
        : `These ${n === 1 ? 'is' : 'are'} the ${noun} that will be deleted. This cannot be undone.`}
      confirmLabel={`Delete ${n} ${noun}`}
      variant="danger"
      loading={loading}
      confirmDisabled={n === 0}
      onConfirm={() => { void onConfirm(targets); }}
      onClose={onClose}
    >
      <ul aria-label="Resources to delete" className="max-h-48 overflow-y-auto rounded border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-200">
        {targets.map((r) => (
          <li key={r.metadata.uid ?? label(r)} className="truncate py-0.5">
            <span className="text-slate-400">{r.kind ? `${r.kind} ` : ''}</span>{label(r)}
          </li>
        ))}
        {n === 0 && <li className="py-0.5 font-sans text-slate-400">Nothing will be deleted.</li>}
      </ul>
      {hidden.length > 0 && (
        <div role="note" className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-1.5 font-medium">
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            {hidden.length} selected {hidden.length === 1 ? 'row is' : 'rows are'} hidden by your search
          </div>
          <p className="mt-1 text-amber-300/80">
            {includeHidden ? 'They are included in the list above.' : 'They will not be deleted unless you include them.'}
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-amber-100">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
              disabled={loading}
            />
            Also delete the {hidden.length} hidden {hidden.length === 1 ? 'row' : 'rows'}
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}
