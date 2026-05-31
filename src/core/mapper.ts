import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { resolvePath } from '../utils/path.js';
import type { ComponentEntry, MappingCandidate } from '../types/index.js';

// ── Name normalization ──────────────────────────────────────────────────────

/** Suffixes stripped before filename comparison. */
const NAME_SUFFIXES = ['Page', 'View', 'Screen', 'Layout', 'Component', 'Container'];

/**
 * Normalize a PascalCase component name to a lowercase slug for fuzzy matching.
 * e.g. "AccountPage" → "account", "WorkDetailView" → "work-detail"
 */
function normalizeForMatch(name: string): string {
  let n = name;
  for (const s of NAME_SUFFIXES) {
    if (n.endsWith(s) && n.length > s.length) {
      n = n.slice(0, -s.length);
      break;
    }
  }
  // CamelCase → kebab-case
  return n
    .replace(/([A-Z])/g, (_, c, i: number) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`))
    .replace(/^-/, '');
}

// ── Strategy 1: file-name matching ─────────────────────────────────────────

function strategyFileName(
  component: ComponentEntry,
  codeFiles: string[],
): MappingCandidate[] {
  const slug = normalizeForMatch(component.name);
  const slugCompact = slug.replace(/-/g, ''); // "account" or "workdetail"
  const candidates: MappingCandidate[] = [];

  for (const file of codeFiles) {
    const lower = file.toLowerCase();
    const base = lower.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
    const baseCompact = base.replace(/[-_.]/g, '');

    // Check full path segments too (handles Next.js "about/page.tsx" → "about")
    const pathCompact = lower.replace(/[/_.\-]/g, '').replace(/tsx?$/, '').replace(/jsx?$/, '');

    if (baseCompact === slugCompact || pathCompact === slugCompact) {
      candidates.push({
        designComponentId: component.id,
        codePath: file,
        confidence: 0.85,
        reason: `文件名匹配 "${base}"`,
      });
    } else if (
      slugCompact.length >= 4 &&
      (baseCompact.includes(slugCompact) || slugCompact.includes(baseCompact) ||
       pathCompact.includes(slugCompact))
    ) {
      candidates.push({
        designComponentId: component.id,
        codePath: file,
        confidence: 0.5,
        reason: `文件名部分匹配 "${base}"`,
      });
    }
  }

  return candidates;
}

// ── Strategy 2: export-name matching ───────────────────────────────────────

/**
 * @param fileContents Pre-read map of codePath → file content.
 *   Pre-reading all files once avoids O(N×M) I/O when matching N components against M files.
 */
function strategyExportName(
  component: ComponentEntry,
  fileContents: Map<string, string>,
): MappingCandidate[] {
  const { name } = component;
  const candidates: MappingCandidate[] = [];

  const patterns = [
    new RegExp(`export\\s+(default\\s+)?function\\s+${name}[\\s(<]`),
    new RegExp(`export\\s+const\\s+${name}\\s*[=:]`),
    new RegExp(`export\\s+\\{[^}]*\\b${name}\\b[^}]*\\}`),
    new RegExp(`export\\s+default\\s+${name}[;\\s]`),
  ];

  for (const [file, content] of fileContents) {
    if (patterns.some((p) => p.test(content))) {
      candidates.push({
        designComponentId: component.id,
        codePath: file,
        confidence: 0.95,
        reason: `导出名匹配 "${name}"`,
      });
    }
  }

  return candidates;
}

// ── Strategy 3: HTML bridge ─────────────────────────────────────────────────

/**
 * Path-segment index built by parsing the design project's HTML entry file.
 * Key: normalized design file path (relative to designRoot, no extension, lowercase)
 * Value: path segments array — e.g. ["pages", "dashboard"]
 *
 * This is cached per `autoMap` call and shared across all components.
 */
export type HtmlBridgeIndex = Map<string, string[]>;

/**
 * Parse the design root's `index.html` (Vite / Claude Design export format)
 * to discover the JS entry file, then extract 1 level of import paths.
 *
 * Returns a map of normalizedDesignPath → path segments, or an empty map
 * if no index.html is found or parsing fails. Never throws.
 *
 * Example:
 *   index.html → <script src="/src/main.jsx">
 *   main.jsx   → import Dashboard from './pages/Dashboard.jsx'
 *              → import Header from './components/Header.jsx'
 *   Result: { "pages/dashboard" → ["pages", "dashboard"],
 *             "components/header" → ["components", "header"] }
 */
export async function buildHtmlBridgeIndex(designRoot: string): Promise<HtmlBridgeIndex> {
  const index: HtmlBridgeIndex = new Map();

  try {
    // ── Step 1: find and read index.html ─────────────────────────────────────
    const htmlPath = join(designRoot, 'index.html');
    let htmlContent: string;
    try {
      htmlContent = await readFile(htmlPath, 'utf8');
    } catch {
      return index; // No index.html — strategy silently yields nothing
    }

    // ── Step 2: extract <script src="..."> ────────────────────────────────────
    // Prefer type="module" scripts (Vite / Claude Design generates these).
    // Fall back to any <script src> whose path ends with a JS/TS extension.
    const collectSrcs = (re: RegExp): string[] => {
      const srcs: string[] = [];
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      // eslint-disable-next-line no-cond-assign
      while ((m = re.exec(htmlContent)) !== null) {
        if (m[1]) srcs.push(m[1]);
      }
      return srcs;
    };

    const moduleScriptRe = /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    const anyScriptRe = /<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

    let entrySrcs = collectSrcs(moduleScriptRe);
    if (entrySrcs.length === 0) {
      // Fallback: any <script src> pointing to a JS/TS file (not a CDN polyfill or .map)
      entrySrcs = collectSrcs(anyScriptRe).filter((s) => /\.(jsx?|tsx?|mjs)(\?.*)?$/.test(s));
    }

    let m: RegExpExecArray | null;

    if (entrySrcs.length === 0) return index;

    // ── Step 3: read the first JS/JSX/TSX entry file ─────────────────────────
    const entryRelative = entrySrcs[0]!.replace(/^\//, ''); // strip leading /
    const entryAbs = join(designRoot, entryRelative);
    let entryContent: string;
    try {
      entryContent = await readFile(entryAbs, 'utf8');
    } catch {
      return index;
    }

    // ── Step 4: parse import statements (1 level deep) ───────────────────────
    const entryDir = dirname(entryAbs);
    // Match: import X from './foo' | import { X } from '../bar' | export { X } from './baz'
    const importRe = /(?:^|\n)\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g;

    // eslint-disable-next-line no-cond-assign
    while ((m = importRe.exec(entryContent)) !== null) {
      const importPath = m[1];
      if (!importPath || !importPath.startsWith('.')) continue; // skip external modules

      // Resolve the imported path relative to the entry file
      const resolvedAbs = normalize(join(entryDir, importPath));

      // Make it relative to the design root and normalize to lowercase, no extension
      let relToDesign = relative(designRoot, resolvedAbs)
        .replace(/\\/g, '/') // Windows path separator
        .replace(/\.(jsx?|tsx?)$/, '') // strip extension
        .toLowerCase();

      // Strip leading "./"
      if (relToDesign.startsWith('./')) relToDesign = relToDesign.slice(2);

      if (!relToDesign || relToDesign.startsWith('..')) continue; // outside designRoot

      const segments = relToDesign.split('/').filter(Boolean);
      if (segments.length > 0) {
        index.set(relToDesign, segments);
      }
    }
  } catch {
    // Any unexpected error: return empty index, don't break the mapping flow
  }

  return index;
}

/**
 * Strategy 3: HTML bridge.
 *
 * For a component whose design file is referenced in the HTML entry import
 * graph, score code files by how many path segments they share with the
 * design-side path structure.
 *
 * Confidence range: 0.55 – 0.80 (intentionally below export-name at 0.95
 * and filename-exact at 0.85, so it acts as a tiebreaker or fallback booster).
 */
function strategyHtmlBridge(
  component: ComponentEntry,
  codeFiles: string[],
  bridgeIndex: HtmlBridgeIndex,
): MappingCandidate[] {
  if (bridgeIndex.size === 0) return [];

  // Normalize the component's design file path to match bridge index keys
  const designPathNorm = component.designFile
    .replace(/\\/g, '/')
    .replace(/\.(jsx?|tsx?)$/, '')
    .toLowerCase()
    .replace(/^\.\//, '');

  // Try exact key match first, then basename match
  let designSegments = bridgeIndex.get(designPathNorm);

  if (!designSegments) {
    // Fallback: match by basename (last segment).
    // Collect ALL matches — only use the hint when exactly one entry matches.
    // Ambiguous cases (two files named "Button.jsx" in different dirs) get no hint
    // rather than silently using the wrong path segments.
    const basename = designPathNorm.split('/').pop() ?? '';
    const basenameMatches: string[][] = [];
    for (const [key, segs] of bridgeIndex) {
      if (key.split('/').pop() === basename) {
        basenameMatches.push(segs);
      }
    }
    if (basenameMatches.length === 1) {
      designSegments = basenameMatches[0];
    }
  }

  if (!designSegments || designSegments.length === 0) return [];

  const candidates: MappingCandidate[] = [];
  const componentSlug = normalizeForMatch(component.name);

  for (const file of codeFiles) {
    const fileLower = file.toLowerCase().replace(/\.(tsx?|jsx?)$/, '');
    const fileSegments = fileLower.split('/').filter(Boolean);

    // Count how many design path segments appear in the code file path
    let overlap = 0;
    for (const seg of designSegments) {
      const segNorm = seg.replace(/-/g, '');
      if (fileSegments.some((fs) => fs.replace(/-/g, '') === segNorm)) {
        overlap++;
      }
    }

    if (overlap === 0) continue;

    // Extra boost if the component's slug also appears in the code path
    const nameInPath = fileSegments.some((fs) => {
      const fsCompact = fs.replace(/[-_.]/g, '');
      return fsCompact === componentSlug.replace(/-/g, '');
    });

    const baseScore = 0.45 + (overlap / designSegments.length) * 0.3;
    const confidence = nameInPath ? Math.min(0.80, baseScore + 0.15) : baseScore;

    if (confidence >= 0.5) {
      candidates.push({
        designComponentId: component.id,
        codePath: file,
        confidence,
        reason: `路径段匹配 ${overlap}/${designSegments.length}（HTML bridge）`,
      });
    }
  }

  return candidates;
}

// ── Merge & select best candidate ──────────────────────────────────────────

function mergeCandidates(
  byName: MappingCandidate[],
  byExport: MappingCandidate[],
  byBridge: MappingCandidate[],
): MappingCandidate[] {
  const byPath = new Map<string, MappingCandidate>();

  const mergeSingle = (c: MappingCandidate) => {
    const existing = byPath.get(c.codePath);
    if (existing) {
      // Multiple strategies agree → boost confidence
      byPath.set(c.codePath, {
        ...c,
        confidence: Math.min(0.99, existing.confidence + 0.1),
        reason: `${existing.reason} + ${c.reason}`,
      });
    } else {
      byPath.set(c.codePath, c);
    }
  };

  for (const c of byName) mergeSingle(c);
  for (const c of byExport) mergeSingle(c);
  for (const c of byBridge) mergeSingle(c);

  return [...byPath.values()].sort((a, b) => b.confidence - a.confidence);
}

// ── Pre-read helper ─────────────────────────────────────────────────────────

async function preReadFiles(
  files: string[],
  root: string,
): Promise<Map<string, string>> {
  const resolvedRoot = resolvePath(root);
  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        const content = await readFile(join(resolvedRoot, file), 'utf8');
        return [file, content] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is [string, string] => e !== null));
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface AutoMapOptions {
  /**
   * Minimum confidence to accept a candidate as a mapping.
   * Read from `config.mapping?.autoThreshold` in commands; defaults to 0.5.
   */
  threshold?: number;
  /**
   * Absolute path to the design root directory.
   * Enables the HTML bridge strategy (Strategy 3).
   * If omitted, Strategy 3 is skipped.
   */
  designRoot?: string;
}

export interface AutoMapResult {
  mapped: Array<{ componentId: string; candidate: MappingCandidate }>;
  unmapped: string[];
}

/**
 * Run automatic mapping strategies for the given components against the code files.
 *
 * Strategies (in order of confidence, run in parallel):
 *   1. File-name matching
 *   2. Export-name matching (reads file contents once)
 *   3. HTML bridge (traces index.html → entry JS → imports, if designRoot provided)
 *
 * Only components with best-candidate confidence >= options.threshold (default 0.5)
 * are mapped; others are returned in `unmapped`.
 *
 * Files are pre-read once and shared across all component checks (O(M) reads total,
 * not O(N×M)).
 */
export async function autoMap(
  components: ComponentEntry[],
  codeFiles: string[],
  codeRoot: string,
  options: AutoMapOptions = {},
): Promise<AutoMapResult> {
  const threshold = options.threshold ?? 0.5;

  // Pre-read all code files once to avoid N×M I/O
  const fileContents = await preReadFiles(codeFiles, codeRoot);

  // Build HTML bridge index (once, shared across all components)
  let bridgeIndex: HtmlBridgeIndex = new Map();
  if (options.designRoot) {
    bridgeIndex = await buildHtmlBridgeIndex(options.designRoot);
  }

  const mapped: AutoMapResult['mapped'] = [];
  const unmapped: string[] = [];

  for (const component of components) {
    const byName = strategyFileName(component, codeFiles);
    const byExport = strategyExportName(component, fileContents);
    const byBridge = strategyHtmlBridge(component, codeFiles, bridgeIndex);

    const candidates = mergeCandidates(byName, byExport, byBridge);
    const best = candidates[0];

    if (best && best.confidence >= threshold) {
      mapped.push({ componentId: component.id, candidate: best });
    } else {
      unmapped.push(component.id);
    }
  }

  return { mapped, unmapped };
}

/**
 * Run all strategies and return all candidates (sorted by confidence) for a single component.
 * Useful for interactive mapping inspection and `map suggest`.
 */
export async function getCandidates(
  component: ComponentEntry,
  codeFiles: string[],
  codeRoot: string,
  options: { designRoot?: string } = {},
): Promise<MappingCandidate[]> {
  const fileContents = await preReadFiles(codeFiles, codeRoot);

  let bridgeIndex: HtmlBridgeIndex = new Map();
  if (options.designRoot) {
    bridgeIndex = await buildHtmlBridgeIndex(options.designRoot);
  }

  const byName = strategyFileName(component, codeFiles);
  const byExport = strategyExportName(component, fileContents);
  const byBridge = strategyHtmlBridge(component, codeFiles, bridgeIndex);

  return mergeCandidates(byName, byExport, byBridge);
}
