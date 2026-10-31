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

// Module-style constant maps: STATUS_COLORS, SEVERITY_COLOR, PHASE_STYLES,
// POD_STATUS_COLOR, RISK_BORDER_COLORS, HEALTH_BG …
const STATUS_MAP_NAME =
  /^[A-Z0-9_]*(STATUS|SEVERITY|PHASE|HEALTH|RISK|OUTCOME)[A-Z0-9_]*_(COLOU?RS?|STYLES?|CLASSES|TONES?|BORDERS?|BGS?)$/;

function isMapInit(node) {
  if (!node) return false;
  if (node.type === 'ObjectExpression') return true;
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') return isMapInit(node.expression);
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
        if (node.id.type === 'Identifier' && STATUS_MAP_NAME.test(node.id.name) && isMapInit(node.init)) {
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
