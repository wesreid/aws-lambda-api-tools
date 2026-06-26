/**
 * Route-modules generator.
 *
 * The Lambda proxy entry handler resolves each request to a handler by looking
 * its `handlerPath` up in a static `routeModules` map. Because the function is
 * esbuild-bundled, that map MUST use static `import`s — a dynamic
 * `require(handlerPath)` can't be bundled. Hand-maintaining the map is a
 * reliable source of production 404s: add a route to the config, forget the
 * map entry, and the route silently doesn't exist.
 *
 * This module generates that map from the route config files (the single
 * source of truth), and verifies it in CI. It scans `*_routes-config*` files
 * for `handlerPath` declarations — no TypeScript execution required, so it runs
 * as a pre-build / pre-commit step with zero setup.
 */

import { promises as fsp } from 'fs';
import type { Dirent } from 'fs';
import * as path from 'path';

export interface RouteModulesGeneratorOptions {
  /** Project root. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Directory scanned recursively for route-config files. Default `src/routes`. */
  routesDir?: string;
  /**
   * Filename pattern identifying the config files that declare `handlerPath`
   * entries. Default `/^_routes-config.*\.(ts|js)$/`.
   */
  configFilePattern?: RegExp;
  /** Output file for the generated map. Default `src/route-modules.ts`. */
  outFile?: string;
  /** Module the `RouteModule` type is imported from. Default `aws-lambda-api-tools`. */
  typeImportFrom?: string;
  /**
   * Explicit handlerPaths to use instead of scanning the filesystem. When set,
   * `routesDir` / `configFilePattern` are ignored.
   */
  handlerPaths?: string[];
}

const DEFAULT_CONFIG_PATTERN = /^_routes-config.*\.(ts|js)$/;
const DEFAULT_ROUTES_DIR = 'src/routes';
const DEFAULT_OUT_FILE = 'src/route-modules.ts';
const DEFAULT_TYPE_IMPORT = 'aws-lambda-api-tools';

const GENERATED_HEADER = `// AUTO-GENERATED FILE — DO NOT EDIT.
// Regenerate with: npx aws-lambda-api-tools generate-route-modules
//
// Maps every route's handlerPath (declared in *_routes-config files) to its
// statically-imported RouteModule, so the esbuild-bundled Lambda includes and
// can resolve every handler. Keeping this generated guarantees it never drifts
// from the route config — a missing entry is a 404 at runtime.`;

