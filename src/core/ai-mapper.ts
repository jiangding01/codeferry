/**
 * AI-assisted mapping fallback.
 *
 * When filename-match + export-name-match + HTML-bridge strategies all fail to
 * produce a confident candidate, this module asks the Claude API to suggest the
 * best code file for each unmapped component given the full list of available
 * code files.
 *
 * Pattern mirrors analyzer.ts: Anthropic SDK, pLimit concurrency, exponential
 * backoff on transient errors, graceful degradation when ANTHROPIC_API_KEY is
 * absent.
 */

import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import type { ComponentEntry, AIMappingResult, DriftConfig } from '../types/index.js';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum components per API request.
 * Larger batches reduce API calls but can exceed context limits and reduce
 * per-component accuracy. 8 is a practical sweet spot.
 */
const BATCH_SIZE = 8;

/**
 * Maximum code file candidates to include in the prompt per batch.
 * The AI is most useful when the candidate list is focused; very long lists
 * dilute the signal. Pre-filter by filename similarity before sending.
 */
const MAX_CODE_FILES_IN_PROMPT = 60;

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a code file matcher for codeferry, a design-to-code sync tool.

Given a list of unmapped design components and a list of available code files, suggest which code file most likely contains the production implementation of each component.

Rules:
- Consider filename similarity, directory structure, and common naming conventions
- A design component named "UserProfile" likely maps to a file like user-profile.tsx, UserProfile.tsx, or components/UserProfile/index.tsx
- Page components (Dashboard, Settings) often live under pages/, app/, or src/app/ in Next.js projects
- Shared components often live under components/, ui/, or shared/
- If no good match exists, omit the component from your response — do NOT force a poor match
- Confidence: 0.9+ = very confident, 0.7-0.9 = likely, 0.5-0.7 = possible, below 0.5 = skip

ALWAYS respond with a single valid JSON array. No markdown fences, no extra text. Schema:
[
  {
    "componentIndex": <number, 1-based index from the Components list>,
    "codePath": "<relative code file path exactly as provided in the list>",
    "confidence": <number between 0 and 1>,
    "reasoning": "<one concise sentence>"
  }
]

