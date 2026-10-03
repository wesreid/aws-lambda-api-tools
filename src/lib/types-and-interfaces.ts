import { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import { Schema } from 'joi';
import * as swaggerTypes from './swagger-specification-types';

export type AsyncBindingLifecycleEvent = {
  /** WebSocket event name for this lifecycle stage */
  event: string;
  /** Human-readable description of when this event fires */
  description?: string;
};

export type AsyncBindingConfig = {
  /** WebSocket event name emitted on async completion */
  event: string;
  /** Room pattern for subscription (e.g., 'generation:{jobId}', 'user:{userId}') */
  room: string;
  /**
   * The response field that carries the job's id, when it is not named like the
   * event's own id field (e.g. the route returns `generationJobId` and the event
   * carries `jobId`). Agents read the id from here to wait for the event.
   */
  idField?: string;
  /** Additional lifecycle events beyond completion (progress, queued, failed, etc.) */
  lifecycleEvents?: AsyncBindingLifecycleEvent[];
  /** Human-readable description of when the completion event fires */
  description?: string;
  /** Joi schema for the completion event payload (emitted as JSON Schema in OpenAPI) */
  payload?: Schema<any>;
};

export type ConfigRouteEntry = {
  functionName?: string;
  description: string;
  swaggerMethodName?: string,
  path: string;
  method: 'ANY' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';
  generateOpenApiDocs: boolean,
  handlerPath: string;
  authorizeRoute?: boolean;
  /** OpenAPI tag for grouping this route in the Swagger UI. If not set, auto-derived from the path. */
  tag?: string;
  /** Declares the async WebSocket event(s) that correspond to this route's asynchronous result */
  asyncBinding?: AsyncBindingConfig;
  /**
   * OpenAPI specification extensions for this route's operation, emitted exactly as
   * given. Every key starts with `x-`. `x-async-binding` is emitted from `asyncBinding`.
   */
  extensions?: Record<`x-${string}`, unknown>;
  /**
   * Namespace for multi-Lambda deployments. Routes with the same namespace are
   * bundled and deployed together. When used with `generate-route-modules --namespace X`,
   * only handlers belonging to that namespace are included in the generated map.
   *
   * If not set, auto-derived from the config filename: `_routes-config.{namespace}.ts` → namespace.
   */
  namespace?: string;
};

export type SecurityConfig = {
  cors?: {
    allowOrigin?: string | string[] | RegExp | RegExp[];
    allowOriginPatterns?: string[]; // Regex patterns as strings for JSON config
    allowMethods?: string[];
    allowHeaders?: string[];
    allowCredentials?: boolean;
    maxAge?: number;
  };
  defaultHeaders?: Record<string, string>;
  jwtRotationHeaders?: {
    enabled?: boolean;
    rotationRequiredHeader?: string;
    rotationReasonHeader?: string;
  };
};

export type LoggingConfig = {
  /**
   * Verbose request logging: the (redacted) event and the request body.
   *
   * Defaults to FALSE. Previously this logging was unconditional, which wrote a
   * live Bearer token to CloudWatch on every request to every route.
   *
   * Can also be enabled per-environment without a code change via
   * `LAMBDA_API_TOOLS_DEBUG=true` or `LOG_LEVEL=debug`. Note that enabling debug
   * does NOT disable redaction — secrets stay masked either way.
   */
  debug?: boolean;
  /** Extra header names to mask, merged with the built-in list. */
  redactHeaders?: string[];
  /** Extra query parameter names to mask, merged with the built-in list. */
  redactQueryParams?: string[];
  /** Extra body field names to mask, merged with the built-in list. */
  redactBodyFields?: string[];
  /**
   * Emit a one-line `METHOD /path requestId=... sourceIp=...` summary for every
   * request. Default TRUE, so turning debug off does not leave operators with no
   * record that a request occurred. Contains no credential or payload.
   */
  requestSummary?: boolean;
};

/** An OpenAPI security scheme object (`components.securitySchemes`), as the product declares it. */
export type SecuritySchemeObject =
  | { type: 'apiKey'; name: string; in: 'query' | 'header' | 'cookie'; description?: string }
  | { type: 'http'; scheme: string; bearerFormat?: string; description?: string }
  | { type: 'mutualTLS'; description?: string }
  | { type: 'oauth2'; flows: Record<string, unknown>; description?: string }
  | { type: 'openIdConnect'; openIdConnectUrl: string; description?: string };

export type OpenApiConfig = {
  /**
   * The document's `components.securitySchemes`. Every scheme a route's middleware
   * declares (`declareSecurity`) must be one of these.
   */
  securitySchemes?: Record<string, SecuritySchemeObject>;
};

export type RouteConfig = {
  authorizeAllRoutes?: boolean;
  routes: Array<ConfigRouteEntry>;
  routesBaseUrlPath?: string; // Optional base URL path (e.g., '/api/v1')
  security?: SecurityConfig;
  logging?: LoggingConfig;
  /**
   * When true, v2 HTTP API events use `event.rawPath` + `event.requestContext.http.method`
   * instead of `event.routeKey` for route resolution. Required for greedy proxy routes
   * where routeKey is `"ANY /prefix/{proxy+}"` rather than `"GET /actual/path"`.
   */
  useRawPath?: boolean;
  /** Document-level OpenAPI declarations. */
  openApi?: OpenApiConfig;
  /**
   * The body of every error response the library gives: an error thrown by a route's
   * chain, a request body that is not JSON (400) and, in rawPath mode and the dev
   * server, a path no route matches (404). Its return value is serialized as JSON.
   *
   * Without it, an error's body is its message, as before.
   */
  errorBody?: (failure: ErrorBodyInput) => unknown;
};

/** What `RouteConfig.errorBody` is given for one error response. */
export type ErrorBodyInput = {
  /** The status the response carries. */
  statusCode: number;
  /** The error's message, or the library's own for a failure it detects. */
  message: string;
  /**
   * What was thrown, so a product can read its own error's fields. For a failure the
   * library detects itself, the `CustomError` it raised.
   */
  error: unknown;
};

export type RouteArguments = {
  params?: any;
  body?: any;
  query?: any;
  form?: any;
  rawEvent?: APIGatewayProxyEventV2 | APIGatewayProxyEvent;
  routeData?: any;
  responseHeaders?: Record<string, string>; // Middleware can add headers here
};

export interface RouteSchema {
  params?: { [key: string]: Schema<any> };
  query?: { [key: string]: Schema<any> };
  form?: { [key: string]: Schema<any> };
  /** The request body. It is required in the OpenAPI document when the schema is `.required()`. */
  requestBody?: Schema<any> | { [key: string]: Schema<any> };
  /** The `200` response's body. A route declares this or `responses`, not both. */
  responseBody?: Schema<any> | { [key: string]: Schema<any> };
  /**
   * Every response the route can give, keyed by HTTP status code (`'201'`, `'404'`) or
   * `'default'`: success and error alike. Each is emitted on the operation in the
   * OpenAPI document; a response without a `body` has no content (a `204`).
   */
  responses?: { [status: string]: RouteResponseSchema };
}

/** One declared response of a route. */
export interface RouteResponseSchema {
  /** What this response means. Required by OpenAPI. */
  description: string;
  /** The response's JSON body, if it has one. */
  body?: Schema<any>;
}

export interface BaseResponseObject extends swaggerTypes.ResponseObject {}

export interface ResponseError extends swaggerTypes.ResponseObject {
  error: {
    statusCode: string;
    message: string;
  };
}

export interface ResponseData extends swaggerTypes.ResponseObject {
  data: any;
}

export type ResponseObject<T> = ResponseData | ResponseError;

export type BaseRouteResponse<T> = {
  [key in
    | '201'
    | '202'
    | '203'
    | '204'
    | '205'
    | '206'
    | '400'
    | '401'
    | '402'
    | '403'
    | '404'
    | '405'
    | '406'
    | '407'
    | '408'
    | '409'
    | '410'
    | '411'
    | '412'
    | '413'
    | '414'
    | '415'
    | '416'
    | '417'
    | '418'
    | '419']: ResponseObject<T>;
};

export interface RouteResponse<T> extends BaseRouteResponse<T> {
  '200': ResponseObject<T>;
}

export type MiddlewareSchemaInputFunction = (input: RouteSchema) => RouteArguments;
export type MiddlewareArgumentsInputFunction = (input: RouteArguments) => any;
export type MiddlewareChain = Array<MiddlewareArgumentsInputFunction>;
export type RouteModule = {
  routeChain: MiddlewareChain;
  routeSchema: RouteSchema;
};

export interface Permission {
  id: string;
  systemPermission: string;
  enabled: boolean;
  humanReadableName: string;
  entity: {
    level: string;
    humanReadableName: string;
  };
}
