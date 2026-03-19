import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Plus, Package, Image, Box, AlertCircle, Loader2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { K8S_BASE as BASE } from '../../engine/gvr';
import DeployProgress from '../../components/DeployProgress';
import { FormField } from './FormField';

interface EnvVar { name: string; value: string }

export function QuickDeployTab() {
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [port, setPort] = useState('');
  const [replicas, setReplicas] = useState('1');
  const [createRoute, setCreateRoute] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployedApp, setDeployedApp] = useState<{ name: string; ns: string } | null>(null);

  // Environment variables
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const addEnvVar = () => setEnvVars(prev => [...prev, { name: '', value: '' }]);
  const removeEnvVar = (idx: number) => setEnvVars(prev => prev.filter((_, i) => i !== idx));
  const updateEnvVar = (idx: number, field: 'name' | 'value', val: string) =>
    setEnvVars(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  // Resource limits
  const [cpuRequest, setCpuRequest] = useState('');
  const [cpuLimit, setCpuLimit] = useState('');
  const [memRequest, setMemRequest] = useState('');
  const [memLimit, setMemLimit] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';

  const handleDeploy = async () => {
    if (!name.trim() || !image.trim()) {
      addToast({ type: 'error', title: 'Name and image are required' });
      return;
    }
    setDeploying(true);
    try {
      const container: any = {
        name: name.trim(),
        image: image.trim(),
      };
      if (port) container.ports = [{ containerPort: parseInt(port) }];

      const validEnvVars = envVars.filter(e => e.name.trim());
      if (validEnvVars.length > 0) {
        container.env = validEnvVars.map(e => ({ name: e.name.trim(), value: e.value }));
      }

      const resources: any = {};
      if (cpuRequest || memRequest) {
        resources.requests = {};
        if (cpuRequest) resources.requests.cpu = cpuRequest;
        if (memRequest) resources.requests.memory = memRequest;
      }
      if (cpuLimit || memLimit) {
        resources.limits = {};
        if (cpuLimit) resources.limits.cpu = cpuLimit;
        if (memLimit) resources.limits.memory = memLimit;
      }
      if (Object.keys(resources).length > 0) container.resources = resources;

      const deployment = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: name.trim(), namespace: ns, labels: { app: name.trim() } },
        spec: {
          replicas: parseInt(replicas) || 1,
          selector: { matchLabels: { app: name.trim() } },
          template: {
            metadata: { labels: { app: name.trim() } },
            spec: {
              containers: [container],
            },
          },
        },
      };

      const depRes = await fetch(`${BASE}/apis/apps/v1/namespaces/${ns}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deployment),
      });
      if (!depRes.ok) {
        const err = await depRes.json().catch(() => ({ message: depRes.statusText }));
        throw new Error(err.message);
      }

      if (port) {
        const service = {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: name.trim(), namespace: ns, labels: { app: name.trim() } },
          spec: {
            selector: { app: name.trim() },
            ports: [{ port: parseInt(port), targetPort: parseInt(port), protocol: 'TCP' }],
          },
        };
        await fetch(`${BASE}/api/v1/namespaces/${ns}/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(service),
        });

        if (createRoute) {
          const route = {
            apiVersion: 'route.openshift.io/v1',
            kind: 'Route',
            metadata: { name: name.trim(), namespace: ns, labels: { app: name.trim() } },
            spec: {
              to: { kind: 'Service', name: name.trim() },
              port: { targetPort: parseInt(port) },
              tls: { termination: 'edge' },
            },
          };
          await fetch(`${BASE}/apis/route.openshift.io/v1/namespaces/${ns}/routes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(route),
          }).catch(() => {});
        }
      }

      addToast({ type: 'success', title: `Application "${name}" created`, detail: `Watching rollout in ${ns}` });
      setDeployedApp({ name: name.trim(), ns });
    } catch (err) {
      addToast({ type: 'error', title: 'Deploy failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setDeploying(false);
  };

  return (
    <div className="space-y-6">
      {deployedApp && (
        <DeployProgress
          type="deployment"
          name={deployedApp.name}
          namespace={deployedApp.ns}
          onClose={() => setDeployedApp(null)}
        />
      )}

      <div className="bg-slate-900 rounded-lg border border-slate-800 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Image className="w-4 h-4 text-blue-400" />
          Deploy from Container Image
        </h2>
        <p className="text-xs text-slate-500">Creates a Deployment, Service, and Route for your application</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Application Name" required value={name} onChange={setName} placeholder="my-app" />
          <FormField label="Container Image" required value={image} onChange={setImage} placeholder="nginx:latest or quay.io/org/image:tag" />
          <FormField label="Container Port" value={port} onChange={setPort} placeholder="8080 (optional — creates Service)" type="number" />
          <FormField label="Replicas" value={replicas} onChange={setReplicas} placeholder="1" type="number" />
        </div>

        {port && (
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={createRoute} onChange={(e) => setCreateRoute(e.target.checked)} className="rounded" />
            Create Route (expose externally via HTTPS)
          </label>
        )}

        {/* Environment Variables */}
        <div className="border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-slate-400">Environment Variables</label>
            <button onClick={addEnvVar} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Variable
            </button>
          </div>
          {envVars.length === 0 && (
            <p className="text-xs text-slate-600">No environment variables configured</p>
          )}
          {envVars.map((env, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-2">
              <input type="text" value={env.name} onChange={(e) => updateEnvVar(idx, 'name', e.target.value)} placeholder="NAME"
                className="flex-1 px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <span className="text-slate-600">=</span>
              <input type="text" value={env.value} onChange={(e) => updateEnvVar(idx, 'value', e.target.value)} placeholder="value"
                className="flex-1 px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={() => removeEnvVar(idx)} className="p-1 text-slate-500 hover:text-red-400" title="Remove">
                <AlertCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Advanced: Resource Limits */}
        <div className="border-t border-slate-800 pt-4">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs font-medium text-slate-400 hover:text-slate-300 flex items-center gap-1">
            {showAdvanced ? '▾' : '▸'} Resource Limits
            {(cpuRequest || cpuLimit || memRequest || memLimit) && <span className="text-blue-400 ml-1">(configured)</span>}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <FormField label="CPU Request" value={cpuRequest} onChange={setCpuRequest} placeholder="100m" />
              <FormField label="CPU Limit" value={cpuLimit} onChange={setCpuLimit} placeholder="500m" />
              <FormField label="Memory Request" value={memRequest} onChange={setMemRequest} placeholder="128Mi" />
              <FormField label="Memory Limit" value={memLimit} onChange={setMemLimit} placeholder="512Mi" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleDeploy} disabled={deploying || !name.trim() || !image.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
            {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Box className="w-4 h-4" />}
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
          <span className="text-xs text-slate-500">Namespace: <span className="text-slate-300">{ns}</span></span>
        </div>
      </div>

      {/* Quick examples */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Examples</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { name: 'nginx', image: 'nginxinc/nginx-unprivileged:latest', port: '8080', desc: 'Nginx web server (non-root)' },
            { name: 'httpd', image: 'registry.access.redhat.com/ubi9/httpd-24:latest', port: '8080', desc: 'Apache HTTP server (UBI)' },
            { name: 'redis', image: 'registry.access.redhat.com/rhel9/redis-7:latest', port: '6379', desc: 'Redis in-memory store (UBI)' },
          ].map((ex) => (
            <button key={ex.name} onClick={() => { setName(ex.name); setImage(ex.image); setPort(ex.port); }}
              className="flex items-start gap-3 p-3 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors text-left">
              <Package className="w-4 h-4 text-blue-400 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-200">{ex.name}</div>
                <div className="text-xs text-slate-500">{ex.desc}</div>
                <div className="text-xs text-slate-600 font-mono mt-1">{ex.image}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
