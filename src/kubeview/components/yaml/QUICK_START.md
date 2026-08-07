# Quick Start Guide

## Installation

All dependencies are already installed. There is no barrel `index.ts` in this directory — import directly from each file:

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';
```

## Common Use Cases

### 1. Simple Read-Only Viewer

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';

<YamlEditor
  value={resourceYaml}
  readOnly={true}
  height="400px"
/>
```

### 2. Editable with Save

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';
import { useState } from 'react';

function MyEditor() {
  const [yaml, setYaml] = useState(initialYaml);

  const handleSave = async (value: string) => {
    await fetch('/api/kubernetes/...', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/yaml' },
      body: value,
    });
  };

  return (
    <YamlEditor
      value={yaml}
      onChange={setYaml}
      onSave={handleSave}
    />
  );
}
```

### 3. With Diff Preview Before Save

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';
import { useState } from 'react';

function EditorWithDiff() {
  const [yaml, setYaml] = useState(currentYaml);
  const [original] = useState(originalYaml); // Keep original for comparison

  return (
    <YamlEditor
      value={yaml}
      onChange={setYaml}
      originalValue={original}
      onSave={handleSave}
      showDiff={true}  // Shows diff preview before save
    />
  );
}
```

### 4. Server-Side Dry-Run Validation

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';
import { DryRunPanel } from '@/kubeview/components/yaml/DryRunPanel';
import { useState } from 'react';

function EditorWithDryRun() {
  const [yaml, setYaml] = useState(currentYaml);
  const [showDryRun, setShowDryRun] = useState(false);

  return (
    <>
      <YamlEditor value={yaml} onChange={setYaml} onSave={handleSave} />

      {showDryRun && (
        <DryRunPanel
          yaml={yaml}
          apiPath="/apis/apps/v1/namespaces/default/deployments/my-app"
          method="PUT"
          onClose={() => setShowDryRun(false)}
        />
      )}
    </>
  );
}
```

`DryRunPanel` submits the YAML to the K8s API with `?dryRun=All`, so it validates against the live API server (field errors, server warnings, and defaults that would be applied) without persisting anything.

### 5. Insert Snippets

```tsx
import { snippets, resolveSnippet } from '@/kubeview/components/yaml/SnippetEngine';

// Get all snippets
const allSnippets = snippets;

// Search for specific snippet
const deploySnippet = snippets.find(s => s.prefix === 'deploy');

// Resolve placeholder values
const yaml = resolveSnippet(deploySnippet);
// Returns: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n..."

// Insert into editor
setYaml(yaml);
```

### 6. Complete Editor with Schema Panel

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';
import SchemaPanel from '@/kubeview/components/yaml/SchemaPanel';
import { useState } from 'react';

function CompleteEditor() {
  const [yaml, setYaml] = useState(initialYaml);

  return (
    <div className="flex h-screen">
      <div className="flex-1">
        <YamlEditor
          value={yaml}
          onChange={setYaml}
          onSave={handleSave}
          showDiff={true}
          resourceGvk={{ group: 'apps', version: 'v1', kind: 'Deployment' }}
        />
      </div>

      <div className="w-96">
        <SchemaPanel
          gvk={{ group: 'apps', version: 'v1', kind: 'Deployment' }}
          onInsertField={(path, example) => {
            console.log('Insert field:', path, example);
          }}
        />
      </div>
    </div>
  );
}
```

