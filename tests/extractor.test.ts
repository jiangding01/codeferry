import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { extractComponents, extractAll } from '../src/core/extractor.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'mini-design');

describe('extractComponents', () => {
  it('extracts components from shared.jsx', async () => {
    const result = await extractComponents(join(FIXTURES, 'components', 'shared.jsx'));
    expect(result.components).toHaveLength(2);

    const [seal, logo] = result.components;
    expect(seal.name).toBe('Seal');
    expect(seal.kind).toBe('shared');
    expect(seal.startLine).toBe(3);

    expect(logo.name).toBe('Logo');
    expect(logo.kind).toBe('shared');
    expect(logo.dependencies).toContain('Seal');
  });

  it('extracts multiple page components from pages.jsx', async () => {
    const result = await extractComponents(join(FIXTURES, 'components', 'pages.jsx'));
    expect(result.components).toHaveLength(3);

    const names = result.components.map((c) => c.name);
    expect(names).toEqual(['HomePage', 'AboutPage', 'HelpModal']);

    expect(result.components[0].kind).toBe('page');
    expect(result.components[1].kind).toBe('page');
    expect(result.components[2].kind).toBe('helper');
  });

  it('detects cross-component dependencies within same file', async () => {
    const result = await extractComponents(join(FIXTURES, 'components', 'shared.jsx'));
    const logo = result.components.find((c) => c.name === 'Logo')!;
    expect(logo.dependencies).toContain('Seal');
  });

  it('produces stable hashes for unchanged content', async () => {
    const r1 = await extractComponents(join(FIXTURES, 'components', 'shared.jsx'));
    const r2 = await extractComponents(join(FIXTURES, 'components', 'shared.jsx'));
    expect(r1.components[0].hash).toBe(r2.components[0].hash);
    expect(r1.fileHash).toBe(r2.fileHash);
  });
});

describe('extractAll', () => {
  it('extracts from all JSX files in directory', async () => {
    const results = await extractAll(FIXTURES, ['**/*.jsx'], []);
    expect(results.length).toBe(2);

    const totalComponents = results.reduce((sum, r) => sum + r.components.length, 0);
    expect(totalComponents).toBe(5);
  });

  it('detects cross-file dependencies', async () => {
    const results = await extractAll(FIXTURES, ['**/*.jsx'], []);
    const pagesResult = results.find((r) => r.file.includes('pages.jsx'))!;
    const homePage = pagesResult.components.find((c) => c.name === 'HomePage')!;
    // Logo is in shared.jsx but referenced in pages.jsx via JSX tag
    expect(homePage.dependencies).toContain('Logo');
  });

  it('respects exclude patterns', async () => {
    const results = await extractAll(FIXTURES, ['**/*.jsx'], ['**/shared.jsx']);
    expect(results.length).toBe(1);
    expect(results[0].file).toContain('pages.jsx');
  });
});
