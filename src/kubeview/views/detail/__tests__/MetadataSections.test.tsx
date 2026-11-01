// @vitest-environment jsdom
/**
 * Labels and annotations: the section is there even when empty, add/edit/
 * remove send one JSON patch guarded by the loaded resourceVersion (with "/"
 * in keys escaped as ~1), RBAC gates editing, and a conflict is explained.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { LabelsSection, AnnotationsSection } from '../MetadataSections';
import { installFetch, setAllow, respond, writes, json, renderWithProviders } from '../../../components/workloads/__tests__/actionHarness';
import type { K8sResource } from '../../../engine/renderers';

const target = { apiPath: '/api/v1/namespaces/shop/configmaps/cfg', group: '', plural: 'configmaps' };
const bare = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'cfg', namespace: 'shop', uid: 'u', resourceVersion: '12' } } as K8sResource;
const labelled = { ...bare, metadata: { ...bare.metadata, labels: { 'app.kubernetes.io/name': 'shop' }, annotations: { 'example.com/owner': 'team-a' } } } as K8sResource;

beforeEach(() => { installFetch(); setAllow({ 'patch/configmaps': true }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const addButton = (noun: string) => screen.getByRole('button', { name: `+ Add ${noun}` }) as HTMLButtonElement;

describe('LabelsSection', () => {
  it('renders with no labels and adds the first one (creating the map first)', async () => {
    renderWithProviders(<LabelsSection resource={bare} target={target} />);
    expect(screen.getByText('No labels.')).toBeTruthy();
    await waitFor(() => expect(addButton('label').disabled).toBe(false));
    fireEvent.click(addButton('label'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'tier.example.com/role' } });
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: 'api' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/v1/namespaces/shop/configmaps/cfg',
      contentType: 'application/json-patch+json',
      body: [
        { op: 'test', path: '/metadata/resourceVersion', value: '12' },
        { op: 'add', path: '/metadata/labels', value: {} },
        { op: 'add', path: '/metadata/labels/tier.example.com~1role', value: 'api' },
      ],
    });
  });

  it('rejects an invalid key before sending anything', async () => {
    renderWithProviders(<LabelsSection resource={bare} target={target} />);
    await waitFor(() => expect(addButton('label').disabled).toBe(false));
    fireEvent.click(addButton('label'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'bad key!' } });
    expect(within(dialog).getByText(/Name must be/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits a value with a replace and removes a label with a remove', async () => {
    renderWithProviders(<LabelsSection resource={labelled} target={target} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit label app.kubernetes.io/name' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: 'store' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual([
      { op: 'test', path: '/metadata/resourceVersion', value: '12' },
      { op: 'replace', path: '/metadata/labels/app.kubernetes.io~1name', value: 'store' },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Remove label app.kubernetes.io/name' }));
    dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Selectors that match on it/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual([
      { op: 'test', path: '/metadata/resourceVersion', value: '12' },
      { op: 'remove', path: '/metadata/labels/app.kubernetes.io~1name' },
    ]);
  });

  it('explains a failed resourceVersion test as a conflict', async () => {
    respond((c) => (c.method === 'PATCH' ? json({ kind: 'Status', message: 'the server rejected our request: testing value /metadata/resourceVersion failed', code: 422 }, 422) : undefined));
    renderWithProviders(<LabelsSection resource={labelled} target={target} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove label app.kubernetes.io/name' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/changed since this page loaded it/));
  });

  it('without patch permission: no edit/remove, Add disabled with the reason', async () => {
    setAllow({});
    renderWithProviders(<LabelsSection resource={labelled} target={target} />);
    await waitFor(() => expect(addButton('label').disabled).toBe(true));
    expect(addButton('label').title).toMatch(/permission/);
    expect(screen.queryByRole('button', { name: /Edit label/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove label/ })).toBeNull();
  });
});

describe('AnnotationsSection', () => {
  it('is shown when empty and adds an annotation (any value allowed)', async () => {
    renderWithProviders(<AnnotationsSection resource={bare} target={target} />);
    expect(screen.getByText('No annotations.')).toBeTruthy();
    await waitFor(() => expect(addButton('annotation').disabled).toBe(false));
    fireEvent.click(addButton('annotation'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'example.com/note' } });
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: 'has spaces, and: punctuation' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual([
      { op: 'test', path: '/metadata/resourceVersion', value: '12' },
      { op: 'add', path: '/metadata/annotations', value: {} },
      { op: 'add', path: '/metadata/annotations/example.com~1note', value: 'has spaces, and: punctuation' },
    ]);
  });

  it('edits an existing annotation', async () => {
    renderWithProviders(<AnnotationsSection resource={labelled} target={target} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit annotation example.com/owner' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: 'team-b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()[0]?.body[1]).toEqual({ op: 'replace', path: '/metadata/annotations/example.com~1owner', value: 'team-b' }));
  });
});
