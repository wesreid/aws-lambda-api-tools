import {
  APIGatewayEvent,
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
} from "aws-lambda";
import { CustomError } from "./custom-error";
import {
  RouteConfig,
  ConfigRouteEntry,
  RouteArguments,
  RouteModule,
  SecurityConfig,
} from "./types-and-interfaces";
import { authorizeRoute } from "./authorization-helper";
import {
  loadSecurityConfig,
  generateCorsHeaders,
  generateJwtRotationHeaders
} from "./security-config-loader";
import {
  safeEventForLog,
  redactBody,
  requestSummary,
} from "./log-redaction";

/**
 * Is verbose request logging enabled?
 *
 * Explicit config wins; otherwise an environment variable, so an operator can
 * turn it on for one environment without shipping code. Defaults to OFF — this
 * logging used to be unconditional and wrote a live Bearer token to CloudWatch on
 * every request.
 *
 * Enabling debug never disables redaction; see ./log-redaction.
 */
const isDebugLoggingEnabled = (config: RouteConfig): boolean => {
  if (config.logging?.debug !== undefined) return config.logging.debug;

  const flag = (process.env.LAMBDA_API_TOOLS_DEBUG ?? "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(flag)) return true;

  const level = (process.env.LOG_LEVEL ?? "").toLowerCase();
  return level === "debug" || level === "trace";
};

const getRouteConfigEntry = (
  config: RouteConfig,
  method: string,
  path: string
) =>
  config.routes.find(
    (r) =>
      r.path.toLowerCase() === path.toLowerCase() &&
      r.method.toLowerCase() === method.toLowerCase()
  ) as ConfigRouteEntry;

const shouldAuthorizeRoute = (
  routesConfig: RouteConfig,
  routeConfigEntry: ConfigRouteEntry | undefined
) =>
  routeConfigEntry != null &&
  ((routesConfig.authorizeAllRoutes &&
    routeConfigEntry.authorizeRoute !== false) ||
  routeConfigEntry.authorizeRoute === true);

export const getRouteModule = (
  config: RouteConfig,
  method: string,
  path: string,
  availableRouteModules: { [key: string]: any },
  debug = false
): RouteModule => {
  const routeEntry = getRouteConfigEntry(config, method, path);
  let routeModule = null;
  // Route config is not sensitive, but logging it on every request to every route
  // is pure volume. Debug-only.
  if (debug) console.log(`route entry: ${JSON.stringify(routeEntry)}`);
  if (routeEntry) {
    const matchingRouteModuleMapKey = Object.keys(availableRouteModules).find(
      (k: string) => routeEntry.handlerPath.endsWith(k)
    );
    // routeModule = availableRouteModules[routeEntry.handlerPath.split('/').reverse()[0]];
    routeModule = availableRouteModules[matchingRouteModuleMapKey!];
  }
  return routeModule;
};

interface RouteEvent {
  routeKey: string;
  queryStringParameters: { [key: string]: string | undefined };
  pathParameters: { [key: string]: string | undefined };
  body: string | undefined | null;
  isBase64Encoded: boolean;
}

export const getRouteModuleResult = async (
  { routeChain }: RouteModule,
  incoming: RouteArguments
): Promise<any> => {
  let returnValue = incoming;
  for (const chainFn of routeChain) {
    returnValue = await chainFn(returnValue);
  }
  return returnValue;
};

function pathToRegex(path: string): string {
  // Convert route path to regex pattern.
  // Always work with a leading slash — callers normalize both sides.
  return path
    .replace(/\//g, "\\/") // Escape forward slashes
    .replace(/{([^}]+)}/g, "(?<$1>[^/]+)"); // Convert {param} to named capture groups
}

const v2ApiGatewayEvent = (event: APIGatewayProxyEventV2): RouteEvent => {
  return {
    routeKey: event.routeKey,
    queryStringParameters:
      event.queryStringParameters ??
      ({} as RouteEvent["queryStringParameters"]),
    pathParameters: event.pathParameters ?? {},
    body: event.body,
    isBase64Encoded: event.isBase64Encoded,
  };
};

const v1ApiGatewayEvent = (
  event: APIGatewayProxyEvent,
  config: RouteConfig
): RouteEvent => {
  const routeConfig = getRouteConfigByPath(
    event.path,
    event.httpMethod,
    config.routes
  );
  return {
    routeKey: `${event.httpMethod} ${routeConfig.path}`,
    queryStringParameters: event.queryStringParameters ?? {},
    pathParameters: routeConfig.params ?? {},
    body: event.body,
    isBase64Encoded: event.isBase64Encoded,
  };
};

export function getRouteConfigByPath(
  eventPath: string,
  method: string,
  configs: ConfigRouteEntry[]
): ConfigRouteEntry & { params?: { [key: string]: string } } {
  eventPath = eventPath.replace(/\?.*$/, ""); // strip query string

  // Collect all matching candidates with their specificity scores
  const candidates: Array<{
    config: ConfigRouteEntry;
    params: { [key: string]: string };
    staticSegments: number;
    totalSegments: number;
    index: number;
  }> = [];

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    if (!cfg) continue;

    if (cfg.method.toUpperCase() !== method.toUpperCase() && cfg.method !== "ANY") {
      continue;
    }

    // Normalize both paths: ensure leading slash, compare consistently
    const normalizedEvent = "/" + eventPath.replace(/^\//, "");
    const normalizedConfig = "/" + cfg.path.replace(/^\//, "");

    const pattern = pathToRegex(normalizedConfig);
    const regex = new RegExp(`^${pattern}$`);
    const match = regex.exec(normalizedEvent);

    if (match) {
      const params = match.groups || {};

      // Count specificity: static segments beat param segments
      const segments = normalizedConfig.split("/").filter(Boolean);
      const staticSegments = segments.filter((s) => !s.startsWith("{")).length;

      candidates.push({
        config: cfg,
        params,
        staticSegments,
        totalSegments: segments.length,
        index: i,
      });
    }
  }

  if (candidates.length === 0) {
    throw new CustomError(JSON.stringify({ message: "Not found" }), 404);
  }

  // Sort: most static segments first (most specific wins).
  // On tie: more total segments first. On tie: declaration order.
  candidates.sort((a, b) => {
    if (b.staticSegments !== a.staticSegments) return b.staticSegments - a.staticSegments;
    if (b.totalSegments !== a.totalSegments) return b.totalSegments - a.totalSegments;
    return a.index - b.index;
  });

  const winner = candidates[0]!;
  return { ...winner.config, params: winner.params };
}

export const lambdaRouteProxyEntryHandler =
  (config: RouteConfig, availableRouteModules: { [key: string]: any }) =>
    async (
      event: APIGatewayProxyEventV2 | APIGatewayProxyEvent | APIGatewayEvent
    ) => {
      // Load security configuration
      const securityConfig = config.security || loadSecurityConfig();
      const debug = isDebugLoggingEnabled(config);
      const logging = config.logging ?? {};

      // Always-on, credential-free: without this, disabling debug would leave no
      // record that a request happened at all.
      if (logging.requestSummary !== false) {
        console.log(requestSummary(event));
      }

      // Previously unconditional and unredacted, which wrote the caller's Bearer
      // token to CloudWatch on every request. Now debug-only AND redacted.
      if (debug) {
        console.log(
          `Event Data: ${JSON.stringify(
            safeEventForLog(event, {
              redactHeaders: logging.redactHeaders,
              redactQueryParams: logging.redactQueryParams,
            })
          )}`
        );
      }

      const isV2 = (event as APIGatewayProxyEventV2).version === "2.0";

      const isProxied = !isV2 && event.hasOwnProperty("requestContext");

      // --- v2 rawPath mode: resolve actual path instead of greedy routeKey ---
      // When useRawPath is true and the event is v2, routeKey may be
      // "ANY /prefix/{proxy+}" which is useless for resolution. Use rawPath +
      // requestContext.http.method to resolve via getRouteConfigByPath() and
      // short-circuit 404 before auth or module loading.
      if (isV2 && config.useRawPath) {
        const v2Event = event as APIGatewayProxyEventV2;
        const resolvedMethod = v2Event.requestContext.http.method;
        let resolvedRoute: ConfigRouteEntry & { params?: { [key: string]: string } };
        try {
          resolvedRoute = getRouteConfigByPath(
            v2Event.rawPath,
            resolvedMethod,
            config.routes
          );
        } catch (err: any) {
          // Early-exit 404: don't invoke auth, don't load route module, don't
          // initialise Prisma. Return immediately to save Lambda invocation cost.
          if (err instanceof CustomError && (err.httpStatusCode === 404 || err._httpStatusCode === 404)) {
            const requestOrigin = event.headers?.origin || event.headers?.Origin;
            const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
            return {
              statusCode: 404,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
              body: err.message,
            };
          }
          throw err;
        }

        // Build a synthetic RouteEvent using the resolved route info
        const newEvent: RouteEvent = {
          routeKey: `${resolvedMethod} ${resolvedRoute.path}`,
          queryStringParameters:
            v2Event.queryStringParameters ??
            ({} as RouteEvent["queryStringParameters"]),
          pathParameters: resolvedRoute.params ?? {},
          body: v2Event.body,
          isBase64Encoded: v2Event.isBase64Encoded,
        };

        const {
          routeKey,
          queryStringParameters,
          pathParameters,
          body,
          isBase64Encoded: isBase64,
        } = newEvent;

        let retVal: any = {};
        try {
          const [method = "", path = ""] = routeKey.split(" ");
          if (
            shouldAuthorizeRoute(config, getRouteConfigEntry(config, method, path))
          ) {
            await authorizeRoute(event);
          }

          const routeModule = getRouteModule(
            config,
            method,
            path,
            availableRouteModules,
            debug
          );

          let parsedBody = undefined;
          if (body) {
            const rawBody = isBase64
              ? Buffer.from(body, "base64").toString("utf-8")
              : body;
            parsedBody = JSON.parse(rawBody);
          }

          if (debug) {
            console.log(
              `body (isBase64Encoded=${isBase64}): ${JSON.stringify(
                redactBody(parsedBody, logging.redactBodyFields)
              )}`
            );
          }

          const routeArgs: RouteArguments = {
            query: queryStringParameters,
            params: pathParameters,
            body: parsedBody,
            rawEvent: event,
          };

          retVal = await getRouteModuleResult(routeModule, routeArgs);

          if (retVal.isBase64Encoded === true) {
            const requestOrigin = event.headers?.origin || event.headers?.Origin;
            const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
            retVal = {
              ...retVal,
              headers: {
                ...securityConfig.defaultHeaders,
                ...corsHeaders,
                ...(routeArgs.responseHeaders ?? {}),
                ...(retVal.headers ?? {}),
              },
            };
          } else if (retVal.statusCode && retVal.statusCode !== 200) {
            const requestOrigin = event.headers?.origin || event.headers?.Origin;
            const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
            retVal = {
              ...retVal,
              headers: {
                "Content-Type": "application/json",
                ...securityConfig.defaultHeaders,
                ...corsHeaders,
                ...(routeArgs.responseHeaders ?? {}),
                ...(retVal.headers ?? {}),
              },
              body:
                typeof retVal.body === "object"
                  ? JSON.stringify(retVal.body)
                  : retVal.body,
            };
          } else {
            retVal = {
              statusCode: 200,
              body: JSON.stringify(retVal),
              headers: {
                "Content-Type": "application/json",
              },
            };
          }
        } catch (error: any) {
          console.error(
            JSON.stringify({
              name: error?.name,
              message: error?.message,
              httpStatusCode: error?.httpStatusCode ?? error?._httpStatusCode,
              stack: error?.stack,
              request: requestSummary(event),
            })
          );
          const requestOrigin = event.headers?.origin || event.headers?.Origin;
          const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
          let headers = {
            "Content-Type": "application/json",
            ...corsHeaders,
          } as Record<string, string>;

          const statusCode = error.httpStatusCode || 500;
          if (error instanceof CustomError) {
            retVal = {
              statusCode: error.httpStatusCode || error._httpStatusCode || 500,
              headers,
              body: error.message,
            };
          } else {
            retVal = {
              statusCode,
              headers,
              body: error.message || JSON.stringify(error),
            };
          }
        }
        return retVal;
      }

      // --- Standard (non-rawPath) flow ---
      const newEvent = isV2
        ? v2ApiGatewayEvent(event as APIGatewayProxyEventV2)
        : v1ApiGatewayEvent(event as APIGatewayProxyEvent, config);

      const {
        routeKey,
        queryStringParameters,
        pathParameters,
        body,
        isBase64Encoded,
      } = newEvent;

      let retVal: any = {};
      try {
        const [method = "", path = ""] = routeKey.split(" ");
        if (
          shouldAuthorizeRoute(config, getRouteConfigEntry(config, method, path))
        ) {
          await authorizeRoute(event);
        }

        const routeModule = getRouteModule(
          config,
          method,
          path,
          availableRouteModules,
          debug
        );

        // Parse first, log once.
        //
        // This previously logged the body up to THREE times per request — `body:`,
        // then `parsing body directly:`/`decodedBody:`, then `parsedBody:` — all
        // unconditional and unredacted. That is a request-payload leak (bodies
        // carry credentials on auth routes and personal data on ingest routes)
        // and it tripled log volume for no diagnostic gain, since the three lines
        // held the same content.
        let parsedBody = undefined;
        if (body) {
          const rawBody = isBase64Encoded
            ? Buffer.from(body, "base64").toString("utf-8")
            : body;
          parsedBody = JSON.parse(rawBody);
        }

        if (debug) {
          console.log(
            `body (isBase64Encoded=${isBase64Encoded}): ${JSON.stringify(
              redactBody(parsedBody, logging.redactBodyFields)
            )}`
          );
        }

        const routeArgs: RouteArguments = {
          query: queryStringParameters,
          params: pathParameters,
          body: parsedBody,
          rawEvent: event,
        };

        retVal = await getRouteModuleResult(routeModule, routeArgs);

        // Binary pass-through: if the handler explicitly sets isBase64Encoded: true,
        // the response is a pre-formed API Gateway response (binary proxy, file download, etc.).
        // Pass it through without JSON-wrapping or header overriding.
        if (retVal.isBase64Encoded === true) {
          // Merge CORS + security headers beneath handler-provided headers so binary
          // endpoints still get proper CORS without having to set them manually.
          const requestOrigin = event.headers?.origin || event.headers?.Origin;
          const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
          retVal = {
            ...retVal,
            headers: {
              ...securityConfig.defaultHeaders,
              ...corsHeaders,
              ...(routeArgs.responseHeaders ?? {}),
              ...(retVal.headers ?? {}),
            },
          };
        } else if (isProxied) {
          if (retVal.statusCode && !retVal.body) {
            // Log the shape, not the contents. This is a handler misconfiguration,
            // so the useful signal is which route returned what status with which
            // keys — dumping the whole response object risks emitting response
            // payload (tokens on auth routes, personal data elsewhere) into logs.
            console.error(
              JSON.stringify({
                message: "body must be included when status code is set",
                request: requestSummary(event),
                statusCode: retVal.statusCode,
                responseKeys: Object.keys(retVal ?? {}),
              })
            );
            throw new CustomError("No body found", 500);
          } else if (retVal.statusCode && retVal.statusCode !== 200) {
            // Non-200 response from handler — ensure body is stringified for API Gateway
            const requestOrigin = event.headers?.origin || event.headers?.Origin;
            const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
            retVal = {
              ...retVal,
              headers: {
                "Content-Type": "application/json",
                ...securityConfig.defaultHeaders,
                ...corsHeaders,
                ...(routeArgs.responseHeaders ?? {}),
                ...(retVal.headers ?? {}),
              },
              body:
                typeof retVal.body === "object"
                  ? JSON.stringify(retVal.body)
                  : retVal.body,
            };
          } else if (retVal.statusCode && retVal.body) {
            // Generate secure headers based on configuration
            const requestOrigin = event.headers?.origin || event.headers?.Origin;
            const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
            const jwtRotationHeaders = generateJwtRotationHeaders(securityConfig, routeArgs.routeData);

            retVal = {
              ...retVal,
              isBase64Encoded: false,
              headers: {
                "Content-Type": "application/json",
                // 1. Default security headers from config (lowest priority)
                ...securityConfig.defaultHeaders,
                // 2. CORS headers (only if origin is allowed)
                ...corsHeaders,
                // 3. JWT rotation headers (if needed)
                ...jwtRotationHeaders,
                // 4. Middleware-provided headers (higher priority)
                ...(routeArgs.responseHeaders ?? {}),
                // 5. Handler-provided headers (highest priority - can override everything)
                ...(retVal.headers ?? {}),
              },
              body:
                typeof retVal.body === "object"
                  ? JSON.stringify(retVal.body)
                  : retVal.body,
            };
          }
        } else {
          if (
            retVal.statusCode &&
            (retVal.statusCode !== 200 || retVal.body !== undefined)
          ) {
            // Explicit response envelope from the handler on v2 HTTP API
            // (any non-200, or a 200 that carries its own body): pass it
            // through with headers merged, instead of double-wrapping.
            // Previously a 200 envelope was re-wrapped, which dropped the
            // handler's headers and serialized the whole envelope into the
            // body — breaking, e.g., challenge-echo handshakes that must
            // answer 200 with a specific response header.
            const requestOrigin = event.headers?.origin || event.headers?.Origin;
            const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
            retVal = {
              ...retVal,
              headers: {
                "Content-Type": "application/json",
                ...securityConfig.defaultHeaders,
                ...corsHeaders,
                ...(routeArgs.responseHeaders ?? {}),
                ...(retVal.headers ?? {}),
              },
              body:
                typeof retVal.body === "object"
                  ? JSON.stringify(retVal.body)
                  : retVal.body,
            };
          } else {
            retVal = {
              statusCode: 200,
              body: JSON.stringify(retVal),
              headers: {
                "Content-Type": "application/json",
              },
            };
          }
        }
      } catch (error: any) {
        // `Error.message` and `Error.stack` are NON-ENUMERABLE, so the previous
        // `JSON.stringify({ error, stack: error.stack })` serialized `error` as
        // `{}` and threw the message away — every failure logged as
        // `{"error":{},"stack":"..."}`. Pull the fields out explicitly.
        console.error(
          JSON.stringify({
            name: error?.name,
            message: error?.message,
            httpStatusCode: error?.httpStatusCode ?? error?._httpStatusCode,
            stack: error?.stack,
            request: requestSummary(event),
          })
        );
        const requestOrigin = event.headers?.origin || event.headers?.Origin;
        const corsHeaders = (isProxied || isV2)
          ? generateCorsHeaders(securityConfig, requestOrigin)
          : {};
        let headers = {
          "Content-Type": "application/json",
          ...corsHeaders,
        } as Record<string, string>;

        let statusCode = 500;

        if (isProxied) {
          const isOptions =
            (event.requestContext as any).httpMethod === "OPTIONS";
          if (isOptions) {
            statusCode = 200;
          } else {
            statusCode = error.httpStatusCode || 500;
          }
          headers = {
            ...headers,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods":
              "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
            "Access-Control-Allow-Credentials": "true",
          };
        } else if (isV2) {
          statusCode = error.httpStatusCode || 500;
        }
        if (error instanceof CustomError) {
          retVal = {
            statusCode: error.httpStatusCode || error._httpStatusCode || 500,
            headers,
            body: error.message,
          };
        } else {
          retVal = {
            statusCode,
            headers,
            body: error.message || JSON.stringify(error),
          };
        }
      }
      return retVal;
    };
