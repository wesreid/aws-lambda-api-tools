/**
 * Redaction helpers for request logging.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `lambdaRouteProxyEntryHandler` logged the entire API Gateway event on every
 * request to every route:
 *
 *     console.log(`Event Data: ${JSON.stringify(event)}`);
 *
 * `event.headers.authorization` is the caller's Bearer token, so every request
 * wrote a live credential to CloudWatch. Observed in practice with full
 * `eyJraWQ...` tokens and, because log groups had no retention policy, retained
 * indefinitely. The token claims (`email`, `given_name`, `custom:tenantId`) are
 * personal data that then outlives any deletion request made against the
 * application's own database.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN RULE THAT MATTERS
 * ---------------------------------------------------------------------------
 * Redaction is UNCONDITIONAL. It is not gated behind the debug flag.
 *
 * If it were, the first time somebody enabled debug logging in production to
 * chase a bug they would dump live credentials — which is precisely the moment
 * the protection is needed most. The debug flag therefore controls only *how
 * much* is logged, never *whether secrets are masked*.
 */

/** Replacement written in place of a sensitive value. */
export const REDACTED = "[REDACTED]";

/**
 * Headers always masked. Lowercase; matching is case-insensitive because API
 * Gateway v2 lowercases header names but v1 (and the local dev server) do not.
 */
export const DEFAULT_REDACTED_HEADERS: readonly string[] = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-amz-security-token",
  "x-amz-credential",
  "x-amzn-oidc-data",
  "x-amzn-oidc-accesstoken",
  "x-amzn-oidc-identity",
];

/**
 * Query parameters always masked.
 *
 * Query strings are as sensitive as headers and are easy to overlook — a signed
 * one-click unsubscribe link (`?token=<hmac>`), an OAuth `?code=`, or a presigned
 * URL signature all arrive here. Anything in this list would otherwise be logged
 * verbatim and remain replayable for as long as it stays valid.
 */
export const DEFAULT_REDACTED_QUERY_PARAMS: readonly string[] = [
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "api_key",
  "apikey",
  "key",
  "signature",
  "sig",
  "password",
  "secret",
];

/** Body fields always masked, even when debug logging is enabled. */
export const DEFAULT_REDACTED_BODY_FIELDS: readonly string[] = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "accessToken",
  "idToken",
  "refreshToken",
  "secret",
  "apiKey",
  "clientSecret",
  "authorization",
  "ssn",
  "creditCard",
  "cardNumber",
  "cvv",
];

function toLowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

/**
 * Mask sensitive entries in a header map without mutating the input.
 *
 * The handler passes the original event on to route handlers as `rawEvent`, so
 * mutating it here would corrupt the request the application actually sees —
 * authentication middleware reads `headers.authorization`.
 */
export function redactHeaders<T extends Record<string, unknown> | undefined | null>(
  headers: T,
  additional: readonly string[] = []
): T {
  if (!headers || typeof headers !== "object") return headers;

  const deny = toLowerSet([...DEFAULT_REDACTED_HEADERS, ...additional]);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    out[key] = deny.has(key.toLowerCase()) ? REDACTED : value;
  }

  return out as T;
}

/** Mask sensitive query parameters without mutating the input. */
export function redactQueryParams<T extends Record<string, unknown> | undefined | null>(
  params: T,
  additional: readonly string[] = []
): T {
  if (!params || typeof params !== "object") return params;

  const deny = toLowerSet([...DEFAULT_REDACTED_QUERY_PARAMS, ...additional]);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    out[key] = deny.has(key.toLowerCase()) ? REDACTED : value;
  }

  return out as T;
}

/**
 * Recursively mask sensitive fields in a parsed request body.
 *
 * Depth-capped and cycle-safe: request bodies are attacker-controlled, so an
 * adversarial payload must not be able to turn logging into a stack overflow or
 * an infinite loop. Exceeding the depth yields a marker rather than silently
 * truncating, so a reader can tell the difference between "nothing there" and
 * "we stopped looking".
 */