`SchemaPanel` fetches the live OpenAPI schema for the given `gvk` (or auto-detects it from `yamlContent` if `gvk` isn't passed) via `fetchSchema()` in `engine/schema.ts` — no mock data, and results are cached in memory.

## Available Snippets

29 built-in snippets across five categories. Use these prefixes to get YAML templates:

**Core workloads**

| Prefix | Resource | Description |
|--------|----------|-------------|
| `deploy` | Deployment | Standard deployment with container |
| `svc` | Service | ClusterIP service |
| `ing` | Ingress | Ingress with host/path rules |
| `cm` | ConfigMap | Configuration data |
| `secret` | Secret | Opaque secret |
| `rb` | RoleBinding | RBAC role binding |
| `cj` | CronJob | Scheduled job |
| `hpa` | HorizontalPodAutoscaler | Pod autoscaler |
| `ns` | Namespace | New namespace |
| `sa` | ServiceAccount | Service account |
| `np` | NetworkPolicy | Network policy rules |

**Storage**

| Prefix | Resource | Description |
|--------|----------|-------------|
| `pvc` | PersistentVolumeClaim | Storage claim |
| `pvc-rwx` | PVC (ReadWriteMany) | Shared PVC for multiple pods |
| `pvc-block` | PVC (Block Volume) | Raw block device for databases/high-perf I/O |
| `pvc-snapshot` | PVC from Snapshot | Restore a PVC from a VolumeSnapshot |
| `pvc-clone` | PVC Clone | Clone an existing PVC |
| `volumesnapshot` | VolumeSnapshot | Point-in-time snapshot of a PVC |
| `storageclass` | StorageClass | Dynamic provisioning storage class |

**Autoscaling**

| Prefix | Resource | Description |
|--------|----------|-------------|
| `clusterautoscaler` | ClusterAutoscaler | Cluster-wide node autoscaling |
| `machineautoscaler` | MachineAutoscaler | Min/max replicas for a MachineSet |

**Operators / GitOps**

| Prefix | Resource | Description |
|--------|----------|-------------|
| `sub-logging` | Cluster Logging Operator | Log collection operator subscription |
| `sub-loki` | Loki Operator | Scalable log storage operator subscription |
| `sub-coo` | Cluster Observability Operator | Monitoring/tracing/dashboards subscription |
| `sub-externalsecrets` | External Secrets Operator | Vault/AWS/GCP secret sync subscription |
| `sub-oadp` | OADP Operator | Backup/restore operator subscription |
| `sub-quay` | Quay Operator | Enterprise container registry subscription |
| `sub-gitops` | OpenShift GitOps (ArgoCD) | Declarative cluster management subscription |

**Logging**

| Prefix | Resource | Description |
|--------|----------|-------------|
| `lokistack` | LokiStack | Log storage instance |
| `clusterlogforwarder` | ClusterLogForwarder | Log collection and forwarding config |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+S` / `Ctrl+S` | Save (triggers onSave callback) |
| `Cmd+F` / `Ctrl+F` | Search (opens CodeMirror search) |
| `Esc` | Cancel edit / close dialogs |

## Props Reference

### YamlEditor

```tsx
interface YamlEditorProps {
  value: string;                    // Current YAML content
  onChange?: (value: string) => void; // Change handler
  readOnly?: boolean;               // Read-only mode (default: false)
  height?: string;                  // CSS height (default: "100%")
  onSave?: (value: string) => void; // Save handler (Cmd+S)
  showDiff?: boolean;               // Show diff preview (default: false)
  originalValue?: string;           // Original for diff comparison
  resourceGvk?: {                   // For schema features
    group: string;
    version: string;
    kind: string;
  };
}
```

### DiffPreview

```tsx
interface DiffPreviewProps {
  original: string;                 // Original YAML
  modified: string;                 // Modified YAML
  onApply: () => void;             // Apply changes
  onDiscard: () => void;           // Discard changes
  loading?: boolean;               // Show loading state
}
```

### SchemaPanel

```tsx
interface SchemaPanelProps {
  gvk?: {                           // Resource type (optional if yamlContent is provided)
    group: string;
    version: string;
    kind: string;
  };
  yamlContent?: string;             // Used to auto-detect GVK from apiVersion/kind if gvk isn't passed
  onInsertField?: (path: string, example: string) => void; // Insert-field callback
}
```

### DryRunPanel

```tsx
interface DryRunPanelProps {
  yaml: string;                     // YAML to validate
  apiPath: string;                  // K8s API path, e.g. /apis/apps/v1/namespaces/default/deployments/my-app
  method: 'POST' | 'PUT';           // POST for create, PUT for update
  onClose: () => void;
}
```

## Styling

All components use Tailwind CSS with dark theme:

- **Background colors:** `slate-950`, `slate-900`, `slate-800`
- **Border color:** `slate-700`
- **Text colors:** `white`, `slate-300`, `slate-400`
- **Accent color:** `emerald-600` / `emerald-500`
- **Error color:** `red-400` / `red-950`
- **Success color:** `emerald-400` / `emerald-950`

## Code Splitting

Reduce initial bundle size by lazy loading:

```tsx
import { lazy, Suspense } from 'react';

const YamlEditor = lazy(() => import('@/kubeview/components/yaml/YamlEditor'));

function App() {
  return (
    <Suspense fallback={<div className="text-white">Loading editor...</div>}>
      <YamlEditor value={yaml} onChange={setYaml} />
    </Suspense>
  );
}
```

## Testing

The components are tested with Vitest. There are 4 files in `__tests__/` (29 tests total), but only 2 map to components that actually exist — `SnippetEngine.test.ts` (8 tests) and `DiffPreview.test.tsx` (4 tests). `MultiDocHandler.test.ts` (9 tests) and `PasteDetector.test.ts` (8 tests) are orphaned: they test logic extracted from components that were explored but never built.

```tsx
import { render, screen } from '@testing-library/react';
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';

test('renders editor', () => {
  render(<YamlEditor value="apiVersion: v1\nkind: Pod" />);
  // Add assertions...
});
```

Run tests:
```bash
pnpm test -- yaml
```

## Common Issues

### Editor not showing
- Check that height is set (default is "100%", parent must have height)
- Ensure CodeMirror CSS is loaded (should be automatic)

### Save not triggering
- Ensure `onSave` prop is provided
- Check that `readOnly` is not `true`
- Verify there are changes between `value` and `originalValue`

### Diff not showing
- Set `showDiff={true}`
- Provide `originalValue` prop
- Ensure `value` differs from `originalValue`

### Dry-run validation not showing
- Render `<DryRunPanel>` only when you actually want to validate (e.g. `showDryRun` state), it auto-runs on mount
- Ensure `apiPath` matches a real K8s API path the current user can access
- Check the browser console/network tab if the panel shows no result — a 404/403 usually means the `apiPath` or RBAC is wrong

## Next Steps

See `IMPLEMENTATION.md` for implementation details and architecture.
