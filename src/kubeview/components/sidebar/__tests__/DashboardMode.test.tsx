// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Bot } from 'lucide-react';

vi.mock('../../../hooks/useSmartPrompts', () => ({
  useSmartPrompts: () => [
    { prompt: 'Check overall cluster health', context: 'general suggestion for /inbox', priority: 50 },
  ],
}));

vi.mock('../../../hooks/useAgentStatus', () => ({
  useAgentStatus: () => ({
    type: 'connected',
    text: 'Scanning... all clear',
    icon: Bot,
    color: '',
    findingsCount: 0,
    criticalCount: 0,
  }),
}));

import { DashboardMode } from '../DashboardMode';

afterEach(cleanup);

describe('DashboardMode suggestions', () => {
  it('labels a suggestion with the prompt it sends, not its internal context', () => {
    render(
      <MemoryRouter>
        <DashboardMode />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Check overall cluster health' })).toBeTruthy();
    expect(screen.queryByText('general suggestion for /inbox')).toBeNull();
  });
});
