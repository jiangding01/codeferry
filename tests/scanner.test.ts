import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scan } from '../src/core/scanner.js';

const DESIGN_FIXTURES = join(import.meta.dirname, 'fixtures', 'mini-design');
const CODE_FIXTURES = join(import.meta.dirname, 'fixtures', 'mini-code');

describe('scan', () => {
  it('scans design directory for JSX files', async () => {
    const result = await scan({
      root: DESIGN_FIXTURES,
      include: ['**/*.jsx'],
      exclude: [],
    });

    const files = Object.keys(result.files);
    expect(files.length).toBe(2);
    expect(files).toContain('components/shared.jsx');
    expect(files).toContain('components/pages.jsx');
  });

  it('scans code directory for TSX files', async () => {
    const result = await scan({
      root: CODE_FIXTURES,
      include: ['**/*.tsx', '**/*.ts'],
      exclude: [],
    });

    const files = Object.keys(result.files);
    expect(files.length).toBe(3);
    expect(files).toContain('src/page.tsx');
    expect(files).toContain('src/about/page.tsx');
    expect(files).toContain('src/components/shared.tsx');
  });

  it('returns hash, mtime, and size for each file', async () => {
    const result = await scan({
      root: DESIGN_FIXTURES,
      include: ['**/*.jsx'],
      exclude: [],
    });

    const file = result.files['components/shared.jsx'];
    expect(file).toBeDefined();
    expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(file.mtime).toBeGreaterThan(0);
    expect(file.size).toBeGreaterThan(0);
  });

  it('produces stable hashes', async () => {
    const r1 = await scan({ root: DESIGN_FIXTURES, include: ['**/*.jsx'], exclude: [] });
    const r2 = await scan({ root: DESIGN_FIXTURES, include: ['**/*.jsx'], exclude: [] });

    expect(r1.files['components/shared.jsx'].hash).toBe(r2.files['components/shared.jsx'].hash);
  });

  it('respects exclude patterns', async () => {
    const result = await scan({
      root: DESIGN_FIXTURES,
      include: ['**/*.jsx'],
      exclude: ['**/shared.jsx'],
    });

    const files = Object.keys(result.files);
    expect(files.length).toBe(1);
    expect(files[0]).toBe('components/pages.jsx');
  });
});
