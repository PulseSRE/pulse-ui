#!/usr/bin/env node
/**
 * Colour-token codemod (consistency 8/12). Re-runnable and idempotent:
 *
 *   node scripts/codemods/text-tokens.mjs            # rewrite src/
 *   node scripts/codemods/text-tokens.mjs --check    # list what would change, exit 1 if anything
 *   node scripts/codemods/text-tokens.mjs path/to/File.tsx ...
 *
 * What it rewrites, in string and template literals of non-test source files:
 *
 * 1. Low-contrast body text. `text-slate-500`, `text-slate-600` and
 *    `text-slate-700` (with any variant prefix: `hover:`, `placeholder:` …)
 *    become `text-faint`, a token that keeps 4.5:1 on every dark surface the
 *    app uses (see `--text-faint` in styles/index.css). Left alone:
 *      - icons: the className of an element imported from lucide-react, or
 *        named `…Icon` / `Icon` (icons are not text; WCAG 1.4.11 applies, not 1.4.3);
 *      - decorative separators: an element with no aria-* attribute whose only
 *        content is one of `›`, `»`, `|`, `·`, `/`, `•` (a lone dash means
 *        "no value", which is content, so it is migrated);
 *      - disabled controls: `disabled:` variants, and the disabled branch of a
 *        conditional (a literal that also has an unprefixed `cursor-not-allowed`);
 *        WCAG exempts inactive controls.
 * 2. Yellow is not a status colour. Every Tailwind `*-yellow-N` utility becomes
 *    `*-amber-N`, and the yellow-500 hex (#eab308 / rgba(234, 179, 8, …))
 *    becomes amber-500, so warning reads the same on every page.
 *
 * The eslint rules `pulse/no-low-contrast-text` and `pulse/no-yellow` apply the
 * same exemptions, so a file this script leaves alone also lints clean.
 *
 * After a branch that touches the same files merges (e.g. #212, the
 * phone-width shell), merge main and re-run this script instead of resolving
 * class-string conflicts by hand.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// `(variants)text-slate-500` as a whole class token.
const LOW_CONTRAST = /(^|[\s"'`{])((?:[\w-]+:)*)text-slate-(?:500|600|700)(?=$|[\s"'`}$])/g;
// Any Tailwind colour utility in yellow: text-yellow-400, hover:bg-yellow-900/50, border-l-yellow-500 …
const YELLOW_CLASS = /(^|[^\w-])((?:[\w-]+:)*[a-z]+(?:-[a-z]+)*)-yellow-(\d{2,3})(?=$|[^\w-])/g;
const YELLOW_HEX = /#eab308\b/gi;
const YELLOW_RGB = /rgba?\(\s*234\s*,\s*179\s*,\s*8\s*([,)])/g;

// Separator glyphs between two pieces of text. Dashes are not here: a lone
// "—" or "-" usually means "no value", which is content.
export const SEPARATOR_TEXT = /^\s*(?:[›»|·•/]|&middot;)\s*$/;
// `cursor-not-allowed` without a variant: the literal is the disabled branch.
const DISABLED_BRANCH = /(^|[\s"'`])cursor-not-allowed(?=$|[\s"'`])/;

function isTestFile(path) {
  return /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[tj]sx?$/.test(path);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function lucideNames(sf) {
  const names = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === 'lucide-react') {
      const b = st.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const el of b.elements) names.add(el.name.text);
    }
  }
  return names;
}

/** The JSX element whose className this literal sits in, if any. */
function classNameOwner(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) {
      if (n.name.getText() !== 'className') return null;
      const owner = n.parent?.parent; // JsxAttributes -> opening/self-closing
      return owner && (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) ? owner : null;
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isSourceFile(n)) return null;
  }
  return null;
}

function isIconElement(owner, lucide) {
  const tag = owner.tagName.getText();
  return lucide.has(tag) || /(^|\.)(\w*Icon)$/.test(tag);
}

function isSeparatorElement(owner) {
  if (!ts.isJsxOpeningElement(owner)) return false;
  if (owner.attributes.properties.some((a) => ts.isJsxAttribute(a) && /^aria-/.test(a.name.getText()))) return false;
  const el = owner.parent;
  if (!el.children.length) return false;
  return el.children.every((c) => ts.isJsxText(c) && SEPARATOR_TEXT.test(c.text));
}

function rewriteLowContrast(text) {
  if (DISABLED_BRANCH.test(text)) return text;
  return text.replace(LOW_CONTRAST, (m, lead, variants) => (/(^|:)disabled:$/.test(variants) ? m : `${lead}${variants}text-faint`));
}

function rewriteYellow(text) {
  return text
    .replace(YELLOW_CLASS, (_m, lead, util, shade) => `${lead}${util}-amber-${shade}`)
    .replace(YELLOW_HEX, '#f59e0b')
    .replace(YELLOW_RGB, (_m, end) => `rgba(245, 158, 11${end}`);
}

export function transform(source, fileName = 'file.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lucide = lucideNames(sf);
  const edits = [];

  const visit = (node) => {
    const isLiteral = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    // Import specifiers and the like are StringLiterals too; only touch ones that look like class lists or colours.
    if (isLiteral && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
      const start = node.getStart(sf);
      const raw = source.slice(start, node.getEnd());
      let next = rewriteYellow(raw);
      const owner = classNameOwner(node);
      const exempt = owner && (isIconElement(owner, lucide) || isSeparatorElement(owner));
      if (!exempt) next = rewriteLowContrast(next);
      if (next !== raw) edits.push({ start, end: node.getEnd(), text: next });
    }
    // className="…" on a JSX attribute is a StringLiteral child, handled above.
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) return source;
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function main(argv) {
  const check = argv.includes('--check');
  const paths = argv.filter((a) => !a.startsWith('--'));
  const files = (paths.length ? paths.map((p) => join(process.cwd(), p)) : walk(join(ROOT, 'src'))).filter((f) => !isTestFile(f));
  let changed = 0;
  for (const f of files) {
    const before = readFileSync(f, 'utf8');
    const after = transform(before, f);
    if (after === before) continue;
    changed++;
    if (check) console.log(relative(ROOT, f));
    else writeFileSync(f, after);
  }
  console.log(`${check ? 'would change' : 'changed'} ${changed} file(s)`);
  if (check && changed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
