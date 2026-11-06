/**
 * Render a page under a real memory router so a test can navigate the way an
 * in-app link does (same page, another `?tab=`) and step Back.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

export function renderRouted(element: React.ReactElement, url: string) {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: [url] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return {
    ...utils,
    router,
    /** Navigate like a link would (pushes a history entry). */
    go: (to: string) => act(() => router.navigate(to)),
    back: () => act(() => router.navigate(-1)),
    url: () => router.state.location.pathname + router.state.location.search,
  };
}
