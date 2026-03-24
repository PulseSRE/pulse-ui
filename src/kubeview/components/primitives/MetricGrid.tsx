import React from 'react';
import { cn } from '@/lib/utils';

export function MetricGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>
      {children}
    </div>
  );
}
