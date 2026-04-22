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

    default:
      return spec;
  }
}
