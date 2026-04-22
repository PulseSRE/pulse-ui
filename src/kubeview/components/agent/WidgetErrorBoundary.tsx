import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  title: string;
  kind: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class WidgetErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-red-900/50 bg-red-950/10 p-4 flex flex-col items-center justify-center text-center min-h-[120px]">
          <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
          <p className="text-sm font-medium text-red-300 mb-1">
            {this.props.title || this.props.kind} failed to render
          </p>
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors mt-2"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
          <details className="mt-2 text-left w-full max-w-md">
            <summary className="text-[10px] text-slate-600 cursor-pointer hover:text-slate-400">
              Error details
            </summary>
            <pre className="mt-1 text-[10px] text-red-400/70 bg-slate-950 rounded p-2 overflow-auto max-h-24 whitespace-pre-wrap">
              {this.state.error?.message || 'Unknown error'}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
