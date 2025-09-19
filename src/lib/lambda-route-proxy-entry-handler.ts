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
  routeConfigEntry: ConfigRouteEntry
) =>
  (routesConfig.authorizeAllRoutes &&
    routeConfigEntry.authorizeRoute !== false) ||
  routeConfigEntry.authorizeRoute === true;

export const getRouteModule = (
  config: RouteConfig,
  method: string,
  path: string,
  availableRouteModules: { [key: string]: any }
): RouteModule => {
  const routeEntry = getRouteConfigEntry(config, method, path);
  let routeModule = null;
  console.log(`route entry: ${JSON.stringify(routeEntry)}`);
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
  // Convert route path to regex pattern
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
  eventPath = eventPath.replace(/\?.*$/, ""); // Remove query string
  const normalizedPath = eventPath.replace(/^\//, ""); // Remove leading slash
  for (const config of configs) {
    const pattern = pathToRegex(config.path);
    const regex = new RegExp(`^${pattern}$`);
    const match = regex.exec(normalizedPath);

    if (match && method === config.method) {
      const params = match.groups || {};
      return { ...config, params };
    }

    if (regex.test(eventPath) && config.method === method) {
      return config;
    }
  }

  throw new CustomError(JSON.stringify({ message: "path no found" }), 400);
}

export const lambdaRouteProxyEntryHandler =
  (config: RouteConfig, availableRouteModules: { [key: string]: any }) =>
  async (
    event: APIGatewayProxyEventV2 | APIGatewayProxyEvent | APIGatewayEvent
  ) => {
    // Load security configuration
    const securityConfig = config.security || loadSecurityConfig();
    console.log(`Event Data: ${JSON.stringify(event)}`);
    const isV2 = (event as APIGatewayProxyEventV2).version === "2.0";

    const isProxied = !isV2 && event.hasOwnProperty("requestContext");

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
        availableRouteModules
      );

      console.log(`isBase64Encoded: ${isBase64Encoded}`);
      console.log(`body: ${body}`);
      const decodedBody = isBase64Encoded
        ? Buffer.from(body!, "base64").toString("utf-8")
        : undefined;
      console.log(`decodedBody:
      ${decodedBody}`);

      const routeArgs: RouteArguments = {
        query: queryStringParameters,
        params: pathParameters,
        body: body ? decodedBody || JSON.parse(body) : undefined,
        rawEvent: event,
      };
      
      retVal = await getRouteModuleResult(routeModule, routeArgs);

      if (isProxied) {
        if (retVal.statusCode && !retVal.body) {
          console.log("body must be included when status code is set", retVal);
          throw new CustomError("No body found", 500);
        } else if (retVal.statusCode && retVal.body) {
          // Generate secure headers based on configuration
          const requestOrigin = event.headers?.origin || event.headers?.Origin;
          const corsHeaders = generateCorsHeaders(securityConfig, requestOrigin);
          const jwtRotationHeaders = generateJwtRotationHeaders(securityConfig, routeArgs.routeData);
          
          retVal = {
            ...retVal,
            isBase64Encoded: false,
            headers: {
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
        retVal = {
          statusCode: 200,
          body: JSON.stringify(retVal),
          "Content-Type": "application/json",
        };
      }
    } catch (error: any) {
      console.error(JSON.stringify({ error, stack: error.stack }));
      let headers = {
        "Content-Type": "application/json",
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
      }
      if (error instanceof CustomError) {
        retVal = {
          statusCode,
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
