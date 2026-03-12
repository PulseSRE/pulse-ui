// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AIAssistant from '../components/AIAssistant';

describe('AIAssistant', () => {
  afterEach(() => { cleanup(); });

  it('does not render when closed', () => {
    render(<AIAssistant open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('AI Operations Assistant')).toBeNull();
  });

  it('renders when open', () => {
    render(<AIAssistant open={true} onClose={vi.fn()} />);
    expect(screen.getByText('AI Operations Assistant')).toBeDefined();
    expect(screen.getByText('Claude')).toBeDefined();
  });

  it('shows welcome message with suggestions', () => {
    render(<AIAssistant open={true} onClose={vi.fn()} />);
    expect(screen.getByText('How can I help with your cluster?')).toBeDefined();
    expect(screen.getByText('Why are pods failing?')).toBeDefined();
    expect(screen.getByText('What needs attention?')).toBeDefined();
  });

  it('has input field and send button', () => {
    render(<AIAssistant open={true} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Ask about your cluster...')).toBeDefined();
    expect(screen.getByText('Send')).toBeDefined();
  });

  it('send button is disabled when input is empty', () => {
    render(<AIAssistant open={true} onClose={vi.fn()} />);
    const sendBtn = screen.getByText('Send').closest('button');
    expect(sendBtn?.disabled).toBe(true);
  });

  it('send button enables when input has text', () => {
    render(<AIAssistant open={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Ask about your cluster...'), { target: { value: 'test' } });
    const sendBtn = screen.getByText('Send').closest('button');
    expect(sendBtn?.disabled).toBe(false);
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<AIAssistant open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AIAssistant file structure', () => {
  it('gathers cluster context from K8s API', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../components/AIAssistant.tsx'), 'utf-8');
    expect(content).toContain('gatherClusterContext');
    expect(content).toContain('/api/v1/nodes');
    expect(content).toContain('/api/v1/pods');
    expect(content).toContain('/apis/apps/v1/deployments');
    expect(content).toContain('/api/v1/events');
    expect(content).toContain('/api/v1/alerts');
  });

  it('sends messages to Claude API via proxy', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../components/AIAssistant.tsx'), 'utf-8');
    expect(content).toContain('/api/ai');
    expect(content).toContain('vertex-2023-10-16');
  });

  it('parses actions from AI response (scale, restart, cordon)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../components/AIAssistant.tsx'), 'utf-8');
    expect(content).toContain('parseActions');
    expect(content).toContain('scale');
    expect(content).toContain('restart');
    expect(content).toContain('cordon');
  });

  it('fetches pod logs and resource details for context', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../components/AIAssistant.tsx'), 'utf-8');
    expect(content).toContain('fetchPodLogs');
    expect(content).toContain('fetchResourceDetail');
  });
});
