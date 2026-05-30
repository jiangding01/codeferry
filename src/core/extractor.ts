import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import { hashContent } from '../utils/hash.js';
import { resolvePath } from '../utils/path.js';
import type { ExtractedComponent, ExtractionResult, ComponentKind } from '../types/index.js';

const FUNCTION_PATTERN = /^function\s+([A-Z][A-Za-z0-9_]*)\s*\(/;

const PAGE_SUFFIXES = ['Page', 'View', 'Screen', 'Layout'];
const HELPER_SUFFIXES = [
  'Modal', 'Dialog', 'Tab', 'Row', 'Card', 'Strip', 'Icon',
  'Button', 'Badge', 'Chip', 'Block', 'Item', 'Cell', 'Tooltip',
  'Dropdown', 'Menu', 'Popover', 'Drawer',
];

function classifyKind(name: string, filePath: string): ComponentKind {
  if (PAGE_SUFFIXES.some((s) => name.endsWith(s))) return 'page';
  if (HELPER_SUFFIXES.some((s) => name.endsWith(s))) return 'helper';

  const lowerFile = filePath.toLowerCase();
  if (lowerFile.includes('shared') || lowerFile.includes('global') || lowerFile.includes('common')) {
    return 'shared';
  }

  return 'shared';
}

function detectDependencies(content: string, allComponentNames: string[]): string[] {
  const deps = new Set<string>();

  for (const name of allComponentNames) {
    const jsxPattern = new RegExp(`<${name}[\\s/>]`);
    const callPattern = new RegExp(`${name}\\s*\\(`);
    if (jsxPattern.test(content) || callPattern.test(content)) {
      deps.add(name);
    }
  }

  return [...deps];
}

export async function extractComponents(filePath: string): Promise<ExtractionResult> {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const fileHash = hashContent(content);
  const components: ExtractedComponent[] = [];

  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(FUNCTION_PATTERN);
    if (!match) {
      i++;
      continue;
    }

    const name = match[1];
    const startLine = i + 1;

    // count braces to find the end of the function
    let braceDepth = 0;
    let foundOpen = false;
    let j = i;

    while (j < lines.length) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === '{') {
          braceDepth++;
          foundOpen = true;
        } else if (ch === '}') {
          braceDepth--;
        }
      }
      if (foundOpen && braceDepth === 0) {
        break;
      }
      j++;
    }

    const endLine = j + 1;
    const componentContent = lines.slice(i, j + 1).join('\n');

    components.push({
      name,
      startLine,
      endLine,
      content: componentContent,
      hash: hashContent(componentContent),
      kind: classifyKind(name, filePath),
      dependencies: [],
    });

    i = j + 1;
  }

  // second pass: detect dependencies between extracted components
  const allNames = components.map((c) => c.name);
  for (const comp of components) {
    comp.dependencies = detectDependencies(comp.content, allNames.filter((n) => n !== comp.name));
  }

  return { file: filePath, components, fileHash };
}

export async function extractAll(
  root: string,
  include: string[],
  exclude: string[],
): Promise<ExtractionResult[]> {
  const resolvedRoot = resolvePath(root);

  const jsxFiles = await fg(
    include.length > 0 ? include : ['**/*.jsx', '**/*.tsx'],
    {
      cwd: resolvedRoot,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        ...exclude,
      ],
      absolute: false,
      onlyFiles: true,
    },
  );

  const results: ExtractionResult[] = [];

  for (const file of jsxFiles) {
    const fullPath = join(resolvedRoot, file);
    try {
      const result = await extractComponents(fullPath);
      // store relative path instead of absolute
      result.file = file;
      if (result.components.length > 0) {
        results.push(result);
      }
    } catch {
      // skip files that can't be parsed
    }
  }

  // cross-file dependency detection
  const allNames = results.flatMap((r) => r.components.map((c) => c.name));
  for (const result of results) {
    for (const comp of result.components) {
      const crossFileDeps = detectDependencies(
        comp.content,
        allNames.filter((n) => n !== comp.name && !comp.dependencies.includes(n)),
      );
      comp.dependencies.push(...crossFileDeps);
    }
  }

  return results;
}
