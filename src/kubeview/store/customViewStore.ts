/**
 * Custom View Store — persists user-created dashboards built through
 * natural language conversation with the agent.
 *
 * User says "create a dashboard showing node health and crashlooping pods"
 * → agent returns component specs → user saves as a named view → view
 * appears in sidebar and persists across sessions.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ViewSpec, ComponentSpec } from '../engine/agentComponents';
import { truncateForPersistence } from '../engine/agentComponents';

const MAX_VIEWS = 20;

interface CustomViewState {
  views: ViewSpec[];

  saveView: (view: ViewSpec) => void;
  deleteView: (id: string) => void;
  updateView: (id: string, updates: Partial<ViewSpec>) => void;
  addWidget: (viewId: string, widget: ComponentSpec) => void;
  removeWidget: (viewId: string, widgetIndex: number) => void;
  getView: (id: string) => ViewSpec | undefined;
}

export const useCustomViewStore = create<CustomViewState>()(
  persist(
    (set, get) => ({
      views: [],

      saveView: (view) => {
        const truncated: ViewSpec = {
          ...view,
          layout: view.layout.map(truncateForPersistence),
        };
        set((s) => {
          const existing = s.views.findIndex((v) => v.id === view.id);
          if (existing >= 0) {
            const updated = [...s.views];
            updated[existing] = truncated;
            return { views: updated };
          }
          return { views: [...s.views, truncated].slice(-MAX_VIEWS) };
        });
      },

      deleteView: (id) => {
        set((s) => ({ views: s.views.filter((v) => v.id !== id) }));
      },

      updateView: (id, updates) => {
        set((s) => ({
          views: s.views.map((v) => (v.id === id ? { ...v, ...updates } : v)),
        }));
      },

      addWidget: (viewId, widget) => {
        set((s) => ({
          views: s.views.map((v) =>
            v.id === viewId
              ? { ...v, layout: [...v.layout, truncateForPersistence(widget)] }
              : v,
          ),
        }));
      },

      removeWidget: (viewId, widgetIndex) => {
        set((s) => ({
          views: s.views.map((v) =>
            v.id === viewId
              ? { ...v, layout: v.layout.filter((_, i) => i !== widgetIndex) }
              : v,
          ),
        }));
      },

      getView: (id) => get().views.find((v) => v.id === id),
    }),
    {
      name: 'openshiftpulse-custom-views',
      partialize: (state) => ({ views: state.views }),
    },
  ),
);