export function redactBody(
  value: unknown,
  additional: readonly string[] = [],
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  const MAX_DEPTH = 8;
  if (depth > MAX_DEPTH) return "[TRUNCATED: max depth]";
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return "[CIRCULAR]";
  seen.add(value as object);

  const deny = toLowerSet([...DEFAULT_REDACTED_BODY_FIELDS, ...additional]);

  if (Array.isArray(value)) {
    return value.map((v) => redactBody(v, additional, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = deny.has(key.toLowerCase())
      ? REDACTED
      : redactBody(v, additional, depth + 1, seen);
  }
  return out;
}

/**
 * A log-safe shallow copy of an API Gateway event.
 *
 * Covers every place a credential reaches the handler:
 *   - `headers` (v1 and v2)
 *   - `multiValueHeaders` (v1 only, and it carries the same Authorization value)
 *   - `queryStringParameters` / `multiValueQueryStringParameters`
 *   - `requestContext.authorizer`, redacted wholesale because it holds token
 *     claims (and, with a JWT authorizer, sometimes the raw token). It is
 *     derived from the request's credential, so it is exactly as sensitive.
 *   - `body`, dropped entirely — it is logged separately and only under debug,
 *     so including it here would reintroduce the leak by another route.
 */
export function safeEventForLog(
  event: unknown,
  options: {
    redactHeaders?: readonly string[];
    redactQueryParams?: readonly string[];
  } = {}
): unknown {
  if (!event || typeof event !== "object") return event;

  const e = event as Record<string, unknown>;
  const safe: Record<string, unknown> = { ...e };

  if (e.headers) {
    safe.headers = redactHeaders(
      e.headers as Record<string, unknown>,
      options.redactHeaders
    );
  }
  if (e.multiValueHeaders) {
    safe.multiValueHeaders = redactHeaders(
      e.multiValueHeaders as Record<string, unknown>,
      options.redactHeaders
    );
  }
  if (e.queryStringParameters) {
    safe.queryStringParameters = redactQueryParams(
      e.queryStringParameters as Record<string, unknown>,
      options.redactQueryParams
    );
  }
  if (e.multiValueQueryStringParameters) {
    safe.multiValueQueryStringParameters = redactQueryParams(
      e.multiValueQueryStringParameters as Record<string, unknown>,
      options.redactQueryParams
    );
  }
  if (e.rawQueryString) {
    // A raw string cannot be masked per-key; drop it rather than risk emitting a
    // token. The redacted structured form above conveys the same information.
    safe.rawQueryString = REDACTED;
  }

  if (e.requestContext && typeof e.requestContext === "object") {
    const rc = { ...(e.requestContext as Record<string, unknown>) };
    if ("authorizer" in rc) rc.authorizer = REDACTED;
    safe.requestContext = rc;
  }

  // Logged separately, under debug only.
  delete safe.body;

  return safe;
}

/**
 * A one-line, always-safe request summary.
 *
 * Kept unconditional so turning verbose logging off does not blind operators:
 * without this, disabling debug would leave no record that a request happened at
 * all. Contains no credential and no request payload.
 */
export function requestSummary(event: unknown): string {
  if (!event || typeof event !== "object") return "request";

  const e = event as Record<string, unknown>;
  const rc = (e.requestContext ?? {}) as Record<string, any>;
  const http = (rc.http ?? {}) as Record<string, any>;

  const method = http.method ?? rc.httpMethod ?? e.httpMethod ?? "?";
  const path = http.path ?? e.rawPath ?? e.path ?? "?";
  const requestId = rc.requestId ?? "-";
  const sourceIp = http.sourceIp ?? (rc.identity as any)?.sourceIp ?? "-";

  return `${method} ${path} requestId=${requestId} sourceIp=${sourceIp}`;
}
