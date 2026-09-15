/**
 * Greedy-proxy route registration.
 *
 * With `RouteConfig.useRawPath`, the entry handler resolves every request from
 * `event.rawPath`, so API Gateway does not need one route per endpoint. It needs
 * only enough routes to deliver every declared path to the Lambda. One route per
 * endpoint does not scale: an HTTP API allows 300 routes by default, and each
 * route is a CloudFormation resource against a stack's 500-resource limit.
 *
 * A "URL group" is the first path segment after the base path. Each group
 * registers two keys, because `{proxy+}` matches one or more further segments
 * and so does not match the group's own path:
 *
 *   ANY /api/v1/voices            ← the collection endpoint itself
 *   ANY /api/v1/voices/{proxy+}   ← everything beneath it
 *
 * Groups are per segment, never one catch-all: a catch-all would also answer
 * every unrelated path on the API, and would swallow any other integration.
 *
 * Every consumer that registers routes (CDK code) and every consumer that
 * partitions routes (between stacks or functions) must derive groups with the
 * same function. Two derivations that differ by one character make two stacks
 * race to create the same route key, and CloudFormation fails the deploy with a
 * 409 ConflictException.
 *
 * `ANY` includes `OPTIONS`, so CORS preflights now reach the Lambda instead of
 * being answered by API Gateway. The entry handler answers them in rawPath mode;
 * see `lambdaRouteProxyEntryHandler`.
 */
import { getRouteConfigByPath } from "./lambda-route-proxy-entry-handler";
import { ConfigRouteEntry } from "./types-and-interfaces";

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath) return "";
  const trimmed = basePath.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * The URL group a route path belongs to.
 *
 *   urlGroupOf('/api/v1/voices/{voiceId}', '/api/v1')  → '/api/v1/voices'
 *   urlGroupOf('/api/v1/users/me', '/api/v1')          → '/api/v1/users'
 *   urlGroupOf('/internal/users/lookup', '/api/v1')    → '/internal'
 *
 * Returns `null` when no safe group exists, which callers must treat as a
 * configuration error:
 *   - no segment after the base path (`/`, or the base path itself);
 *   - a path parameter as the group segment (`/api/v1/{id}`), whose greedy
 *     route would answer every path in the base namespace;
 *   - a path outside the base path whose first segment is the base path's
 *     first segment (`/api/v2/...` under `/api/v1`), whose group would be
 *     `/api` and swallow every group on the API.
 */
export function urlGroupOf(routePath: string, basePath?: string): string | null {
  const base = normalizeBasePath(basePath);
  const path = `/${routePath.replace(/\?.*$/, "").replace(/^\/+/, "")}`;
  const underBase = base !== "" && path.startsWith(`${base}/`);
  const suffix = underBase ? path.slice(base.length + 1) : path.slice(1);
  const segment = suffix.split("/")[0] ?? "";

  if (!segment || segment.startsWith("{")) return null;
  if (!underBase && base !== "" && `/${segment}` === `/${base.split("/")[1]}`) {
    return null;
  }
  return underBase ? `${base}/${segment}` : `/${segment}`;
}

/** The two route paths a group registers, both with method `ANY`. */
export function greedyPathsFor(group: string): [string, string] {
  return [group, `${group}/{proxy+}`];
}

/**
 * Distinct URL groups covering a route list, in first-seen order.
 *
 * Throws on a route with no safe group. Skipping it would leave that route
 * unreachable: a 404 in production for a route that exists.
 */
export function deriveUrlGroups(
  routes: ReadonlyArray<Pick<ConfigRouteEntry, "path" | "method">>,
  basePath?: string
): string[] {
  const groups: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const route of routes) {
    const group = urlGroupOf(route.path, basePath);
    if (group === null) {
      invalid.push(`${route.method} ${route.path}`);
      continue;
    }
    if (!seen.has(group)) {
      seen.add(group);
      groups.push(group);
    }
  }
  if (invalid.length > 0) {
    throw new Error(
      `No safe greedy URL group for ${invalid.length} route(s): ${invalid.join(", ")}. ` +
        "Every route needs a static segment after the base path."
    );
  }
  return groups;
}

/** A concrete request path for a route, with every `{param}` filled in. */
function samplePath(routePath: string): string {
  return routePath.replace(/\{[^}]+\}/g, "sample-value");
}

/**
 * Routes that in-Lambda resolution would not deliver to their own handler.
 *
 * Under per-route registration API Gateway resolved every request. Under greedy
 * registration `getRouteConfigByPath` does, so the whole table is resolved by
 * different code. For each route this resolves a sample request and reports it
 * when resolution throws, or lands on a different route with a different
 * handler: the request would 404, or worse, run the wrong handler.
 *
 * Also reports paths declared with Express-style `:param`, which the matcher
 * does not understand and which therefore never resolve.
 *
 * Returns an empty array when every route resolves to itself. Call it from a
 * test over the real route table.
 */
export function findMisroutedRoutes(routes: ReadonlyArray<ConfigRouteEntry>): string[] {
  const problems: string[] = [];
  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    if (/\/:[A-Za-z0-9_]+/.test(route.path)) {
      problems.push(`${label}: declares an Express-style :param; use {param}`);
      continue;
    }
    const method = route.method === "ANY" ? "GET" : route.method;
    let resolved: ConfigRouteEntry;
    try {
      resolved = getRouteConfigByPath(samplePath(route.path), method, [...routes]);
    } catch (err) {
      problems.push(`${label}: does not resolve (${(err as Error).message})`);
      continue;
    }
    if (resolved.path !== route.path && resolved.handlerPath !== route.handlerPath) {
      problems.push(
        `${label}: resolves to ${resolved.method} ${resolved.path} (${resolved.handlerPath}), ` +
          `not its own handler ${route.handlerPath}`
      );
    }
  }
  return problems;
}
