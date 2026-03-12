import React from 'react';
import {
  Dropdown,
  DropdownItem,
  MenuToggle,
  DropdownList,
} from '@patternfly/react-core';
import { PaletteIcon } from '@patternfly/react-icons';


export type ThemeName = 'sunset' | 'ocean' | 'slate' | 'forest' | 'patternfly';

interface ThemePickerProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

const themes = [
  {
    name: 'sunset' as const,
    label: 'Sunset Gradient',
    description: 'Warm oranges, corals, and pinks',
  },
  {
    name: 'ocean' as const,
    label: 'Ocean Blue',
    description: 'Cool blues and teals',
  },
  {
    name: 'slate' as const,
    label: 'Midnight Slate',
    description: 'Deep navy and slate grays',
  },
  {
    name: 'forest' as const,
    label: 'Forest Teal',
    description: 'Emerald greens and teals',
  },
  {
    name: 'patternfly' as const,
    label: 'PatternFly Classic',
    description: 'Traditional PatternFly blues',
  },
];

export default function ThemePicker({ currentTheme, onThemeChange }: ThemePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const onToggle = () => {
    setIsOpen(!isOpen);
  };

  const onSelect = (theme: ThemeName) => {
    onThemeChange(theme);
    setIsOpen(false);
  };

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          onClick={onToggle}
          variant="plain"
          aria-label="Theme picker"
        >
          <PaletteIcon />
        </MenuToggle>
      )}
    >
      <DropdownList>
        {themes.map((theme) => (
          <DropdownItem
            key={theme.name}
            onClick={() => onSelect(theme.name)}
            description={theme.description}
            isSelected={currentTheme === theme.name}
          >
            {theme.label}
          </DropdownItem>
        ))}
      </DropdownList>
    </Dropdown>
  );
}
