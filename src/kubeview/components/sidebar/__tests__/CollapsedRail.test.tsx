// @vitest-environment jsdom
/** With findings, clicking the rail went to /inbox and never expanded chat. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Search } from 'lucide-react';

const expandAISidebar = vi.fn();
vi.mock('../../../store/uiStore', () => ({ useUIStore: (sel: any) => sel({ expandAISidebar }) }));
vi.mock('../../../store/agentStore', () => ({ useAgentStore: (sel: any) => sel({ hasUnreadInsight: false }) }));
const go = vi.fn();
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => go }));
let status: Record<string, unknown> = {};
vi.mock('../../../hooks/useAgentStatus', () => ({ useAgentStatus: () => status }));

import { CollapsedRail } from '../CollapsedRail';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup());

describe('CollapsedRail', () => {
  it('expands the sidebar even when there are findings', () => {
    status = { type: 'findings', text: '', icon: Search, color: 'text-amber-400', findingsCount: 3, criticalCount: 0 };
    render(<CollapsedRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand AI Sidebar' }));
    expect(expandAISidebar).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
  });

  it('the findings count is its own link to the inbox', () => {
    status = { type: 'findings', text: '', icon: Search, color: 'text-amber-400', findingsCount: 3, criticalCount: 0 };
    render(<CollapsedRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Inbox: 3 findings' }));
    expect(go).toHaveBeenCalledWith('/inbox', 'Inbox');
    expect(expandAISidebar).not.toHaveBeenCalled();
  });

  it('shows no inbox link when there are no findings', () => {
    status = { type: 'idle', text: 'Ready', icon: Search, color: 'text-slate-400', findingsCount: 0, criticalCount: 0 };
    render(<CollapsedRail />);
    expect(screen.queryByRole('button', { name: /Open Inbox/ })).toBeNull();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
});
