/**
 * Local ESLint rules that keep the shared building blocks shared.
 *
 * - no-private-stat-primitives: a page must not define its own StatCard,
 *   StatusDot, StatPill or SummaryCard; use components/primitives.
 * - no-inline-status-colors: a page must not define its own status/severity/
 *   phase/health → colour map; use engine/statusColors.
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

export default {
  meta: { name: 'pulse-guardrails' },
  rules: {
    'no-private-stat-primitives': noPrivateStatPrimitives,
    'no-inline-status-colors': noInlineStatusColors,
  },
};
