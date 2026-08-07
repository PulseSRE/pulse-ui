import React from 'react';
import { cn } from '@/lib/utils';

interface InfoCardProps {
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
  className?: string;
}

export function InfoCard({ label, value, sub, onClick, className }: InfoCardProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'bg-slate-900 rounded-lg border border-slate-800 p-3 text-left',
        onClick && 'cursor-pointer hover:border-slate-600 transition-colors',
        className,
      )}
    >
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-100 wrap-break-word line-clamp-3">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5 wrap-break-word line-clamp-2">{sub}</div>}
    </Wrapper>
  );
}
