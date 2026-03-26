/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { ProgressModal } from '../feedback/ProgressModal';
import { InlineSpinner, SuccessFlash, ErrorIndicator, Skeleton } from '../feedback/InlineFeedback';
import { Badge } from '../primitives/Badge';
import { EmptyState } from '../primitives/EmptyState';
import { SearchInput } from '../primitives/SearchInput';
import { Dropdown } from '../primitives/Dropdown';

describe('Feedback Components', () => {
  it('renders ConfirmDialog when open', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete resource?"
        description="This cannot be undone."
      />
    );
    expect(screen.getByText('Delete resource?')).toBeDefined();
  });

  it('renders ProgressModal with steps', () => {
    render(
      <ProgressModal
        open={true}
        title="Deploying"
        steps={[
          { label: 'Pull image', status: 'complete' },
          { label: 'Create pod', status: 'running' },
        ]}
        progress={50}
      />
    );
    expect(screen.getByText('Deploying')).toBeDefined();
    expect(screen.getByText('Pull image')).toBeDefined();
  });

  it('renders InlineSpinner', () => {
    const { container } = render(<InlineSpinner />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders SuccessFlash', () => {
    render(<SuccessFlash>Done!</SuccessFlash>);
    expect(screen.getByText('Done!')).toBeDefined();
  });

  it('renders ErrorIndicator', () => {
    render(<ErrorIndicator message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('renders Skeleton', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).not.toBeNull();
  });
});

describe('Primitive Components', () => {
  it('renders Badge', () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('renders EmptyState', () => {
    render(
      <EmptyState title="Nothing here" action={{ label: 'Create', onClick: vi.fn() }} />
    );
    expect(screen.getByText('Nothing here')).toBeDefined();
    expect(screen.getByText('Create')).toBeDefined();
  });

  it('renders SearchInput', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).toBeDefined();
  });

  it('renders Dropdown trigger', () => {
    render(
      <Dropdown
        trigger={<button>Actions</button>}
        items={[{ id: 'edit', label: 'Edit', onClick: vi.fn() }]}
      />
    );
    expect(screen.getByText('Actions')).toBeDefined();
  });
});
