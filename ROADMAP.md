# Roadmap

This document outlines the planned development path for drift-sync. Priorities may shift based on user feedback.

For completed work, see [CHANGELOG.md](./CHANGELOG.md).
For architecture details, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Current Status: v0.4.0 — Feature Complete

Phase 1–4 are fully implemented and tested (68 unit tests, 0 TypeScript errors):

| Phase | Status | Highlights |
|---|---|---|
| Phase 1 — Foundation | ✅ Done | `drift init`, StateStore, Scanner, Extractor, snapshot system |
| Phase 2 — Mapping & Diff | ✅ Done | Mapper (2 strategies), StackDetector, Differ (7 states), `drift status` |
| Phase 3 — AI + Prompts | ✅ Done | Analyzer (Claude API), PromptBuilder (bidirectional), `drift sync`, queue |
| Phase 4 — Polish | ✅ Done | `drift log`, large-file truncation, test coverage, bug fixes |

---

## Upcoming

### v0.5.0 — Config Management & npm Publish

**Goal:** Make tech stack info maintainable after `drift init`, and ship to npm.

- [ ] `drift config` command — view and update tech stack info and project conventions without re-running `drift init`
  - `drift config` — display current config
  - `drift config stack` — edit detected stack fields interactively
  - `drift config conventions` — add / remove project conventions
- [ ] `drift init --redetect` — re-run stack detection on an existing project without resetting mappings or snapshots
- [ ] Dry-run for `pnpm publish` — verify `dist/` output, `package.json` fields, and `files` allowlist
- [ ] npm publish (v0.5.0 as the first public release)

---

### v0.6.0 — Mapping Accuracy

**Goal:** Reduce the number of components that fall through to manual mapping.

- [ ] HTML bridge mapping strategy — parse the design's HTML entry file to discover which JSX components it renders, and resolve those component names to code paths
- [ ] AI-assisted mapping fallback — for components that neither filename nor export-name strategies can resolve, ask Claude to suggest the best code file given the component name and available file list
- [ ] `drift map suggest` — interactive command to review and confirm AI mapping suggestions
- [ ] Confidence threshold configuration in `drift.config.json`

---

### v0.7.0 — Diff Quality

**Goal:** Show meaningful diffs instead of "baseline → full content" placeholders.

- [ ] Store component content snapshots alongside hash snapshots so diffs show real line-by-line changes against the actual baseline content
- [ ] Colored side-by-side diff view in `drift diff` terminal output
- [ ] `drift diff --format json` — machine-readable output for CI / editor integrations

---

### v0.8.0 — Editor & CI Integration

**Goal:** Meet developers where they already work.

- [ ] VS Code extension — status bar indicator, right-click context menu for `drift sync`
- [ ] GitHub Actions workflow template — run `drift diff` in CI and post a comment with sync status
- [ ] `drift diff --ci` — exits with non-zero status when actionable changes are detected (for CI gates)
- [ ] Watch mode — `drift watch` for continuous background monitoring

---

### v1.0.0 — Stable API

**Goal:** Signal production-readiness and API stability.

- [ ] Stable CLI interface (no more breaking flag changes)
- [ ] End-to-end integration tests using fixture design + code directories
- [ ] Plugin API for custom mapping strategies
- [ ] Full documentation site (VitePress or Docusaurus)
- [ ] `drift migrate` — migrate `.drift/` state between drift-sync major versions

---

## Ideas Under Consideration

These are not yet scheduled but may be picked up based on demand:

- **Multi-workspace support** — manage multiple design↔code pairs from a single `.drift/` config
- **Figma / Sketch bridge** — export design tokens from design tools into the snapshot system
- **Merge prompt improvements** — smarter conflict resolution that generates both-sides-aware instructions
- **`drift undo`** — revert the last snapshot (restore previous baseline)
- **Telemetry (opt-in)** — anonymous usage stats to prioritize features

---

## Contributing

Issues and PRs are welcome. Before submitting a large feature, please open an issue to discuss the approach.

For architecture context, read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
