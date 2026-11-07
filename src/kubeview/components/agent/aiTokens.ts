/**
 * The AI colour. Violet means "this is Pulse AI" and nothing else: a
 * selected tab, a filter chip or a primary action that is not the assistant
 * uses blue (selection, primary) or slate (neutral) instead. The guard in
 * `__tests__/aiAccentReserved.test.ts` fails when violet shows up outside
 * the AI surfaces it lists.
 *
 * This module imports nothing, so store-free components (ErrorBoundary) can
 * use it without pulling the stores in.
 */
export const AI_ACCENT = {
  text: 'text-violet-400',
  textHover: 'hover:text-violet-300',
  bg: 'bg-violet-500/15',
  bgHover: 'hover:bg-violet-500/25',
  border: 'border-violet-500/30',
  borderActive: 'border-violet-500/60',
  ring: 'ring-violet-500/20',
  dot: 'bg-violet-400',
  /** The one style for an "Ask Pulse" entry point (AskPulseButton). */
  button:
    'border border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 hover:text-violet-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-violet-400',
  /** A card that holds something Pulse AI proposes ("Pulse suggests …"). */
  card: 'border border-violet-800/60',
  /** Emphasised AI text on a dark card (confidence, suspected cause). */
  textStrong: 'text-violet-300',
  /** An inline panel for work Pulse AI is doing or has done. */
  panel: 'border border-violet-800/50 bg-violet-950/30',
  /** A status chip for an AI state ("Reviewing…", "Triaged"). */
  chip: 'bg-violet-900/40 text-violet-300 border-violet-700/40',
  /** A filled action that applies something Pulse AI proposed. */
  solid: 'bg-violet-700 text-white hover:bg-violet-600',
  /** A strip across the page while Pulse AI drives it (the view builder). */
  banner: 'bg-violet-900/50 border-violet-700 text-violet-200',
  /** Focus border for an input whose text goes to Pulse AI. */
  focusBorder: 'focus:border-violet-500',
} as const;

/** Glow border class for AI-powered elements */
export const aiGlowClass = 'ring-1 ring-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.15)]';

/** Active accent for dock/tab borders when agent tab is selected */
export const aiActiveClass = 'border-b-2 border-violet-400 text-violet-400';
