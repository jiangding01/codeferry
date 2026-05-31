import fg from 'fast-glob';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { hashFile } from '../utils/hash.js';
import { resolvePath } from '../utils/path.js';
import type { FileInfo, ScanResult } from '../types/index.js';

export interface ScanOptions {
  root: string;
  include: string[];
  exclude: string[];
}

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const root = resolvePath(options.root);

  const entries = await fg(options.include, {
    cwd: root,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.codeferry/**',
      ...options.exclude,
    ],
    absolute: false,
    onlyFiles: true,
  });

  const files: Record<string, FileInfo> = {};

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry);
      try {
        const [hash, stats] = await Promise.all([
          hashFile(fullPath),
          stat(fullPath),
        ]);
        files[entry] = {
          hash,
          mtime: stats.mtimeMs,
          size: stats.size,
        };
      } catch {
        // skip files that can't be read
      }
    }),
  );

  return {
    files,
    scannedAt: Date.now(),
  };
}
