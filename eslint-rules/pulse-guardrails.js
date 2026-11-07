/**
 * Local ESLint rules that keep the shared building blocks shared.
 *
 * - no-private-stat-primitives: a page must not define its own StatCard,
 *   StatusDot, StatPill or SummaryCard; use components/primitives.
 * - no-inline-status-colors: a page must not define its own status/severity/
 *   phase/health → colour map; use engine/statusColors.
 * - no-yellow: no Tailwind `*-yellow-N` class or yellow-500 hex. Warning is
 *   amber (engine/statusColors); yellow-300/400 text washes out on slate.
 * - no-low-contrast-text: no `text-slate-500/600/700` text, which is 1.9-3.7:1
 *   on the app's dark surfaces. Use `text-muted` or `text-faint` (both AA).
 *   Icons, separator glyphs and disabled controls are exempt, matching
 *   scripts/codemods/text-tokens.mjs, which fixes what this rule reports.
 *
 * Existing copies not yet migrated are listed in eslint.config.js with the
 * wave that owns them, so the list can only shrink.
 */

const PRIVATE_PRIMITIVES = /^(StatCard|StatusDot|StatPill|SummaryCard)$/;

// Status → colour maps, whatever the casing or wherever they are declared
// (module scope or inside a component): STATUS_COLORS, statusColors,
// severityColor, POD_STATUS_COLOR, PHASE_COLOR_MAP, SEVERITY_DOT, HEALTH_BG …
// Names are compared in UPPER_SNAKE form. A map of labels (STATUS_MAP,
// STATUS_LABELS) is not a colour map and is allowed.
const STATUS_WORD = /(^|_)(STATUS|SEVERITY|PHASE|HEALTH|RISK|OUTCOME)(_|$)/;
const COLOUR_SUFFIX = /_(COLOU?RS?|STYLES?|CLASSES|CLASS|TONES?|BORDERS?|BGS?|DOTS?)(_MAP)?$/;

function upperSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function isStatusMapName(name) {
  const n = upperSnake(name);
  return STATUS_WORD.test(n) && COLOUR_SUFFIX.test(n);
}

function isMapInit(node) {
  if (!node) return false;
  if (node.type === 'ObjectExpression') return true;
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') return isMapInit(node.expression);
  // `const severityColor = { critical: 'text-red-400', … }[sev]`
  if (node.type === 'MemberExpression') return isMapInit(node.object);
  return false;
}

const noPrivateStatPrimitives = {
  meta: {
    type: 'problem',
    docs: { description: 'Use the StatCard/StatusBadge primitives instead of a private copy' },
    messages: {
      privateCopy:
        "'{{name}}' re-implements a shared primitive. Use components/primitives (StatCard, StatusBadge, Badge) instead.",
    },
    schema: [],
  },
  create(context) {
    const report = (id) => {
      if (id && id.type === 'Identifier' && PRIVATE_PRIMITIVES.test(id.name)) {
        context.report({ node: id, messageId: 'privateCopy', data: { name: id.name } });
      }
    };
    return {
      FunctionDeclaration(node) {
        report(node.id);
      },
      VariableDeclarator(node) {
        if (node.init && /Function|Call/.test(node.init.type)) report(node.id);
      },
      ClassDeclaration(node) {
        report(node.id);
      },
    };
  },
};

const noInlineStatusColors = {
  meta: {
    type: 'problem',
    docs: { description: 'Use engine/statusColors instead of a private status → colour map' },
    messages: {
      inlineMap:
        "'{{name}}' is a private status colour map. Use statusTone/statusClasses/TONE_CLASSES from engine/statusColors.",
    },
    schema: [],
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isStatusMapName(node.id.name) && isMapInit(node.init)) {
          context.report({ node: node.id, messageId: 'inlineMap', data: { name: node.id.name } });
        }
      },
    };
  },
};

// ── Colour tokens ──────────────────────────────────────────────────────────
// Keep these patterns in step with scripts/codemods/text-tokens.mjs.

