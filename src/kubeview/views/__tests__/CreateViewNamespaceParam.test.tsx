// @vitest-environment jsdom
/** StorageView's "add quota" link passes `?namespace=`; the draft must target it. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ addToast: vi.fn(), addTab: vi.fn(), selectedNamespace: 'default' }),
}));
vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: any) => selector({
    resourceRegistry: new Map([['core/v1/resourcequotas', { group: '', version: 'v1', kind: 'ResourceQuota', plural: 'resourcequotas', namespaced: true, verbs: [], shortNames: [], categories: [], singularName: 'resourcequota' }]]),
  }),
}));
vi.mock('../../components/yaml/YamlEditor', () => ({
  default: ({ value }: any) => <textarea data-testid="yaml-editor" value={value} readOnly />,
}));
vi.mock('../../components/DeployProgress', () => ({ default: () => null }));

import CreateView from '../CreateView';

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <CreateView gvrKey="v1/resourcequotas" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreateView ?namespace=', () => {
  afterEach(cleanup);

  it('drafts the resource in the namespace from the link', () => {
    renderAt('/create/v1~resourcequotas?namespace=team-a');
    const yaml = (screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value;
    expect(yaml).toMatch(/namespace: team-a/);
    expect(yaml).not.toMatch(/namespace: default/);
  });

  it('falls back to the selected namespace without the param', () => {
    renderAt('/create/v1~resourcequotas');
    expect((screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value).toMatch(/namespace: default/);
  });
});

describe('CreateView ?template=', () => {
  afterEach(cleanup);

  it('opens the editor on the reviewed template, in the linked namespace', () => {
    renderAt('/create/v1~resourcequotas?template=resource-quota&namespace=team-a');
    const yaml = (screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value;
    expect(yaml).toMatch(/^apiVersion: v1\nkind: ResourceQuota\nmetadata:\n  name: compute-quota\n  namespace: team-a\n/);
    expect(yaml).toMatch(/requests\.cpu: "4"/);
  });

  it('ignores an unknown template', () => {
    renderAt('/create/v1~resourcequotas?template=nope&namespace=team-a');
    expect((screen.getByTestId('yaml-editor') as HTMLTextAreaElement).value).not.toMatch(/compute-quota/);
  });
});
