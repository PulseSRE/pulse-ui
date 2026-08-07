# KubeView YAML Editor - Implementation Summary

This implementation provides a complete schema-aware YAML editing system for Kubernetes resources.

## Files Created

### Core Components

1. **`YamlEditor.tsx`** (Main editor component)
   - CodeMirror-based YAML editor with oneDark theme
   - Line numbers, fold gutter, bracket matching, active line highlighting
   - Cmd+S / Ctrl+S save shortcut
   - Status bar with line/column position, language indicator, error count
   - K8s-aware autocomplete: top-level/nested keyword completion plus common value completion (`kind`, `apiVersion`, restart policies, etc.), triggered via `@codemirror/autocomplete`
   - Built-in YAML linter (`@codemirror/lint`): flags tabs, odd (non-2-space) indentation, and missing required `apiVersion`/`kind`/`metadata` fields as inline diagnostics
   - Context-aware sub-snippets: detects the resource `kind` in the document and offers kind-specific fragments (e.g. "Readiness Probe" and "Container" for `Deployment`/`Pod`/etc., "Service Port" for `Service`, "Storage Class" for `PersistentVolumeClaim`) via a side panel
   - Inline diff panel (toggled by a "Diff" toolbar button) showing the current buffer against `originalValue` directly in the editor, separate from the pre-save `DiffPreview` modal
   - Help side panel with keyboard-shortcut reference and usage tips
   - Height customization, read-only mode
   - Props: `value`, `onChange`, `readOnly`, `height`, `onSave`, `showDiff`, `originalValue`, `resourceGvk`

2. **`DiffPreview.tsx`** (Pre-save diff preview)
   - LCS-based line-by-line diff algorithm
   - Red for removed lines (`text-red-400 bg-red-950/30`)
   - Green for added lines (`text-emerald-400 bg-emerald-950/30`)
   - Collapsible detail view with expand/collapse
   - Shows +/- change counts
   - Apply/Discard buttons with loading state
   - Change summary extraction from YAML paths
   - Props: `original`, `modified`, `onApply`, `onDiscard`, `loading`

3. **`SchemaPanel.tsx`** (Schema documentation panel)
   - Right-side panel showing field documentation
   - Hierarchical tree view of resource schema, with search-to-filter
   - Field details: type, required status, description, default, enum, min/max, pattern
   - Fetches **live** OpenAPI schemas via `fetchSchema()` in `engine/schema.ts` (tries OpenAPI v3 first, falls back to the v2/Swagger endpoint), with an in-memory cache — no mock data
   - Auto-detects the resource's GVK from `apiVersion`/`kind` in the YAML content if no `gvk` prop is passed
   - Props: `gvk?`, `yamlContent?`, `onInsertField?`

4. **`SnippetEngine.ts`** (Resource snippets)
   - 29 built-in snippets for common resources, spanning:
     - **Core workloads:** `deploy` (Deployment), `svc` (Service), `ing` (Ingress), `cm` (ConfigMap), `secret` (Secret), `rb` (RoleBinding), `cj` (CronJob), `hpa` (HorizontalPodAutoscaler), `ns` (Namespace), `sa` (ServiceAccount), `np` (NetworkPolicy)
     - **Storage:** `pvc`, `pvc-rwx` (ReadWriteMany), `pvc-block` (Block Volume), `pvc-snapshot`, `pvc-clone`, `volumesnapshot`, `storageclass`
     - **Autoscaling:** `hpa`, `clusterautoscaler`, `machineautoscaler`
     - **Operators / GitOps (OLM Subscriptions):** `sub-logging`, `sub-loki`, `sub-coo`, `sub-externalsecrets`, `sub-oadp`, `sub-quay`, `sub-gitops`
     - **Logging:** `lokistack`, `clusterlogforwarder`
   - Functions: `getSnippetSuggestions(prefix)`, `resolveSnippet(snippet)`
   - Placeholder resolution: `${N:default}` → `default`

5. **`DryRunPanel.tsx`** (Server-side dry-run validation)
   - Submits the current YAML to the K8s API with `?dryRun=All` (`POST` for create, `PUT` for update) to validate against the live API server without persisting anything
   - Shows validation errors (including field-level causes from the K8s API response), server-emitted `Warning` header text, and a diff of server-applied defaults (fields the API server would add/change)
   - Collapsible "server-applied defaults" list and full server-result YAML preview (new lines highlighted)
   - Auto-runs on mount, with a manual "Re-validate" button
   - Props: `yaml`, `apiPath`, `method` (`'POST' | 'PUT'`), `onClose`

### Supporting Files

