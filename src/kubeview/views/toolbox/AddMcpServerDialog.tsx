import { useState } from 'react';
import { X, Play, Plus, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AddMcpServerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<'sse' | 'stdio'>('sse');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; tools_count: number; error: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/agent/admin/mcp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, transport }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult(data);
      } else {
        setError(data.detail || 'Test failed');
      }
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/agent/admin/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, transport }),
      });
      const data = await res.json();
      if (res.ok) {
        onAdded();
      } else {
        setError(data.detail || 'Failed to add server');
      }
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setAdding(false);
    }
  };

  const canTest = url.trim().length > 0;
  const canAdd = name.trim().length > 0 && url.trim().length > 0 && !adding;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-100">Add MCP Server</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-mcp-server"
            className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Transport</label>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as 'sse' | 'stdio')}
            className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          >
            <option value="sse">SSE (HTTP)</option>
            <option value="stdio">stdio (subprocess)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-slate-400 mb-1">
          {transport === 'sse' ? 'Server URL' : 'Command'}
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={transport === 'sse' ? 'http://localhost:8081' : 'npx @modelcontextprotocol/server-everything'}
          className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-mono"
        />
      </div>

      {testResult && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 text-xs rounded-md border',
          testResult.connected
            ? 'bg-emerald-950/30 border-emerald-800/30 text-emerald-400'
            : 'bg-red-950/30 border-red-800/30 text-red-400',
        )}>
          {testResult.connected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {testResult.connected
            ? `Connected — ${testResult.tools_count} tools available`
            : `Connection failed: ${testResult.error}`}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-md border bg-red-950/30 border-red-800/30 text-red-400">
          <XCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={!canTest || testing}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors',
            canTest && !testing
              ? 'border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-slate-100'
              : 'border-slate-700 text-slate-600 cursor-not-allowed',
          )}
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Test Connection
        </button>
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
            canAdd
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed',
          )}
        >
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add Server
        </button>
      </div>
    </div>
  );
}
