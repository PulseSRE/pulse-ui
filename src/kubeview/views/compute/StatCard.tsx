import React from 'react';
import { cn } from '@/lib/utils';

export function UsageBar({ pct, color, className }: { pct: number; color: 'green' | 'yellow' | 'red' | 'blue'; className?: string }) {
  const bg = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500', blue: 'bg-blue-500' }[color];
  return (
    <div className={cn('w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all', bg)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function StatCard({ label, value, subtitle, issues, bar, barColor, onClick }: {
  label: string; value: string; subtitle?: string; issues?: number; bar?: number | null; barColor?: 'green' | 'yellow' | 'red' | 'blue'; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3', onClick && 'cursor-pointer hover:border-slate-600', issues ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        {issues ? <span className="text-xs px-1.5 py-0.5 bg-red-900 text-red-300 rounded">{issues}</span> : null}
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
      {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      {bar !== null && bar !== undefined && <UsageBar pct={bar} color={barColor || 'blue'} className="mt-2" />}
    </div>
  );
}
