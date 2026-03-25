import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ViewSpec } from '../engine/agentComponents';
import { truncateForPersistence } from '../engine/agentComponents';

const MAX_VIEWS = 20;

interface DynamicViewState {
  views: ViewSpec[];
  saveView: (spec: ViewSpec) => void;
  deleteView: (id: string) => void;
  getView: (id: string) => ViewSpec | undefined;
}

export const useDynamicViewStore = create<DynamicViewState>()(
  persist(
    (set, get) => ({
      views: [],

      saveView: (spec) =>
        set((state) => {
          // Truncate large data tables in layout before persisting
          const truncated = { ...spec, layout: spec.layout.map(truncateForPersistence) };
          const filtered = state.views.filter((v) => v.id !== spec.id);
          const updated = [truncated, ...filtered];
          // Trim to MAX_VIEWS, removing oldest by generatedAt
          if (updated.length > MAX_VIEWS) {
            updated.sort((a, b) => b.generatedAt - a.generatedAt);
            updated.length = MAX_VIEWS;
          }
          return { views: updated };
        }),

      deleteView: (id) =>
        set((state) => ({
          views: state.views.filter((v) => v.id !== id),
        })),

      getView: (id) => get().views.find((v) => v.id === id),
    }),
    { name: 'openshiftpulse-dynamic-views' },
  ),
);
