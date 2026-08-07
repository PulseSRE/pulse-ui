import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineSpinnerProps {
  size?: 'sm' | 'md';
  className?: string;
}

export function InlineSpinner({ size = 'md', className }: InlineSpinnerProps) {
  return (
    <Loader2
      className={cn(
        'animate-spin text-slate-400',
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
        className
      )}
    />
  );
}

interface SuccessFlashProps {
  children?: React.ReactNode;
  duration?: number;
}

export function SuccessFlash({ children, duration = 2000 }: SuccessFlashProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-emerald-500 transition-opacity duration-300',
        !visible && 'opacity-0'
      )}
    >
      <CheckCircle2 className="h-5 w-5" />
      {children && <span className="text-sm font-medium">{children}</span>}
    </div>
  );
}

interface ErrorIndicatorProps {
  message: string;
  className?: string;
}

export function ErrorIndicator({ message, className }: ErrorIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2 text-red-500', className)}>
      <XCircle className="h-5 w-5 shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-slate-700',
        className
      )}
    />
  );
}

interface SkeletonRowProps {
  columns: number;
}

export function SkeletonRow({ columns }: SkeletonRowProps) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </div>
  );
}
