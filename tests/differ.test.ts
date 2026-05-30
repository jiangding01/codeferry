import { describe, it, expect } from 'vitest';
import { computeStatus, computeAllStatuses } from '../src/core/differ.js';
import type { ComponentEntry, ComponentRegistry } from '../src/types/index.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_HASH = 'aaa000';
const DESIGN_HASH_NEW = 'bbb111';
const CODE_HASH_NEW = 'ccc222';

function makeEntry(overrides: Partial<ComponentEntry> = {}): ComponentEntry {
  return {
    id: 'file.jsx::TestComp',
    name: 'TestComp',
    designFile: 'file.jsx',
    designStartLine: 1,
    designEndLine: 20,
    designHash: BASE_HASH,
    codeFiles: ['src/test.tsx'],
    codeHash: BASE_HASH,
    mappingType: 'auto',
    mappingConfidence: 0.9,
    lastSyncedAt: null,
    designHashAtSync: BASE_HASH,
    codeHashAtSync: BASE_HASH,
    kind: 'page',
    ...overrides,
  };
}

function makeRegistry(
  components: Record<string, ComponentEntry>,
  unmappedCode: string[] = [],
): ComponentRegistry {
  return {
    version: '2.0',
    updatedAt: Date.now(),
    components,
    unmappedDesign: [],
    unmappedCode,
  };
}

// ── computeStatus ─────────────────────────────────────────────────────────────

describe('computeStatus', () => {
  it('returns new-design when codeFiles is empty', () => {
    const entry = makeEntry({ codeFiles: [], codeHash: '' });
    expect(computeStatus(entry)).toBe('new-design');
  });

  it('returns never-synced when baseline hashes are null', () => {
    const entry = makeEntry({ designHashAtSync: null, codeHashAtSync: null });
    expect(computeStatus(entry)).toBe('never-synced');
  });

  it('returns never-synced when only designHashAtSync is null', () => {
    const entry = makeEntry({ designHashAtSync: null, codeHashAtSync: BASE_HASH });
    expect(computeStatus(entry)).toBe('never-synced');
  });

  it('returns never-synced when only codeHashAtSync is null', () => {
    const entry = makeEntry({ designHashAtSync: BASE_HASH, codeHashAtSync: null });
    expect(computeStatus(entry)).toBe('never-synced');
  });

  it('returns synced when both hashes equal baseline', () => {
    const entry = makeEntry(); // all hashes are BASE_HASH
    expect(computeStatus(entry)).toBe('synced');
  });

  it('returns design-ahead when design changed but code did not', () => {
    const entry = makeEntry({ designHash: DESIGN_HASH_NEW });
    expect(computeStatus(entry)).toBe('design-ahead');
  });

  it('returns code-ahead when code changed but design did not', () => {
    const entry = makeEntry({ codeHash: CODE_HASH_NEW });
    expect(computeStatus(entry)).toBe('code-ahead');
  });

  it('returns both-changed when both sides changed', () => {
    const entry = makeEntry({ designHash: DESIGN_HASH_NEW, codeHash: CODE_HASH_NEW });
    expect(computeStatus(entry)).toBe('both-changed');
  });

  it('treats empty string codeHash as unchanged', () => {
    // Right after init, codeHash is '' — should not count as a change
    const entry = makeEntry({ codeHash: '', codeHashAtSync: BASE_HASH });
    expect(computeStatus(entry)).toBe('synced');
  });
});

// ── computeAllStatuses ────────────────────────────────────────────────────────

describe('computeAllStatuses', () => {
  it('computes correct summary counts', () => {
    const registry = makeRegistry(
      {
        'a.jsx::SyncedComp': makeEntry({ id: 'a.jsx::SyncedComp', name: 'SyncedComp' }),
        'b.jsx::DesignAheadComp': makeEntry({
          id: 'b.jsx::DesignAheadComp',
          name: 'DesignAheadComp',
          designHash: DESIGN_HASH_NEW,
        }),
        'c.jsx::CodeAheadComp': makeEntry({
          id: 'c.jsx::CodeAheadComp',
          name: 'CodeAheadComp',
          codeHash: CODE_HASH_NEW,
        }),
        'd.jsx::ConflictComp': makeEntry({
          id: 'd.jsx::ConflictComp',
          name: 'ConflictComp',
          designHash: DESIGN_HASH_NEW,
          codeHash: CODE_HASH_NEW,
        }),
        'e.jsx::UnmappedComp': makeEntry({
          id: 'e.jsx::UnmappedComp',
          name: 'UnmappedComp',
          codeFiles: [],
          codeHash: '',
        }),
        'f.jsx::NeverSyncedComp': makeEntry({
          id: 'f.jsx::NeverSyncedComp',
          name: 'NeverSyncedComp',
          designHashAtSync: null,
          codeHashAtSync: null,
        }),
      },
      ['orphan.tsx', 'another-orphan.tsx'],
    );

    const result = computeAllStatuses(registry);

    expect(result.summary.synced).toBe(1);
    expect(result.summary.designAhead).toBe(1);
    expect(result.summary.codeAhead).toBe(1);
    expect(result.summary.conflicts).toBe(1);
    expect(result.summary.newDesign).toBe(1);
    expect(result.summary.neverSynced).toBe(1);
    expect(result.summary.newCode).toBe(2); // from unmappedCode
  });

  it('includes changed components in changedComponents list', () => {
    const registry = makeRegistry({
      'x.jsx::AheadComp': makeEntry({
        id: 'x.jsx::AheadComp',
        name: 'AheadComp',
        designHash: DESIGN_HASH_NEW,
      }),
      'y.jsx::SyncedComp': makeEntry({ id: 'y.jsx::SyncedComp', name: 'SyncedComp' }),
    });

    const result = computeAllStatuses(registry);
    expect(result.changedComponents).toHaveLength(1);
    expect(result.changedComponents[0].id).toBe('x.jsx::AheadComp');
    expect(result.changedComponents[0].status).toBe('design-ahead');
  });

  it('stores individual component statuses in componentStatuses map', () => {
    const registry = makeRegistry({
      'z.jsx::Comp': makeEntry({
        id: 'z.jsx::Comp',
        name: 'Comp',
        codeHash: CODE_HASH_NEW,
      }),
    });

    const result = computeAllStatuses(registry);
    expect(result.componentStatuses['z.jsx::Comp']).toBe('code-ahead');
  });

  it('handles empty registry', () => {
    const registry = makeRegistry({});
    const result = computeAllStatuses(registry);
    expect(result.summary.synced).toBe(0);
    expect(result.changedComponents).toHaveLength(0);
  });
});