const YELLOW_CLASS = /(^|[^\w-])(?:[\w-]+:)*[a-z]+(?:-[a-z]+)*-yellow-\d{2,3}(?=$|[^\w-])/;
const YELLOW_HEX = /#eab308\b|rgba?\(\s*234\s*,\s*179\s*,\s*8\s*[,)]/i;
// One class token: variants (`hover:`, `placeholder:`, `data-[state=open]:`,
// `[&>p]:`, `aria-selected:` …), an optional `!` before or after (Tailwind 3 and
// 4 important), an optional opacity (`/60`, `/[.35]`).
const LOW_CONTRAST = /(^|[\s"'`{])((?:(?:[^\s:"'`{}[\]]|\[[^\]\s]*\])+:)*)(!?)text-slate-(500|600|700)((?:\/(?:\d+|\[[^\]\s]+\]))?)(!?)(?=$|[\s"'`}$])/g;
const SEPARATOR_TEXT = /^\s*(?:[›»|·•/]|&middot;)\s*$/;
const DISABLED_BRANCH = /(^|[\s"'`])cursor-not-allowed(?=$|[\s"'`])/;

function literalText(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateElement') return node.value.raw;
  return null;
}

function isModuleSource(node) {
  const p = node.parent;
  return !!p && /^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration|ImportExpression)$/.test(p.type) && p.source === node;
}

/** The JSX opening element whose className this literal is (part of), if any. */
function classNameOwner(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === 'JSXAttribute') {
      return n.name.type === 'JSXIdentifier' && n.name.name === 'className' ? n.parent : null;
    }
    if (n.type === 'JSXElement' || n.type === 'Program') return null;
  }
  return null;
}

function jsxName(name) {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return name.property.name;
  return '';
}

const noYellow = {
  meta: {
    type: 'problem',
    docs: { description: 'Warning is amber: no yellow Tailwind classes or yellow hex' },
    messages: {
      yellow: 'Yellow is not a status colour here: use amber (statusClasses/TONE_CLASSES from engine/statusColors, or the amber-N shade). Allowlist a non-status use with an eslint-disable comment that says why.',
    },
    schema: [],
  },
  create(context) {
    const check = (node) => {
      const text = literalText(node);
      if (text && !isModuleSource(node) && (YELLOW_CLASS.test(text) || YELLOW_HEX.test(text))) {
        context.report({ node, messageId: 'yellow' });
      }
    };
    return { Literal: check, TemplateElement: check };
  },
};

const noLowContrastText = {
  meta: {
    type: 'problem',
    docs: { description: 'Muted text must meet WCAG AA: use text-muted / text-faint, not text-slate-500/600/700' },
    messages: {
      lowContrast:
        "'{{cls}}' text is below 4.5:1 on the dark surfaces. Use text-muted (secondary) or text-faint (tertiary); run scripts/codemods/text-tokens.mjs. Icons, separators and disabled controls are exempt.",
    },
    schema: [],
  },
  create(context) {
    const icons = new Set();
    const isIcon = (owner) => {
      const n = jsxName(owner.name);
      return icons.has(n) || /[Ii]con$/.test(n);
    };
    const isSeparator = (owner) => {
      if (owner.attributes.some((a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && /^aria-/.test(a.name.name))) return false;
      const el = owner.parent;
      if (!el || el.type !== 'JSXElement' || !el.children.length) return false;
      return el.children.every((c) => c.type === 'JSXText' && SEPARATOR_TEXT.test(c.raw ?? c.value));
    };
    const check = (node) => {
      const text = literalText(node);
      if (!text || isModuleSource(node) || !text.includes('text-slate-') || DISABLED_BRANCH.test(text)) return;
      const owner = classNameOwner(node);
      if (owner && (isIcon(owner) || isSeparator(owner))) return;
      for (const m of text.matchAll(LOW_CONTRAST)) {
        if (/(^|:)disabled:$/.test(m[2])) continue;
        context.report({ node, messageId: 'lowContrast', data: { cls: `${m[2]}${m[3]}text-slate-${m[4]}${m[5]}${m[6]}` } });
        return;
      }
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'lucide-react') return;
        for (const s of node.specifiers) icons.add(s.local.name);
      },
      Literal: check,
      TemplateElement: check,
    };
  },
};

export default {
  meta: { name: 'pulse-guardrails' },
  rules: {
    'no-private-stat-primitives': noPrivateStatPrimitives,
    'no-inline-status-colors': noInlineStatusColors,
    'no-yellow': noYellow,
    'no-low-contrast-text': noLowContrastText,
  },
};
