import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentEntry } from '../types/index.js';

/**
 * Read the design-side component slice (startLine..endLine) from disk.
 *
 * Returns '' on any read/parse failure so callers (snapshot, diff) continue
 * normally without crashing.
 */
export async function readDesignSlice(
  entry: ComponentEntry,
  designRoot: string,
): Promise<string> {
  try {
    const content = await readFile(join(designRoot, entry.designFile), 'utf8');
    return content.split('\n').slice(entry.designStartLine - 1, entry.designEndLine).join('\n');
  } catch {
    return '';
  }
}

/**
 * Read and join all code files for the component.
 *
 * Multi-file mappings are concatenated with a `// ── next file ──` separator
 * so the combined string can be diffed as a single unit.
 * Returns '' when the component has no code mappings.
 */
export async function readCodeSlice(
  entry: ComponentEntry,
  codeRoot: string,
): Promise<string> {
  if (entry.codeFiles.length === 0) return '';
  try {
    const contents = await Promise.all(
      entry.codeFiles.map((f) => readFile(join(codeRoot, f), 'utf8').catch(() => '')),
    );
    return contents.filter(Boolean).join('\n\n// ── next file ──\n\n');
  } catch {
    return '';
  }
}
