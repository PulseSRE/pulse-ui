/**
 * Normalizes agent-designed component specs before rendering.
 * Handles two concerns:
 * 1. Flattens {kind, props: {actual_data}} → {kind, actual_data}
 * 2. Maps known prop aliases (yaml→content, label→title, etc.)
 */

import type { ComponentSpec } from './agentComponents';

type RawSpec = Record<string, unknown>;

export function normalizeAgentProps(spec: ComponentSpec): ComponentSpec {
  const raw = spec as unknown as RawSpec;

  // 1. Flatten props wrapper: {kind, title, props: {data}} → {kind, title, ...data}
  if (raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props)) {
    const { props, ...rest } = raw;
    const flattened = { ...rest, ...(props as RawSpec) } as unknown as ComponentSpec;
    return normalizeKindSpecific(flattened);
  }

  return normalizeKindSpecific(spec);
}

function normalizeKindSpecific(spec: ComponentSpec): ComponentSpec {
  const raw = spec as unknown as RawSpec;

  switch (spec.kind) {
    case 'yaml_viewer': {
      if (!raw.content && raw.yaml) {
        return { ...spec, content: raw.yaml as string } as unknown as ComponentSpec;
      }
      return spec;
    }

    case 'stat_card': {
      const result = { ...raw };
      if (!result.title && raw.label) result.title = raw.label;
      return result as unknown as ComponentSpec;
    }

    case 'info_card_grid': {
      if (Array.isArray(raw.cards)) {
        const cards = (raw.cards as Array<RawSpec>).map((card) => ({
          label: (card.label || card.title || '') as string,
          value: (card.value || card.text || '') as string,
          sub: card.sub as string | undefined,
        }));
        return { ...spec, cards } as unknown as ComponentSpec;
      }
      return spec;
    }

    case 'status_list': {
      if (Array.isArray(raw.items)) {
        const items = (raw.items as Array<RawSpec>).map((item) => ({
          ...item,
          name: (item.name || item.label || '') as string,
          status: item.status === 'info' ? 'unknown' : (item.status || 'unknown') as string,
        }));
        return { ...spec, items } as unknown as ComponentSpec;
      }
      return spec;
    }

    case 'badge_list': {
      if (Array.isArray(raw.badges)) {
        const badges = (raw.badges as Array<RawSpec>).map((badge) => ({
          ...badge,
          text: (badge.text || badge.label || '') as string,
        }));
        return { ...spec, badges } as unknown as ComponentSpec;
      }
      return spec;
    }

    case 'log_viewer': {
      if (Array.isArray(raw.lines)) {
        const lines = (raw.lines as Array<RawSpec>).map((line) => ({
          ...line,
          level: line.level === 'warning' ? 'warn' : (line.level || 'info') as string,
        }));
        return { ...spec, lines } as unknown as ComponentSpec;
      }
      return spec;
    }

    case 'chart': {
      if (Array.isArray(raw.series)) {
        const series = (raw.series as Array<RawSpec>).map((s) => ({
          ...s,
          data: (s.data || s.values || []) as unknown[],
        }));
        return { ...spec, series } as unknown as ComponentSpec;
      }
      return spec;
    }

    default:
      return spec;
  }
}
