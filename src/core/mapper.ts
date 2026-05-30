import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

// ── Merge & select best candidate ──────────────────────────────────────────

function mergeCandidates(
  byName: MappingCandidate[],
  byExport: MappingCandidate[],
): MappingCandidate[] {
  const byPath = new Map<string, MappingCandidate>();

  for (const c of byName) {
    byPath.set(c.codePath, c);
  }
  for (const c of byExport) {
    const existing = byPath.get(c.codePath);
    if (existing) {
      // Both strategies agree → boost confidence
      byPath.set(c.codePath, {
        ...c,
        confidence: Math.min(0.99, existing.confidence + 0.1),
        reason: `${existing.reason} + ${c.reason}`,
      });
    } else {
      byPath.set(c.codePath, c);
    }
  }

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

export interface AutoMapResult {
  mapped: Array<{ componentId: string; candidate: MappingCandidate }>;
  unmapped: string[];
}

/**
 * Run automatic mapping strategies for the given components against the code files.
 * Only components with confidence >= threshold (default 0.5) are mapped.
 *
 * Files are pre-read once and shared across all component checks (O(M) reads total,
 * not O(N×M)).
 */
export async function autoMap(
  components: ComponentEntry[],
  codeFiles: string[],
  codeRoot: string,
  threshold = 0.5,
): Promise<AutoMapResult> {
  // Pre-read all code files once to avoid N×M I/O
  const fileContents = await preReadFiles(codeFiles, codeRoot);

  const mapped: AutoMapResult['mapped'] = [];
  const unmapped: string[] = [];

  for (const component of components) {
    const byName = strategyFileName(component, codeFiles);
    const byExport = strategyExportName(component, fileContents);

    const candidates = mergeCandidates(byName, byExport);
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
 * Useful for interactive mapping inspection.
 */
export async function getCandidates(
  component: ComponentEntry,
  codeFiles: string[],
  codeRoot: string,
): Promise<MappingCandidate[]> {
  const fileContents = await preReadFiles(codeFiles, codeRoot);
  const byName = strategyFileName(component, codeFiles);
  const byExport = strategyExportName(component, fileContents);
  return mergeCandidates(byName, byExport);
}
