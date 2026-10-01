import type { MiddlewareChain } from './types-and-interfaces';

/**
 * Standard OpenAPI `security` for a route, derived from what its middleware declares.
 *
 * The library knows no product's schemes or permissions. A product marks its own
 * middleware with `declareSecurity`:
 * - an authentication step names the security schemes any one of which authenticates
 *   the request (`authenticates`);
 * - a permission step names what the authenticated caller must hold (`requires`).
 *
 * The route's requirement is then the standard OpenAPI security requirement: one entry
 * per way of authenticating, each listing the required permissions as the scheme's
 * scopes (OpenAPI 3.1: "role names which are required for the execution").
 */

/** A security requirement object: scheme name → the scopes or roles it must carry. */
export type SecurityRequirementObject = Record<string, string[]>;

export type SecurityDeclaration =
  /** Any one of these schemes authenticates the request. Steps in series must all pass. */
  | { authenticates: string[] }
  /** The authenticated caller must hold every one of these. */
  | { requires: string[] };

const SECURITY_DECLARATION = Symbol.for('aws-lambda-api-tools.security-declaration');

type Declared = { [SECURITY_DECLARATION]?: SecurityDeclaration };

function assertNames(names: unknown, key: string): asserts names is string[] {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`declareSecurity: \`${key}\` names at least one scheme or permission`);
  }
  for (const name of names) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`declareSecurity: every name in \`${key}\` is a non-empty string`);
    }
  }
}

/**
 * Mark a middleware with the security it enforces, and return the same middleware.
 * Its behaviour is unchanged; the declaration is read only when the OpenAPI document
 * is generated.
 */
export function declareSecurity<T extends (...args: never[]) => unknown>(middleware: T, declaration: SecurityDeclaration): T {
  const hasAuth = 'authenticates' in declaration;
  const hasRequires = 'requires' in declaration;
  if (hasAuth === hasRequires) {
    throw new Error('declareSecurity: a declaration has either `authenticates` or `requires`, not both');
  }
  if (hasAuth) assertNames((declaration as { authenticates: unknown }).authenticates, 'authenticates');
  else assertNames((declaration as { requires: unknown }).requires, 'requires');

  Object.defineProperty(middleware, SECURITY_DECLARATION, {
    value: Object.freeze({ ...declaration }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return middleware;
}

/** The declaration on a middleware, if it has one. */
export function securityDeclarationOf(middleware: unknown): SecurityDeclaration | undefined {
  if (typeof middleware !== 'function') return undefined;
  return (middleware as Declared)[SECURITY_DECLARATION];
}

/**
 * The security requirement of a route's middleware chain, or undefined when nothing in
 * it declares authentication. `route` names the route in errors ("GET /api/v1/orders").
 */
export function securityOfChain(chain: MiddlewareChain | undefined, route: string): SecurityRequirementObject[] | undefined {
  const authSteps: string[][] = [];
  const required: string[] = [];
  for (const step of chain ?? []) {
    const declaration = securityDeclarationOf(step);
    if (!declaration) continue;
    if ('authenticates' in declaration) authSteps.push([...new Set(declaration.authenticates)]);
    else for (const name of declaration.requires) if (!required.includes(name)) required.push(name);
  }

  if (authSteps.length === 0) {
    if (required.length > 0) {
      throw new Error(
        `${route} requires ${required.join(', ')} but no middleware in its chain declares how it authenticates (declareSecurity({ authenticates }))`,
      );
    }
    return undefined;
  }

  // Steps in series must all pass, so each alternative takes one scheme from each step.
  let alternatives: string[][] = [[]];
  for (const schemes of authSteps) {
    alternatives = alternatives.flatMap((picked) => schemes.map((scheme) => [...picked, scheme]));
  }
  return alternatives.map((schemes) => Object.fromEntries(schemes.map((scheme) => [scheme, [...required]])));
}

/**
 * Check that every scheme a requirement names is one the product declared. Throws
 * naming the route and the scheme.
 */
export function assertSchemesDeclared(
  requirements: SecurityRequirementObject[],
  declared: Record<string, unknown> | undefined,
  route: string,
): void {
  for (const requirement of requirements) {
    for (const scheme of Object.keys(requirement)) {
      if (!declared || !Object.prototype.hasOwnProperty.call(declared, scheme)) {
        throw new Error(
          `${route} authenticates with "${scheme}", which is not in the route config's openApi.securitySchemes`,
        );
      }
    }
  }
}
