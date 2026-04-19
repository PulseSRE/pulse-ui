/**
 * Minimal markdown renderer — no external dependency.
 * Covers: headers, bold, italic, inline code, code blocks, lists, line breaks.
 */

import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface Props {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: Props) {
  const blocks = parseBlocks(content);

  return (
    <div className={cn('text-sm text-slate-200 space-y-2', className)}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

type BlockNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code_block'; lang: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string };

function parseBlocks(text: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code_block', lang, code: codeLines.join('\n') });
      i++; // skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // List (unordered or ordered)
    if (/^[\-\*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^[\-\*]\s/.test(lines[i]) || /^\d+\.\s/.test(lines[i]))) {
        items.push(lines[i].replace(/^[\-\*]\s+/, '').replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !/^[\-\*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

function Block({ block }: { block: BlockNode }) {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${Math.min(block.level + 1, 6)}`) as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const sizes = { h2: 'text-base font-semibold', h3: 'text-sm font-semibold', h4: 'text-sm font-medium', h5: 'text-xs font-medium', h6: 'text-xs font-medium' };
      return <Tag className={cn(sizes[Tag] || 'text-sm font-medium', 'text-slate-100 mt-2')}><InlineText text={block.text} /></Tag>;
    }
    case 'code_block':
      return (
        <pre className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-xs overflow-x-auto">
          <code className="text-slate-300">{block.code}</code>
        </pre>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('pl-4 space-y-0.5', block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, i) => (
            <li key={i} className="text-slate-300 text-sm break-words"><InlineText text={item} /></li>
          ))}
        </Tag>
      );
    }
    case 'paragraph':
      return <p className="text-slate-300 whitespace-pre-wrap break-words"><InlineText text={block.text} /></p>;
  }
}

/** Render inline formatting: **bold**, *italic*, `code`, [links] */
function InlineText({ text }: { text: string }) {
  // Split on inline patterns
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Inline code: `text`
    const codeMatch = remaining.match(/`([^`]+)`/);

    // Find the earliest match
    const matches = [
      boldMatch ? { type: 'bold' as const, match: boldMatch, index: boldMatch.index! } : null,
      codeMatch ? { type: 'code' as const, match: codeMatch, index: codeMatch.index! } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const first = matches[0]!;
    if (first.index > 0) {
      parts.push(remaining.slice(0, first.index));
    }

    if (first.type === 'bold') {
      parts.push(<strong key={key++} className="text-slate-100 font-semibold">{first.match[1]}</strong>);
    } else if (first.type === 'code') {
      parts.push(<code key={key++} className="bg-slate-800 text-cyan-300 px-1 py-0.5 rounded text-xs font-mono">{first.match[1]}</code>);
    }

    remaining = remaining.slice(first.index + first.match[0].length);
  }

  return <>{parts}</>;
}
