export type {
  AsyncBindingConfig,
  AsyncBindingLifecycleEvent,
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
} from "./lib/types-and-interfaces";

export { CustomError } from "./lib/custom-error";

export { lambdaRouteProxyEntryHandler } from "./lib/lambda-route-proxy-entry-handler";

export { lambdaRouteProxyPathNotFound } from "./lib/lambda-route-proxy-path-not-found";

export { schemaValidationMiddleware } from "./lib/middlewares/route-module-schema-validation-middleware";

export { jwtValidationMiddleware } from "./lib/middlewares/route-module-jwt-validation-middleware";

export {
  addResponseHeader,
  addResponseHeaders,
  addConditionalHeader,
  addRateLimitHeaders,
  addCacheHeaders,
  addSecurityHeaders,
  addAuthHeaders,
} from "./lib/middleware-helpers";

export { createDevServer } from "./lib/dev-server";
export type { DevServerOptions } from "./lib/dev-server";

export {
  generateRouteSwaggerSpec,
  deriveTagFromPath,
} from "./lib/swagger-route-specification-generator";
export type { SwaggerGeneratorOptions } from "./lib/swagger-route-specification-generator";

export {
  generateRouteModules,
  checkRouteModules,
  collectHandlerPaths,
  renderRouteModules,
  handlerPathToIdentifier,
  extractNamespaceFromFilename,
} from "./lib/route-modules-generator";
export type {
  RouteModulesGeneratorOptions,
  GenerateRouteModulesResult,
  CheckRouteModulesResult,
} from "./lib/route-modules-generator";

/**
 * Runtime utility: filter a RouteConfig to only include routes belonging to a
 * specific namespace. Used by multi-Lambda deployments where each Lambda
 * handles only its namespace's routes.
 */
export function filterRoutesByNamespace(
  config: import("./lib/types-and-interfaces").RouteConfig,
  namespace: string,
): import("./lib/types-and-interfaces").RouteConfig {
  return {
    ...config,
    routes: config.routes.filter((r) => r.namespace === namespace),
  };
}
