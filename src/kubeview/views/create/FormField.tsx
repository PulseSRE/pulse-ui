export function FormField({ label, value, onChange, placeholder, required, type }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      <input type={type || 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
    </div>
  );
}
