# Migration Guide Generator

Generates upgrade documentation when breaking changes are introduced.

## When to Use
Run this agent when:
- Store shapes change (uiStore, clusterStore, argoCDStore)
- Component props change
- API paths change
- Type interfaces change
- Configuration format changes

## Instructions

1. **Identify breaking changes** by comparing the current branch with the last release tag:
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0)
   git diff $LAST_TAG..HEAD -- src/kubeview/store/ src/kubeview/engine/types/ src/kubeview/hooks/
   ```

2. **For each breaking change**, document:
   - **What changed**: Old API/shape vs new
   - **Why**: Reason for the change
   - **How to migrate**: Step-by-step instructions
   - **Example**: Before/after code snippets

3. **Check localStorage keys**: If store persistence shapes changed, note that users may need to clear `openshiftpulse-*` keys.

4. **Check operator contract**: If deployment config changed, document current `OpenShiftPulse` CR fields and linked operator migration procedure. This UI repository has no Pulse installation Helm chart.

5. **Write the guide** to `docs/MIGRATION.md` in this format:

```markdown
# Migration Guide: vX.Y.Z → vX.Y.Z

## Breaking Changes

### Change Name
**What changed:** Description
**Before:** `old code`
**After:** `new code`
**Migration:** Steps to update
```

6. **If no breaking changes found**, report "No breaking changes detected" and do not create the file.