Omit entries where confidence is below 0.5. If nothing matches, return an empty array [].`;

// ── Prompt construction ──────────────────────────────────────────────────────

/**
 * Compact slug of a component name for filename similarity scoring.
 * "UserProfile" → "userprofile", "dashboard-view" → "dashboardview"
 */
function nameSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Sort code files so those whose path contains any component name slug appear
 * first. This ensures the most relevant files are included when the list is
 * truncated to MAX_CODE_FILES_IN_PROMPT.
 */
function rankFilesByRelevance(files: string[], components: ComponentEntry[]): string[] {
  const slugs = components.map((c) => nameSlug(c.name));
  return [...files].sort((a, b) => {
    const aLower = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    const bLower = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    const aMatch = slugs.some((s) => aLower.includes(s) || s.includes(aLower));
    const bMatch = slugs.some((s) => bLower.includes(s) || s.includes(bLower));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });
}

function buildMappingPrompt(
  components: ComponentEntry[],
  codeFiles: string[],
): string {
  const componentList = components
    .map((c, i) => `${i + 1}. ${c.name} (design file: ${c.designFile})`)
    .join('\n');

  // Rank files by relevance before truncating so the most likely matches stay visible
  const ranked = rankFilesByRelevance(codeFiles, components);
  const filesShown = ranked.slice(0, MAX_CODE_FILES_IN_PROMPT);
  const truncatedNote =
    codeFiles.length > MAX_CODE_FILES_IN_PROMPT
      ? `\n... and ${codeFiles.length - MAX_CODE_FILES_IN_PROMPT} more files not shown`
      : '';

  return [
    'Components to map:',
    componentList,
    '',
    'Available code files:',
    filesShown.join('\n') + truncatedNote,
  ].join('\n');
}

// ── Response parsing ─────────────────────────────────────────────────────────

/**
 * Parse the Claude API response for a batch mapping request.
 *
 * @param validPaths Set of all code file paths provided in the prompt.
 *   Any path returned by the AI that is NOT in this set is rejected —
 *   hallucinated paths must never be written to the registry.
 */
function parseMappingResponse(
  raw: string,
  components: ComponentEntry[],
  validPaths: Set<string>,
): AIMappingResult[] {
  // Strip markdown fences if model ignores the instruction
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const results: AIMappingResult[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;

    const obj = item as Record<string, unknown>;
    const idx = typeof obj['componentIndex'] === 'number' ? obj['componentIndex'] : null;
    const codePath = typeof obj['codePath'] === 'string' ? obj['codePath'].trim() : null;
    const confidence = typeof obj['confidence'] === 'number' ? obj['confidence'] : null;
    const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '(AI 推断)';

    // componentIndex is 1-based
    if (idx === null || codePath === null || confidence === null) continue;
    if (confidence < 0.5) continue;

    const component = components[idx - 1];
    if (!component) continue;

    // Guard: reject hallucinated paths not present in the provided file list.
    // An unknown path written to registry would cause differ.ts to permanently
    // ignore code-side changes (same failure mode as the P0-2 bug).
    if (!validPaths.has(codePath)) continue;

    results.push({
      componentId: component.id,
      codePath,
      confidence: Math.min(1, Math.max(0, confidence)),
      reasoning,
    });
  }

  return results;
}

// ── Retry with exponential backoff (mirrors analyzer.ts) ─────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status !== 429 && status !== 500 && status !== 529) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 8000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Single batch request ─────────────────────────────────────────────────────

async function mapBatch(
  client: Anthropic,
  model: string,
  components: ComponentEntry[],
  codeFiles: string[],
  validPaths: Set<string>,
): Promise<AIMappingResult[]> {
  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildMappingPrompt(components, codeFiles) }],
    }),
  );

  const block = response.content[0];
  if (!block || block.type !== 'text') return [];

  return parseMappingResponse(block.text, components, validPaths);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ask the Claude API to suggest code file mappings for unmapped components.
 *
 * - Returns a Map<componentId, AIMappingResult> for accepted suggestions.
 * - Silently skips components the AI cannot confidently map (confidence < 0.5).
 * - Gracefully returns an empty map when ANTHROPIC_API_KEY is not set.
 * - Individual batch failures are caught; other batches still complete.
 *
 * @param components   Unmapped design components to find matches for.
 * @param codeFiles    All available code files (relative paths from code root).
 * @param config       Project config (for model + concurrency settings).
 */
export async function suggestMappings(
  components: ComponentEntry[],
  codeFiles: string[],
  config: DriftConfig,
): Promise<Map<string, AIMappingResult>> {
  const results = new Map<string, AIMappingResult>();
  if (components.length === 0) return results;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return results;

  const client = new Anthropic({ apiKey });
  // Use the same model as semantic analysis by default (haiku = cost-effective)
  const model = config.ai?.model ?? 'claude-haiku-4-5';
  const maxConcurrency = config.ai?.maxConcurrency ?? 3;
  const limit = pLimit(maxConcurrency);

  // Build once — shared across all batches to validate AI-returned paths
  const validPaths = new Set(codeFiles);

  // Split components into batches
  const batches: ComponentEntry[][] = [];
  for (let i = 0; i < components.length; i += BATCH_SIZE) {
    batches.push(components.slice(i, i + BATCH_SIZE));
  }

  const tasks = batches.map((batch) =>
    limit(async () => {
      try {
        const batchResults = await mapBatch(client, model, batch, codeFiles, validPaths);
        for (const r of batchResults) {
          results.set(r.componentId, r);
        }
      } catch {
        // Swallow per-batch errors — other batches continue
      }
    }),
  );

  await Promise.all(tasks);
  return results;
}
