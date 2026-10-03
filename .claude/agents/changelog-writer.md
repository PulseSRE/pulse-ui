# Changelog Writer

Generates a CHANGELOG.md entry for the next release by analyzing git history.

## Instructions

1. Read the current `CHANGELOG.md` to understand the format and find the latest version.

2. Run `git log --oneline $(git describe --tags --abbrev=0)..HEAD` to get all commits since the last release tag.

3. Categorize each commit into:
   - **Added** — new features, views, components, integrations
   - **Changed** — modifications to existing features, refactors, dependency updates
   - **Fixed** — bug fixes, parsing fixes, UI corrections
   - **Security** — CVE fixes, image updates, hardening

4. For each category, write concise bullet points. Group related commits into single entries. Use bold for feature names.

5. Count the current test stats by running `pnpm exec vitest --run --reporter=dot 2>&1 | tail -5`.

6. If useful, count files for this revision: `find src/kubeview -name "*.tsx" -o -name "*.ts" | grep -v node_modules | grep -v __tests__ | grep -v .test. | wc -l`

7. Read `package.json` for the current version number.

8. Generate the new entry in this format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- **Feature name** — brief description

### Changed
- **What changed** — brief description

### Fixed
- Description of fix

### Security
- Security change description

### Stats
- **N tests** across M test files
- Health-check changes (report only verified current counts)
- **N views**, N routes
```

9. Prepend the new entry to `CHANGELOG.md` (after the `# Changelog` header, before the previous version entry).

10. Do NOT modify any other files. Only edit `CHANGELOG.md`.
