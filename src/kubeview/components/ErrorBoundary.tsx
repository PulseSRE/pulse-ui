import React from 'react';
import { AlertCircle, RefreshCw, Home, Bot, WifiOff } from 'lucide-react';

type BoundaryErrorKind = 'network' | 'chunk' | 'render';

function categorizeError(error: Error | null): BoundaryErrorKind {
  if (!error) return 'render';
  const msg = error.message || '';
  const name = error.name || '';
  if (name === 'ChunkLoadError' || msg.includes('Loading chunk')) return 'chunk';
  if (
    (error instanceof TypeError && (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Network request failed'))) ||
    msg.includes('ERR_CONNECTION_REFUSED') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('net::ERR_')
  ) return 'network';
  return 'render';
}

function errorSubtitle(category: BoundaryErrorKind): string {
  switch (category) {
    case 'network': return 'Network error';
    case 'chunk': return 'Update available';
    case 'render': return 'Render error';
  }
}

function errorSuggestion(category: BoundaryErrorKind): string {
  switch (category) {
    case 'network':
      return 'Check that oc proxy is running (oc proxy --port=8001) and the cluster is reachable.';
    case 'chunk':
      return 'The application was updated. Please reload to get the latest version.';
    case 'render':
      return 'An unexpected error occurred while rendering this view.';
  }
}

// Detect if CSS failed to load by checking if Tailwind classes work
function checkCssLoaded(): boolean {
  const el = document.createElement('div');
  el.className = 'bg-slate-950';
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  const computed = window.getComputedStyle(el);
  const bgColor = computed.backgroundColor;
  document.body.removeChild(el);
  // bg-slate-950 should be rgb(2, 6, 23) — if it's transparent, CSS didn't load
  return bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';
}

// Auto-reload if CSS fails to load (runs once on mount)
export function CssHealthCheck() {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (!checkCssLoaded()) {
        console.warn('CSS not loaded, reloading...');
        window.location.reload();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const category = categorizeError(this.state.error);

      // Auto-reload on chunk load errors (stale JS after rebuild)
      if (category === 'chunk') {
        return (
          <div className="flex items-center justify-center h-full bg-slate-950 p-8">
            <div className="max-w-md text-center">
              <RefreshCw className="w-10 h-10 text-blue-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-slate-100 mb-2">Page update available</h2>
              <p className="text-sm text-slate-400 mb-4">
                {errorSuggestion('chunk')}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        );
      }

      const Icon = category === 'network' ? WifiOff : AlertCircle;
      const iconColor = category === 'network' ? 'text-amber-500' : 'text-red-500';

      return (
        <div className="flex items-center justify-center h-full bg-slate-950 p-8">
          <div className="max-w-md text-center">
            <Icon className={`w-12 h-12 ${iconColor} mx-auto mb-4`} />
            <h2 className="text-xl font-bold text-slate-100 mb-1">
              {this.props.fallbackTitle || 'Something went wrong'}
            </h2>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
              {errorSubtitle(category)}
            </p>
            <p className="text-sm text-slate-400 mb-4">
              {errorSuggestion(category)}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
              <button
                onClick={() => {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const { useUIStore } = require('../store/uiStore');
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const { useAgentStore } = require('../store/agentStore');
                  useUIStore.getState().openDock('agent');
                  useAgentStore.getState().connectAndSend(
                    `The UI crashed with this error: "${this.state.error?.message}". What could cause this and how do I fix it?`
                  );
                  this.setState({ hasError: false, error: null });
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-700 hover:bg-violet-600 text-white rounded-md transition-colors"
              >
                <Bot className="w-4 h-4" />
                Ask AI
              </button>
              <button
                onClick={() => { window.location.href = '/welcome'; }}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </button>
            </div>
            <details className="mt-6 text-left">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                Error details
              </summary>
              <pre className="mt-2 text-xs text-red-400 font-mono bg-slate-900 p-3 rounded overflow-auto max-h-32">
                {this.state.error?.stack || this.state.error?.message}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
