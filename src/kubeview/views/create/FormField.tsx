import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * A labelled text input. The label is linked to the input (htmlFor/id), so
 * screen readers announce it and tests can find the input by its label.
 */
export function FormField({ label, value, onChange, placeholder, required, type, mono, list, className }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; type?: string;
  /** Monospace input, for names, paths and images. */
  mono?: boolean;
  /** id of a <datalist> with suggestions. */
  list?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-xs text-slate-400 block mb-1">{label}{required && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}</label>
      <input id={id} type={type || 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} list={list} required={required}
        className={cn('w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500', mono && 'font-mono')} />
    </div>
  );
}
