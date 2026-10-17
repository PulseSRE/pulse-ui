/**
 * Renders a dashboard that has not been saved, for the render service.
 *
 * The agent previews a draft before saving it so the model can see what it is
 * about to hand the user. The render service opens /preview with the draft in
 * `window.__PULSE_PREVIEW__` (set before the app loads) and the requesting
 * user's token on every request, so widgets fetch their data exactly as they
 * would on the saved dashboard, with that user's permissions.
 *
 * The draft goes into the view store under a fixed id and is rendered by
 * CustomView in preview mode: same grid, same widgets, no editing controls and
 * nothing written anywhere.
 */

import { useState } from 'react';
import type { ComponentSpec, ViewSpec } from '../engine/agentComponents';
import { useCustomViewStore } from '../store/customViewStore';
import CustomView from './CustomView';

export const PREVIEW_VIEW_ID = '__preview__';

export interface PreviewSpec {
  title: string;
  description?: string;
  layout: ComponentSpec[];
  positions?: ViewSpec['positions'];
}

declare global {
  interface Window {
    __PULSE_PREVIEW__?: PreviewSpec;
  }
}

function isPreviewSpec(value: unknown): value is PreviewSpec {
  const v = value as PreviewSpec | undefined;
  return !!v && typeof v.title === 'string' && Array.isArray(v.layout);
}

export default function PreviewView() {
  const [ready] = useState(() => {
    const spec = window.__PULSE_PREVIEW__;
    if (!isPreviewSpec(spec)) return false;
    const view: ViewSpec = {
      id: PREVIEW_VIEW_ID,
      title: spec.title,
      description: spec.description,
      layout: spec.layout,
      positions: spec.positions,
      generatedAt: Date.now(),
    };
    useCustomViewStore.setState((s) => ({ views: [view, ...s.views.filter((v) => v.id !== PREVIEW_VIEW_ID)] }));
    return true;
  });

  if (!ready) {
    return (
      <div data-preview-status="missing" className="openshiftpulse p-6 text-sm text-slate-400">
        No dashboard to preview.
      </div>
    );
  }
  return (
    // Global styles are scoped to .openshiftpulse, normally set by Shell, which this route skips.
    <div data-preview-status="ready" className="openshiftpulse h-screen bg-slate-950 text-slate-100">
      <CustomView viewId={PREVIEW_VIEW_ID} preview />
    </div>
  );
}
