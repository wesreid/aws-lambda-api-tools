import type { ComponentsSchema } from 'joi-to-swagger';
import { generateRouteSwaggerSpec, SwaggerGeneratorOptions } from './swagger-route-specification-generator';
import type { RouteConfig, RouteModule, SecuritySchemeObject } from './types-and-interfaces';

type Operation = ReturnType<typeof generateRouteSwaggerSpec>['path'];

/** The route document `generate-oas` writes: the paths and components a product merges into its root spec. */
export type RouteOpenApiDocument = {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas?: Record<string, ComponentsSchema>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
  };
};

export type BuildOpenApiDocumentOptions = Pick<SwaggerGeneratorOptions, 'groupByTag' | 'includeMethodNameInDescription'>;

/**
 * Build the OpenAPI paths and components for every route with `generateOpenApiDocs`.
 *
 * `loadRouteModule` returns a route's module (its `routeSchema` and `routeChain`) from
 * its `handlerPath`. Each operation carries the standard `security` its chain declares,
 * and the document carries the product's `openApi.securitySchemes`.
 */
export function buildOpenApiDocument(
  config: RouteConfig,
  loadRouteModule: (handlerPath: string) => RouteModule,
  options: BuildOpenApiDocumentOptions = {},
): RouteOpenApiDocument {
  const { routesBaseUrlPath } = config;
  const securitySchemes = config.openApi?.securitySchemes;
  const generatorOptions: SwaggerGeneratorOptions = {
    routesBaseUrlPath,
    groupByTag: options.groupByTag,
    includeMethodNameInDescription: options.includeMethodNameInDescription,
    securitySchemes,
  };

  const doc: RouteOpenApiDocument = { paths: {}, components: {} };
  for (const route of config.routes) {
    if (!route.generateOpenApiDocs) continue;
    const { routeSchema, routeChain } = loadRouteModule(route.handlerPath);
    const { path: operation, components } = generateRouteSwaggerSpec(routeSchema, route, generatorOptions, routeChain);

    // Without tag grouping, every operation shares one tag named for the base path.
    if (!operation.tags || operation.tags.length === 0) {
      operation.tags = [(routesBaseUrlPath ?? '').replace('/', '.')];
    }

    const methods = (doc.paths[route.path] ??= {});
    methods[route.method.toLowerCase()] = operation;
    doc.components.schemas = { ...doc.components.schemas, ...components.schemas };
  }
  if (securitySchemes && Object.keys(securitySchemes).length > 0) {
    doc.components.securitySchemes = { ...securitySchemes };
  }
  return doc;
}
