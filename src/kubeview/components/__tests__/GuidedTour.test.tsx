// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { GuidedTour as RawGuidedTour } from '../GuidedTour';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function GuidedTour() {
  return (
    <MemoryRouter initialEntries={['/start']}>
      <RawGuidedTour />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GuidedTour', () => {
  it('does not render when localStorage key is set', () => {
    vi.mocked(Storage.prototype.getItem).mockReturnValue('true');
    render(<GuidedTour />);
    expect(screen.queryByRole('button', { name: 'Close tour' })).toBeNull();
  });

  it('renders step 1 on first visit', () => {
    render(<GuidedTour />);
    expect(screen.getByText('Welcome to Pulse')).toBeDefined();
    expect(screen.getByText(/Your cluster health at a glance/)).toBeDefined();
  });

  it('advances to step 2 when Next button is clicked', () => {
    render(<GuidedTour />);
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText('Inbox')).toBeDefined();
    expect(screen.getByText(/Findings, alerts, tasks and approvals/)).toBeDefined();
  });

  it('returns to step 1 when Back button is clicked', () => {
    render(<GuidedTour />);
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText('Inbox')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Previous step'));
    expect(screen.getByText('Welcome to Pulse')).toBeDefined();
  });

  it('does not show Back button on step 1', () => {
    render(<GuidedTour />);
    expect(screen.queryByLabelText('Previous step')).toBeNull();
  });

  it('closes tour and sets localStorage when Skip is clicked', () => {
    render(<GuidedTour />);
    fireEvent.click(screen.getByText('Skip tour'));
    expect(Storage.prototype.setItem).toHaveBeenCalledWith('openshiftpulse-tour-completed', 'true');
    expect(screen.queryByText('Welcome to Pulse')).toBeNull();
  });

  it('sets localStorage when completing all steps via Get Started', () => {
    render(<GuidedTour />);
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText("You're Ready")).toBeDefined();
    expect(screen.getByText('Get Started')).toBeDefined();
    fireEvent.click(screen.getByText('Get Started'));
    expect(Storage.prototype.setItem).toHaveBeenCalledWith('openshiftpulse-tour-completed', 'true');
    expect(screen.queryByText("You're Ready")).toBeNull();
  });

  it('closes tour on Escape key', () => {
    render(<GuidedTour />);
    expect(screen.getByText('Welcome to Pulse')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(Storage.prototype.setItem).toHaveBeenCalledWith('openshiftpulse-tour-completed', 'true');
    expect(screen.queryByText('Welcome to Pulse')).toBeNull();
  });

  it('closes tour on backdrop click', () => {
    render(<GuidedTour />);
    const backdrop = screen.getByText('Welcome to Pulse').closest('.fixed');
    expect(backdrop).toBeDefined();
    fireEvent.click(backdrop!);
    expect(Storage.prototype.setItem).toHaveBeenCalledWith('openshiftpulse-tour-completed', 'true');
    expect(screen.queryByText('Welcome to Pulse')).toBeNull();
  });

  it('does not close when clicking inside the dialog', () => {
    render(<GuidedTour />);
    const title = screen.getByText('Welcome to Pulse');
    fireEvent.click(title);
    expect(screen.getByText('Welcome to Pulse')).toBeDefined();
  });

  it('shows correct number of progress dots', () => {
    const { container } = render(<GuidedTour />);
    const dotContainer = container.querySelector('.flex.gap-1\\.5');
    const dots = dotContainer!.querySelectorAll('span.rounded-full');
    expect(dots.length).toBe(5);
  });

  it('shows active progress dot for current step', () => {
    const { container } = render(<GuidedTour />);
    const dotContainer = container.querySelector('.flex.gap-1\\.5');
    const dots = dotContainer!.querySelectorAll('span.rounded-full');
    expect(dots[0].className).toContain('w-4');
    expect(dots[1].className).toContain('w-1.5');

    fireEvent.click(screen.getByLabelText('Next step'));
    const dotsAfter = dotContainer!.querySelectorAll('span.rounded-full');
    expect(dotsAfter[0].className).toContain('w-1.5');
    expect(dotsAfter[1].className).toContain('w-4');
  });

  it('shows Close button with correct aria-label', () => {
    render(<GuidedTour />);
    const closeBtn = screen.getByLabelText('Close tour');
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn);
    expect(Storage.prototype.setItem).toHaveBeenCalledWith('openshiftpulse-tour-completed', 'true');
    expect(screen.queryByText('Welcome to Pulse')).toBeNull();
  });

  it('shows last step with Get Started button instead of Next', () => {
    render(<GuidedTour />);
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.queryByLabelText('Next step')).toBeNull();
    expect(screen.getByText('Get Started')).toBeDefined();
  });

  it('names the Inbox (not the retired Incident Center) and "Show me" opens it', () => {
    render(<GuidedTour />);
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText('Inbox')).toBeDefined();
    expect(screen.queryByText('Incident Center')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show me Inbox/ }));
    expect(screen.getByTestId('where').textContent).toBe('/inbox');
    // Following the link ends the tour.
    expect(Storage.prototype.setItem).toHaveBeenCalledWith('openshiftpulse-tour-completed', 'true');
    expect(screen.queryByLabelText('Close tour')).toBeNull();
  });

  it('the Pulse, Inbox and Agent steps each offer a "Show me" link', () => {
    render(<GuidedTour />);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const showMe = screen.queryByRole('button', { name: /Show me/ });
      if (showMe) seen.push(showMe.textContent || '');
      const next = screen.queryByLabelText('Next step');
      if (next) fireEvent.click(next);
    }
    expect(seen).toEqual([expect.stringContaining('Cluster Pulse'), expect.stringContaining('Inbox'), expect.stringContaining('Pulse Agent')]);
  });
});