6. **`IMPLEMENTATION.md`** - This file
7. **`QUICK_START.md`** - Quick-start usage guide
8. **`__tests__/SnippetEngine.test.ts`** - Snippet engine tests (8 tests)
9. **`__tests__/DiffPreview.test.tsx`** - DiffPreview component tests (4 tests)
10. **`__tests__/MultiDocHandler.test.ts`** - Orphaned: tests multi-document YAML parsing logic in isolation; there is no `MultiDocHandler` component in the codebase (9 tests)
11. **`__tests__/PasteDetector.test.ts`** - Orphaned: tests paste-detection logic in isolation; there is no `PasteDetector` component in the codebase (8 tests)

> **Not implemented:** `MultiDocHandler.tsx`, `PasteDetector.tsx`, a barrel `index.ts`, and an `examples/` directory were planned/explored (their logic is partially covered by the two orphaned test files above) but were never built. There is no `README.md` in this directory today — this file and `QUICK_START.md` are the only docs. All real imports use direct file paths (e.g. `import YamlEditor from '@/kubeview/components/yaml/YamlEditor'`), not a barrel import.

## Design System Compliance

All components follow the project's dark theme design system:

- **Backgrounds:**
  - Editor: `slate-950` (darker than cards)
  - Schema panel: `slate-800`
  - Cards/containers: `slate-900`

- **Colors:**
  - Added lines: `text-emerald-400 bg-emerald-950/30`
  - Removed lines: `text-red-400 bg-red-950/30`
  - Primary accent: `emerald-600` (hover: `emerald-500`)
  - Borders: `slate-700`

- **Typography:**
  - Monospace code: 13px
  - UI text: Tailwind default font stack
  - No emojis (per project guidelines)

- **CSS Approach:**
  - 100% Tailwind CSS utility classes
  - No custom CSS files
  - Uses `cn()` utility for conditional classes

## Dependencies Used

All dependencies are already installed in the project:

- `@uiw/react-codemirror` v4.25.8 - CodeMirror React wrapper
- `@codemirror/lang-yaml` v6.1.2 - YAML syntax highlighting
- `@codemirror/theme-one-dark` v6.1.3 - Dark theme
- `@codemirror/view` - Editor view utilities
- `@codemirror/language` - Language support
- `lucide-react` v0.576.0 - Icons
- `clsx` + `tailwind-merge` - Class name utilities (via `cn()`)

## Integration Points

### With Existing YamlEditor

The old PatternFly-based `/src/components/YamlEditor.tsx` (JSON/YAML toggle, clean view, minimap) has since been removed — this Tailwind-based, schema-aware editor in `/src/kubeview/components/yaml/` is now the only YAML editor in the codebase. It's used via `src/kubeview/views/YamlEditorView.tsx`.

### Code Splitting

The editor can be lazy-loaded to reduce initial bundle size:

```tsx
import { lazy, Suspense } from 'react';

const YamlEditor = lazy(() => import('@/kubeview/components/yaml/YamlEditor'));

function App() {
  return (
    <Suspense fallback={<div>Loading editor...</div>}>
      <YamlEditor ... />
    </Suspense>
  );
}
```

### K8s API Integration

1. **YamlEditor `onSave`**: the caller wires this to a real K8s API request — the editor itself is transport-agnostic:
   ```tsx
   const handleSave = async (value: string) => {
     const res = await fetch(apiUrl, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/yaml' },
       body: value,
     });
     // Handle response...
   };
   ```
   For pre-flight validation before committing to that PUT/POST, pair it with `DryRunPanel` (see above), which calls the same endpoint with `?dryRun=All`.

2. **SchemaPanel**: already fetches live schemas — no integration work needed. It calls `fetchSchema(group, version, kind)` from `engine/schema.ts`, which hits `${K8S_BASE}/openapi/v3/apis/{group}/{version}` (falling back to `${K8S_BASE}/openapi/v2`) and caches both the raw OpenAPI spec and the parsed per-resource schema in memory.

## Testing

29 tests total across 4 files in `__tests__/`, though only 2 files map to components that actually exist:

- `SnippetEngine.test.ts`: 8 tests covering snippet search, resolution, structure (real — tests `SnippetEngine.ts`)
- `DiffPreview.test.tsx`: 4 tests covering rendering, interaction, loading states (real — tests `DiffPreview.tsx`)
- `MultiDocHandler.test.ts`: 9 tests — orphaned, tests parsing logic extracted from a `MultiDocHandler` component that was never built
- `PasteDetector.test.ts`: 8 tests — orphaned, tests detection logic extracted from a `PasteDetector` component that was never built

Run tests:
```bash
pnpm test -- yaml
```

## Usage Examples

All imports below use direct file paths — there is no barrel `index.ts` in this directory.

### Basic Editor

