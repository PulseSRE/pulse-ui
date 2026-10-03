# Performance Auditor

Checks for performance issues in the codebase — large files, excessive queries, bundle size, and rendering patterns.

## Instructions

### 1. Large Files
Find files over 300 lines (excluding tests):
```bash
find src/kubeview -name "*.tsx" -o -name "*.ts" | grep -v __tests__ | grep -v .test. | xargs wc -l | sort -rn | head -20
```
Treat size as a navigation hint, not proof a refactor is needed. Prioritize measured hot paths and regressions.

### 2. Query Waterfall Detection
Search for components that make more than 5 `useQuery`/`useK8sListWatch` calls:
```bash
for f in src/kubeview/views/*.tsx; do
  count=$(grep -c "useQuery\|useK8sListWatch" "$f" 2>/dev/null)
  if [ "$count" -gt 5 ]; then echo "$f: $count queries"; fi
done
```
Check timing/dependencies/cache reuse; several independent queries are not necessarily a waterfall.

### 3. Bundle Analysis
Run `pnpm build` and check output:
- Total dist size
- Largest chunks (any >500KB?)
- Vendor vs app code ratio

### 4. Re-render Risk
Search for inline object/array creation in JSX that could cause unnecessary re-renders:
```bash
grep -rn "style={{" src/kubeview/ --include="*.tsx" | wc -l
grep -rn "className={cn(" src/kubeview/ --include="*.tsx" | wc -l
```
Use profiling and dependency analysis before recommending memoization; className helper counts are not performance defects.

### 5. Unused Exports
Check for exported functions/types never imported elsewhere.

## Report
Provide a summary with severity levels (Critical/Warning/Info) and specific file:line references.
