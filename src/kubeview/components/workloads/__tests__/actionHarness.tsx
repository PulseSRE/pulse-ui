/**
 * Test harness for action menus and dialogs: a fetch stub that records every
 * request (method, path, content type, body), answers SelfSubjectAccessReviews
 * from an allow map, and lets each test answer writes (e.g. with a 403).
 */
import React from 'react';
import { vi } from 'vitest';
import { render, configure } from '@testing-library/react';

// Access reviews resolve asynchronously; on a loaded CI runner 1s is not always enough.
configure({ asyncUtilTimeout: 4000 });
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

export interface Call { method: string; url: string; path: string; contentType?: string; body?: any }

export const calls: Call[] = [];
export let allow: Record<string, boolean> = {};
type Responder = (c: Call) => Response | undefined;
let responders: Responder[] = [];

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function setAllow(next: Record<string, boolean>) { allow = next; }
export function respond(r: Responder) { responders.push(r); }

/** Writes only (no reads, no access reviews). */
export function writes(): Call[] {
  return calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/selfsubjectaccessreviews'));
}

export function installFetch() {
  calls.length = 0;
  allow = {};
  responders = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.replace(/^.*\/api\/kubernetes/, '').replace(/^.*\/proxy(?=\/)/, '');
    const call: Call = { method, url, path, contentType: headers['Content-Type'], body };
    calls.push(call);
    if (path.endsWith('/selfsubjectaccessreviews')) {
      const a = body.spec.resourceAttributes;
      return json({ status: { allowed: !!allow[`${a.verb}/${a.resource}`] } });
    }
    for (const r of responders) { const res = r(call); if (res) return res; }
    if (method === 'GET') return json({ kind: 'List', apiVersion: 'v1', items: [] });
    return json({ kind: 'Status', status: 'Success' });
  }));
}

function Where() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}{loc.search}{loc.hash}</div>;
}

export function renderWithProviders(ui: React.ReactElement, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<>{ui}<Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
