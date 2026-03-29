import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
}

export function Dropdown({ trigger, items, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const selectableItems = items.filter((item) => !item.separator && !item.disabled);

      switch (e.key) {
        case 'Escape':
          setOpen(false);
          setActiveIndex(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => {
            const nextIndex = prev + 1;
            if (nextIndex >= selectableItems.length) return 0;
            return nextIndex;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => {
            const nextIndex = prev - 1;
            if (nextIndex < 0) return selectableItems.length - 1;
            return nextIndex;
          });
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < selectableItems.length) {
            const item = selectableItems[activeIndex];
            item.onClick();
            setOpen(false);
            setActiveIndex(-1);
          }
          break;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, items, activeIndex]);

  const handleToggle = () => {
    setOpen(!open);
    setActiveIndex(-1);
  };

  const selectableItems = items.filter((item) => !item.separator && !item.disabled);

  return (
    <div ref={dropdownRef} className="relative">
      <div onClick={handleToggle}>{trigger}</div>

      {open && (
        <div
          className={cn(
            'absolute top-full z-50 mt-2 min-w-[200px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item, _index) => {
            if (item.separator) {
              return <div key={item.id} className="my-1 border-t border-slate-700" />;
            }

            const selectableIndex = selectableItems.findIndex((i) => i.id === item.id);
            const isActive = selectableIndex === activeIndex;

            return (
              <button
                key={item.id}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick();
                    setOpen(false);
                    setActiveIndex(-1);
                  }
                }}
                disabled={item.disabled}
                className={cn(
                  'flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors',
                  item.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-slate-300 hover:bg-slate-700',
                  item.disabled && 'cursor-not-allowed opacity-50',
                  isActive && !item.disabled && 'bg-slate-700'
                )}
              >
                {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
