import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_CLASSES } from '../../engine/statusColors';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'outline';
  size?: 'sm' | 'md';
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  removable = false,
  onRemove,
  className,
}: BadgeProps) {
  const variantClasses = {
    default: 'bg-slate-700 text-slate-200',
    success: TONE_CLASSES.success.chip,
    warning: TONE_CLASSES.warning.chip,
    error: TONE_CLASSES.danger.chip,
    info: TONE_CLASSES.info.chip,
    outline: 'border border-slate-600 text-slate-300',
  };

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
      {removable && onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 rounded-full transition-colors hover:bg-white/10"
          aria-label="Remove"
        >
          <X className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
      )}
    </span>
  );
}