```tsx
import YamlEditor from '@/kubeview/components/yaml/YamlEditor';

<YamlEditor
  value={yaml}
  onChange={setYaml}
  onSave={handleSave}
  height="600px"
/>
```

### With Diff Preview

```tsx
<YamlEditor
  value={yaml}
  onChange={setYaml}
  originalValue={originalYaml}
  onSave={handleSave}
  showDiff={true}
/>
```

### With Schema Panel

```tsx
import SchemaPanel from '@/kubeview/components/yaml/SchemaPanel';

<div className="flex">
  <YamlEditor resourceGvk={{ group: 'apps', version: 'v1', kind: 'Deployment' }} ... />
  <SchemaPanel
    gvk={{ group: 'apps', version: 'v1', kind: 'Deployment' }}
    onInsertField={(path, example) => console.log('Insert', path, example)}
  />
</div>
```

### With Dry-Run Validation Before Save

```tsx
import { DryRunPanel } from '@/kubeview/components/yaml/DryRunPanel';

{showDryRun && (
  <DryRunPanel
    yaml={yaml}
    apiPath="/apis/apps/v1/namespaces/default/deployments/my-app"
    method="PUT"
    onClose={() => setShowDryRun(false)}
  />
)}
```

## Performance Considerations

1. **Code Splitting**: Use `React.lazy()` to load editor on demand
2. **Large Files**: Diff algorithm skips computation for files > 5000 lines
3. **Memoization**: Expensive computations use `useMemo`
4. **Event Listeners**: Properly cleaned up in `useEffect` return functions

## Future Enhancements

Potential improvements for future versions (note: live OpenAPI schema fetching, server-side dry-run validation, and a basic structural YAML linter are already implemented — see `SchemaPanel.tsx`, `DryRunPanel.tsx`, and the linter in `YamlEditor.tsx` above):

1. **Schema-driven autocomplete**: Autocomplete currently offers a static list of common K8s keywords/values — wiring it to the live schema from `SchemaPanel`/`engine/schema.ts` would make suggestions resource-aware
2. **Field Navigation**: Jump from the editor cursor directly to the matching field in `SchemaPanel`
3. **Snippet Customization**: User-defined custom snippets
4. **Undo/Redo Stack**: Enhanced history management
5. **Collaborative Editing**: Real-time multi-user support
6. **YAML Formatting**: Auto-format on paste/save
7. **Search/Replace**: Advanced find/replace in editor
8. **Minimap**: Visual overview for large files
9. **Multi-document support**: Detecting and handling `---`-separated multi-resource YAML (explored in the orphaned `MultiDocHandler.test.ts`/`PasteDetector.test.ts` logic, but no UI was ever built)

## File Structure

```
src/kubeview/components/yaml/
├── YamlEditor.tsx           # Main editor component (autocomplete, linter, sub-snippets, inline diff, help panel)
├── DiffPreview.tsx          # Pre-save diff preview with apply/discard
├── SchemaPanel.tsx          # Live OpenAPI schema documentation panel
├── SnippetEngine.ts         # 29 built-in resource snippets
├── DryRunPanel.tsx          # Server-side dry-run validation panel
├── IMPLEMENTATION.md        # This file
├── QUICK_START.md           # Quick-start usage guide
└── __tests__/
    ├── SnippetEngine.test.ts    # Real — tests SnippetEngine.ts
    ├── DiffPreview.test.tsx     # Real — tests DiffPreview.tsx
    ├── MultiDocHandler.test.ts  # Orphaned — no MultiDocHandler component exists
    └── PasteDetector.test.ts    # Orphaned — no PasteDetector component exists
```

## Summary

This implementation provides a schema-aware YAML editing system for Kubernetes resources with:

- ✅ K8s-aware autocomplete, structural YAML linting, and context-aware sub-snippets
- ✅ Diff preview with LCS algorithm, plus an inline diff view in the editor itself
- ✅ 29 built-in resource snippets across workloads, storage, autoscaling, operators/GitOps, and logging
- ✅ Live OpenAPI schema panel (v3 with v2/Swagger fallback, cached)
- ✅ Server-side dry-run validation panel (`DryRunPanel`)
- ✅ Dark theme design system compliance
- ✅ 12 unit tests covering the components that actually ship (`SnippetEngine`, `DiffPreview`) — plus 17 more in two orphaned test files for a `MultiDocHandler`/`PasteDetector` that were never built
- ✅ Code-splitting ready
- ✅ TypeScript types throughout
- ✅ No dependencies added (all already installed)
- ❌ No multi-document YAML support or paste-detection UI yet (logic was explored, see orphaned tests above, but no component was built)

The components are modular and can be used independently or composed together for a full-featured editing experience.
