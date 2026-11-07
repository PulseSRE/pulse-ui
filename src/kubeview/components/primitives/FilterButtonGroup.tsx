import { cn } from '@/lib/utils';

interface FilterOption {
  key: string | null;
  label: string;
}

interface FilterButtonGroupProps {
  options: FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  colorScheme?: 'blue' | 'amber';
}

const SCHEMES = {
  blue: 'bg-blue-600/20 text-blue-300 border-blue-700/50',
  amber: 'bg-amber-600/20 text-amber-300 border-amber-700/50',
};

export function FilterButtonGroup({ options, value, onChange, colorScheme = 'blue' }: FilterButtonGroupProps) {
  return (
    <>
      {options.map((opt) => (
        <button
          key={opt.key ?? '__all__'}
          onClick={() => onChange(opt.key)}
          className={cn(
            'px-2.5 py-1.5 rounded-lg text-xs transition-colors border',
            value === opt.key
              ? SCHEMES[colorScheme]
              : 'text-slate-500 hover:text-slate-300 border-slate-700/30 hover:border-slate-600',
          )}
        >
          {opt.label}
        </button>
      ))}
    </>
  );
}