/** Recursively list all files under a directory (missing dir → []). */
async function walk(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan route-config files for every declared `handlerPath` (sorted, de-duped).
 */
export async function collectHandlerPaths(
  options: RouteModulesGeneratorOptions = {},
): Promise<string[]> {
  if (options.handlerPaths) {
    return Array.from(new Set(options.handlerPaths)).sort();
  }
  const cwd = options.cwd ?? process.cwd();
  const routesDir = path.resolve(cwd, options.routesDir ?? DEFAULT_ROUTES_DIR);
  const pattern = options.configFilePattern ?? DEFAULT_CONFIG_PATTERN;
  const files = (await walk(routesDir)).filter((file) => pattern.test(path.basename(file)));

  const found = new Set<string>();
  const handlerPathRe = /handlerPath\s*:\s*['"`]([^'"`]+)['"`]/g;
  for (const file of files) {
    const content = await fsp.readFile(file, 'utf8');
    let match: RegExpExecArray | null;
    handlerPathRe.lastIndex = 0;
    while ((match = handlerPathRe.exec(content)) !== null) {
      const hp = match[1];
      if (hp) found.add(hp);
    }
  }
  return Array.from(found).sort();
}

/** Convert a handlerPath into a unique, deterministic JS identifier. */
export function handlerPathToIdentifier(handlerPath: string): string {
  const cleaned = handlerPath
    .replace(/\.(ts|js)$/, '')
    .replace(/^\.?\//, '')
    .replace(/^src\//, '')
    .replace(/^routes\//, '');
  const camel = cleaned
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((seg, i) => (i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
    .join('');
  return /^[a-zA-Z_$]/.test(camel) ? camel : `route_${camel}`;
}

/** Import specifier (POSIX, leading `./`) from the out file to a handlerPath. */
function importSpecifier(outFileAbs: string, handlerPath: string, cwd: string): string {
  const handlerAbs = path.resolve(cwd, handlerPath.replace(/\.(ts|js)$/, ''));
  let rel = path.relative(path.dirname(outFileAbs), handlerAbs).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** Render the route-modules file content for a set of handlerPaths. */
export function renderRouteModules(
  handlerPaths: string[],
  options: RouteModulesGeneratorOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const outFileAbs = path.resolve(cwd, options.outFile ?? DEFAULT_OUT_FILE);
  const typeImportFrom = options.typeImportFrom ?? DEFAULT_TYPE_IMPORT;

  const sorted = Array.from(new Set(handlerPaths)).sort();
  const usedIdents = new Map<string, number>();
  const rows = sorted.map((handlerPath) => {
    const base = handlerPathToIdentifier(handlerPath);
    const seen = usedIdents.get(base) ?? 0;
    usedIdents.set(base, seen + 1);
    const ident = seen === 0 ? base : `${base}${seen + 1}`;
    return { handlerPath, ident, specifier: importSpecifier(outFileAbs, handlerPath, cwd) };
  });

  const imports = rows.map((r) => `import ${r.ident} from '${r.specifier}';`).join('\n');
  const entries = rows.map((r) => `  '${r.handlerPath}': ${r.ident},`).join('\n');

  return `${GENERATED_HEADER}

import { RouteModule } from '${typeImportFrom}';

${imports}

export const routeModules: Record<string, RouteModule> = {
${entries}
};

export default routeModules;
`;
}

export interface GenerateRouteModulesResult {
  outFile: string;
  handlerPaths: string[];
  /** Whether the file content changed (and was rewritten). */
  changed: boolean;
  content: string;
}

/** Generate and write the route-modules file. */
export async function generateRouteModules(
  options: RouteModulesGeneratorOptions = {},
): Promise<GenerateRouteModulesResult> {
  const cwd = options.cwd ?? process.cwd();
  const outFileAbs = path.resolve(cwd, options.outFile ?? DEFAULT_OUT_FILE);
  const handlerPaths = await collectHandlerPaths(options);
  const content = renderRouteModules(handlerPaths, options);

  let existing: string | null = null;
  try {
    existing = await fsp.readFile(outFileAbs, 'utf8');
  } catch {
    existing = null;
  }
  const changed = existing !== content;
  if (changed) {
    await fsp.mkdir(path.dirname(outFileAbs), { recursive: true });
    await fsp.writeFile(outFileAbs, content, 'utf8');
  }
  return { outFile: outFileAbs, handlerPaths, changed, content };
}

export interface CheckRouteModulesResult {
  inSync: boolean;
  outFile: string;
  /** handlerPaths declared in config but absent from the current file. */
  missing: string[];
  /** map keys present in the file but not declared in config (dead entries). */
  extra: string[];
}

/** Verify the route-modules file is in sync with the route config. */
export async function checkRouteModules(
  options: RouteModulesGeneratorOptions = {},
): Promise<CheckRouteModulesResult> {
  const cwd = options.cwd ?? process.cwd();
  const outFileAbs = path.resolve(cwd, options.outFile ?? DEFAULT_OUT_FILE);
  const handlerPaths = await collectHandlerPaths(options);
  const expected = renderRouteModules(handlerPaths, options);

  let existing = '';
  try {
    existing = await fsp.readFile(outFileAbs, 'utf8');
  } catch {
    existing = '';
  }

  // Diagnostic diff: map keys currently in the file vs declared handlerPaths.
  const existingKeys = new Set<string>();
  const keyRe = /^\s*['"`]([^'"`]+)['"`]\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(existing)) !== null) {
    const key = match[1];
    if (key) existingKeys.add(key);
  }
  const declared = new Set(handlerPaths);
  const missing = handlerPaths.filter((hp) => !existingKeys.has(hp));
  const extra = Array.from(existingKeys).filter((key) => !declared.has(key));

  return { inSync: existing === expected, outFile: outFileAbs, missing, extra };
}
