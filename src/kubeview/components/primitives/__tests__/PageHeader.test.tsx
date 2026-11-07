// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Globe } from 'lucide-react';
import { PageHeader } from '../PageHeader';

afterEach(cleanup);

describe('PageHeader', () => {
  it('renders the title as the one level-1 heading, with its icon and subtitle', () => {
    render(<PageHeader icon={<Globe data-testid="icon" />} title="Networking" subtitle="Services and routes" />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Networking');
    expect(within(headings[0]).getByTestId('icon')).toBeTruthy();
    expect(screen.getByText('Services and routes').tagName).toBe('P');
  });

  it('renders actions in the right-side slot, and they work', () => {
    const onCreate = vi.fn();
    render(<PageHeader title="Networking" actions={<button onClick={onCreate}>Create</button>} />);
    const heading = screen.getByRole('heading', { level: 1 });
    const button = screen.getByRole('button', { name: 'Create' });
    // Not inside the title block: actions are a sibling of it.
    expect(heading.parentElement!.contains(button)).toBe(false);
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders no breadcrumb nav and no action slot when none are given', () => {
    const { container } = render(<PageHeader title="Security" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('header')!.children).toHaveLength(1);
  });

  it('back is a named link to the parent; a plain click navigates in the app', () => {
    const onBack = vi.fn();
    render(<PageHeader title="Prometheus" back={{ label: 'catalog', href: '/operators', onClick: onBack }} />);
    const back = screen.getByRole('link', { name: 'Back to catalog' });
    expect(back.getAttribute('href')).toBe('/operators');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).contains(back)).toBe(true);
    // fireEvent returns false when the default (a full page load) was prevented.
    expect(fireEvent.click(back)).toBe(false);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('back: modified and middle clicks are left to the browser', () => {
    const onBack = vi.fn();
    render(<PageHeader title="Prometheus" back={{ label: 'catalog', href: '/operators', onClick: onBack }} />);
    const back = screen.getByRole('link', { name: 'Back to catalog' });
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(fireEvent.click(back, init)).toBe(true);
    }
    expect(onBack).not.toHaveBeenCalled();
  });

  it('breadcrumb: earlier crumbs are links, the last is the current page', () => {
    const toIdentity = vi.fn();
    render(
      <PageHeader
        title="web"
        breadcrumb={[
          { label: 'Identity & Access', href: '/identity', onClick: toIdentity },
          { label: 'Service accounts', href: '/identity?tab=groups-sa', onClick: vi.fn() },
          { label: 'shop/web', href: '/identity/serviceaccounts/shop/web', onClick: vi.fn() },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const first = within(nav).getByRole('link', { name: 'Identity & Access' });
    expect(first.getAttribute('href')).toBe('/identity');
    expect(within(nav).getByRole('link', { name: 'Service accounts' }).getAttribute('href')).toBe('/identity?tab=groups-sa');
    expect(fireEvent.click(first)).toBe(false);
    expect(toIdentity).toHaveBeenCalledTimes(1);
    expect(fireEvent.click(first, { metaKey: true })).toBe(true);
    expect(toIdentity).toHaveBeenCalledTimes(1);
    expect(within(nav).queryByRole('link', { name: 'shop/web' })).toBeNull();
    expect(within(nav).getByText('shop/web').getAttribute('aria-current')).toBe('page');
  });

  it('renders the meta line beside the title, outside the heading', () => {
    render(<PageHeader title="Compute" meta={<span>Self-Managed</span>} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Compute');
    expect(screen.getByText('Self-Managed')).toBeTruthy();
  });
});
