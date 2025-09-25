export type {
  BaseResponseObject,
  BaseRouteResponse,
  MiddlewareArgumentsInputFunction,
  MiddlewareChain,
  MiddlewareSchemaInputFunction,
  ResponseData,
  ResponseError,
  ResponseObject,
  RouteArguments,
  RouteModule,
  RouteResponse,
  RouteSchema,
  ConfigRouteEntry,
  RouteConfig,
  Permission,
  SecurityConfig,
} from './lib/types-and-interfaces';

export { CustomError } from './lib/custom-error';

export { lambdaRouteProxyEntryHandler } from './lib/lambda-route-proxy-entry-handler';

export { lambdaRouteProxyPathNotFound } from './lib/lambda-route-proxy-path-not-found';

export { schemaValidationMiddleware } from './lib/middlewares/route-module-schema-validation-middleware';

export { jwtValidationMiddleware } from './lib/middlewares/route-module-jwt-validation-middleware';

export { 
  addResponseHeader,
  addResponseHeaders,
  addConditionalHeader,
  addRateLimitHeaders,
  addCacheHeaders,
  addSecurityHeaders,
  addAuthHeaders,
} from './lib/middleware-helpers';
