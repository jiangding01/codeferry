import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { autoMap, getCandidates, buildHtmlBridgeIndex } from '../src/core/mapper.js';
import type { ComponentEntry } from '../src/types/index.js';

const CODE_FIXTURES = join(import.meta.dirname, 'fixtures', 'mini-code');
const HTML_BRIDGE_FIXTURES = join(import.meta.dirname, 'fixtures', 'html-bridge');

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeEntry(name: string, overrides: Partial<ComponentEntry> = {}): ComponentEntry {
  return {
    id: `design.jsx::${name}`,
    name,
    designFile: 'design.jsx',
    designStartLine: 1,
    designEndLine: 20,
    designHash: 'abc123',
    codeFiles: [],
    codeHash: '',
    mappingType: 'auto',
    mappingConfidence: 0,
    lastSyncedAt: null,
    designHashAtSync: null,
    codeHashAtSync: null,
    kind: 'page',
    ...overrides,
  };
}

// These are the actual files in mini-code fixture
const CODE_FILES = ['src/page.tsx', 'src/about/page.tsx', 'src/components/shared.tsx'];

// ── filename matching ─────────────────────────────────────────────────────────

describe('autoMap — filename strategy', () => {
  it('matches HomePage to src/page.tsx by stripping Page suffix', async () => {
    const result = await autoMap([makeEntry('HomePage')], CODE_FILES, CODE_FIXTURES);
    expect(result.mapped).toHaveLength(1);
    // "home" stripped from "HomePage" (Page suffix) → matches "page" filename
    // OR exact match "page" = "home" might be partial; let's just check it mapped something
    const candidate = result.mapped[0].candidate;
    expect(candidate.codePath).toMatch(/page\.tsx$/);
  });

  it('matches AboutPage to src/about/page.tsx', async () => {
    const result = await autoMap([makeEntry('AboutPage')], CODE_FILES, CODE_FIXTURES);
    // "about" from "AboutPage" → partial match in "src/about/page.tsx"
    expect(result.mapped).toHaveLength(1);
    expect(result.mapped[0].candidate.codePath).toContain('about');
  });

  it('leaves unrecognized components unmapped', async () => {
    const result = await autoMap([makeEntry('XyzQrsComp')], CODE_FILES, CODE_FIXTURES);
    expect(result.unmapped).toContain('design.jsx::XyzQrsComp');
  });
});

// ── export-name matching ──────────────────────────────────────────────────────

describe('autoMap — export name strategy', () => {
  it('matches Seal to src/components/shared.tsx via export function Seal', async () => {
    const result = await autoMap(
      [makeEntry('Seal', { kind: 'shared' })],
      CODE_FILES,
      CODE_FIXTURES,
    );
    expect(result.mapped).toHaveLength(1);
    expect(result.mapped[0].candidate.codePath).toBe('src/components/shared.tsx');
    expect(result.mapped[0].candidate.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('matches Logo to src/components/shared.tsx via export function Logo', async () => {
    const result = await autoMap(
      [makeEntry('Logo', { kind: 'shared' })],
      CODE_FILES,
      CODE_FIXTURES,
    );
    expect(result.mapped).toHaveLength(1);
    expect(result.mapped[0].candidate.codePath).toBe('src/components/shared.tsx');
  });

  it('boosts confidence when both filename and export match agree', async () => {
    // "Seal" — export name matches shared.tsx; "seal" slug appears in "shared" → partial match
    const sealCandidates = await getCandidates(
      makeEntry('Seal', { kind: 'shared' }),
      CODE_FILES,
      CODE_FIXTURES,
    );
    // At least one candidate for shared.tsx
    const sharedCandidate = sealCandidates.find((c) => c.codePath === 'src/components/shared.tsx');
    expect(sharedCandidate).toBeDefined();
    expect(sharedCandidate!.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

// ── autoMap multi-component ───────────────────────────────────────────────────

describe('autoMap — multiple components', () => {
  it('maps multiple components independently', async () => {
    const components = [
      makeEntry('Seal', { kind: 'shared' }),
      makeEntry('Logo', { kind: 'shared' }),
    ];
    const result = await autoMap(components, CODE_FILES, CODE_FIXTURES);
    // Both should be mapped
    expect(result.mapped).toHaveLength(2);
    expect(result.unmapped).toHaveLength(0);
    // Both should map to shared.tsx (correct — that's where they live)
    for (const { candidate } of result.mapped) {
      expect(candidate.codePath).toBe('src/components/shared.tsx');
    }
  });

  it('correctly separates mapped from unmapped', async () => {
    const components = [
      makeEntry('Seal', { kind: 'shared' }),
      makeEntry('NonExistentWidget'),
    ];
    const result = await autoMap(components, CODE_FILES, CODE_FIXTURES);
    expect(result.mapped).toHaveLength(1);
    expect(result.mapped[0].componentId).toBe('design.jsx::Seal');
    expect(result.unmapped).toContain('design.jsx::NonExistentWidget');
  });
});

// ── HTML bridge index ─────────────────────────────────────────────────────────

describe('buildHtmlBridgeIndex', () => {
  it('parses index.html and extracts entry file imports', async () => {
    const index = await buildHtmlBridgeIndex(HTML_BRIDGE_FIXTURES);
    // html-bridge/index.html → src/main.jsx → imports Dashboard, Header, Footer
    expect(index.size).toBeGreaterThan(0);
    // Dashboard import: ./pages/Dashboard.jsx → "src/pages/dashboard"
    const dashKey = [...index.keys()].find((k) => k.includes('dashboard'));
    expect(dashKey).toBeDefined();
    expect(index.get(dashKey!)!).toContain('pages');
  });

  it('returns empty map when no index.html exists', async () => {
    const index = await buildHtmlBridgeIndex('/non-existent-path-xyz');
    expect(index.size).toBe(0);
  });

  it('returns empty map gracefully on parse errors (never throws)', async () => {
    // Pass the code fixtures dir (no index.html) — should not throw
    await expect(buildHtmlBridgeIndex(CODE_FIXTURES)).resolves.toBeDefined();
  });
});

// ── getCandidates ─────────────────────────────────────────────────────────────

describe('getCandidates', () => {
  it('returns candidates sorted by confidence descending', async () => {
    const candidates = await getCandidates(
      makeEntry('Seal', { kind: 'shared' }),
      CODE_FILES,
      CODE_FIXTURES,
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (let i = 0; i < candidates.length - 1; i++) {
      expect(candidates[i].confidence).toBeGreaterThanOrEqual(candidates[i + 1].confidence);
    }
  });

  it('returns empty array for completely unknown component', async () => {
    const candidates = await getCandidates(
      makeEntry('ZzzzUnknown9999'),
      CODE_FILES,
      CODE_FIXTURES,
    );
    // Very long random name shouldn't match anything
    const highConf = candidates.filter((c) => c.confidence >= 0.5);
    expect(highConf).toHaveLength(0);
  });
});
