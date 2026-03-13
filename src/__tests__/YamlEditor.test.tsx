// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/store/useUIStore', () => ({
  useUIStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { addToast: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: vi.fn(({ value, editable }: { value: string; editable: boolean }) => (
    <pre data-testid="codemirror" data-editable={String(editable ?? false)}>{value}</pre>
  )),
}));

vi.mock('@codemirror/lang-json', () => ({ json: () => [], jsonParseLinter: () => () => [] }));
vi.mock('@codemirror/lang-yaml', () => ({ yaml: () => [] }));
vi.mock('@codemirror/theme-one-dark', () => ({ oneDark: 'dark' }));
vi.mock('@codemirror/search', () => ({ search: () => [], openSearchPanel: vi.fn() }));
vi.mock('@codemirror/lint', () => ({ linter: () => [], lintGutter: () => [] }));
vi.mock('@codemirror/view', () => ({ EditorView: { lineWrapping: [] }, keymap: { of: () => [] } }));

import YamlEditor from '../components/YamlEditor';

const SAMPLE_JSON = JSON.stringify({ kind: 'Deployment', apiVersion: 'apps/v1', metadata: { name: 'test' } }, null, 2);

// Sample with managedFields and other noisy metadata
const NOISY_JSON = JSON.stringify({
  kind: 'Deployment', apiVersion: 'apps/v1',
  metadata: {
    name: 'test', namespace: 'default',
    uid: 'abc-123', resourceVersion: '12345', generation: 2,
    creationTimestamp: '2026-01-01T00:00:00Z',
    managedFields: [{ manager: 'kubectl', operation: 'Update' }],
    annotations: { 'kubectl.kubernetes.io/last-applied': '{}', 'my-annotation': 'keep' },
  },
  spec: { replicas: 2 },
}, null, 2);

describe('YamlEditor', () => {
  afterEach(() => cleanup());

  it('renders JSON content with format toggle and toolbar buttons', () => {
    render(<YamlEditor value={SAMPLE_JSON} name="test" />);
    // Editor shows JSON
    expect(screen.getByTestId('codemirror').textContent).toContain('"kind": "Deployment"');
    // Format toggle present
    const toggleBtns = document.querySelectorAll('.os-yaml-editor__format-btn');
    expect(toggleBtns).toHaveLength(2);
    expect(toggleBtns[0].textContent).toBe('JSON');
    expect(toggleBtns[1].textContent).toBe('YAML');
    // Toolbar buttons present
    expect(screen.getByLabelText('Search')).toBeDefined();
    expect(screen.getByLabelText('Toggle word wrap')).toBeDefined();
    expect(screen.getByLabelText('Toggle fullscreen')).toBeDefined();
    // Status bar
    const statusbar = document.querySelector('.os-yaml-editor__statusbar')!;
    expect(statusbar.textContent).toContain(`Lines: ${SAMPLE_JSON.split('\n').length}`);
    // Read-only
    expect(screen.getByTestId('codemirror').getAttribute('data-editable')).toBe('false');
  });

  it('switches to YAML format when YAML button is clicked', () => {
    render(<YamlEditor value={SAMPLE_JSON} name="test" />);
    const yamlBtn = document.querySelectorAll('.os-yaml-editor__format-btn')[1];
    fireEvent.click(yamlBtn);
    expect(screen.getByTestId('codemirror').textContent).toContain('kind: Deployment');
  });

  it('shows Edit button only when apiUrl is provided', () => {
    const { unmount } = render(<YamlEditor value={SAMPLE_JSON} name="test" />);
    // No Edit without apiUrl
    const editBtns = document.querySelectorAll('.pf-v6-c-button.pf-m-primary');
    const hasEdit = Array.from(editBtns).some(b => b.textContent?.includes('Edit'));
    expect(hasEdit).toBe(false);
    unmount();

    // Edit appears with apiUrl
    render(<YamlEditor value={SAMPLE_JSON} name="test" apiUrl="/api/test" />);
    const editBtns2 = document.querySelectorAll('.pf-v6-c-button.pf-m-primary');
    const hasEdit2 = Array.from(editBtns2).some(b => b.textContent?.includes('Edit'));
    expect(hasEdit2).toBe(true);
  });

  it('enters and exits edit mode', () => {
    render(<YamlEditor value={SAMPLE_JSON} name="test" apiUrl="/api/test" />);

    // Click Edit
    const editBtn = Array.from(document.querySelectorAll('.pf-v6-c-button')).find(b => b.textContent?.includes('Edit'))!;
    fireEvent.click(editBtn);

    // Now in edit mode
    expect(screen.getByText('Editing')).toBeDefined();
    expect(screen.getByTestId('codemirror').getAttribute('data-editable')).toBe('true');
    const saveBtn = Array.from(document.querySelectorAll('.pf-v6-c-button')).find(b => b.textContent?.includes('Save'));
    const cancelBtn = Array.from(document.querySelectorAll('.pf-v6-c-button')).find(b => b.textContent?.includes('Cancel'));
    expect(saveBtn).toBeDefined();
    expect(cancelBtn).toBeDefined();

    // Cancel
    fireEvent.click(cancelBtn!);
    expect(screen.getByTestId('codemirror').getAttribute('data-editable')).toBe('false');
    expect(screen.queryByText('Editing')).toBeNull();
  });

  it('clean view strips managedFields and noisy metadata', () => {
    render(<YamlEditor value={NOISY_JSON} name="test" />);
    // Click clean view button
    const cleanBtn = screen.getByLabelText('Toggle clean view');
    fireEvent.click(cleanBtn);
    const content = screen.getByTestId('codemirror').textContent!;
    // Should NOT contain managedFields, uid, resourceVersion, generation, creationTimestamp
    expect(content).not.toContain('managedFields');
    expect(content).not.toContain('abc-123');
    expect(content).not.toContain('"resourceVersion"');
    expect(content).not.toContain('"generation"');
    // Should still contain real data
    expect(content).toContain('"name": "test"');
    expect(content).toContain('"replicas": 2');
    expect(content).toContain('"my-annotation": "keep"');
    // Should strip kubectl annotation
    expect(content).not.toContain('last-applied');
    // Banner should show stripped count
    const banner = document.querySelector('.os-yaml-editor__banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('Hiding');
  });

  it('shows status bar with keyboard shortcut hints in edit mode', () => {
    render(<YamlEditor value={SAMPLE_JSON} name="test" apiUrl="/api/test" />);
    const editBtn = Array.from(document.querySelectorAll('.pf-v6-c-button')).find(b => b.textContent?.includes('Edit'))!;
    fireEvent.click(editBtn);
    const statusbar = document.querySelector('.os-yaml-editor__statusbar')!;
    expect(statusbar.textContent).toContain('Ctrl+S');
    expect(statusbar.textContent).toContain('Esc');
  });

  it('minimap appears for resources with >50 lines', () => {
    const longJson = JSON.stringify(
      { kind: 'ConfigMap', data: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`key${i}`, `value${i}`])) },
      null, 2
    );
    render(<YamlEditor value={longJson} name="test" />);
    const minimap = document.querySelector('.os-yaml-editor__minimap');
    expect(minimap).not.toBeNull();
  });

  it('minimap does not appear for small resources', () => {
    render(<YamlEditor value={SAMPLE_JSON} name="test" />);
    const minimap = document.querySelector('.os-yaml-editor__minimap');
    expect(minimap).toBeNull();
  });
});
