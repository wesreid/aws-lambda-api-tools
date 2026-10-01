import type { ComponentsSchema } from 'joi-to-swagger';
import { generateRouteSwaggerSpec, SwaggerGeneratorOptions } from './swagger-route-specification-generator';
import type { RouteConfig, RouteModule, SecuritySchemeObject } from './types-and-interfaces';
import { toOpenApi31Operation, toOpenApi31Schema } from './openapi-31';

type Operation = ReturnType<typeof generateRouteSwaggerSpec>['path'];

/** The route document `generate-oas` writes: the paths and components a product merges into its root spec. */
export type RouteOpenApiDocument = {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas?: Record<string, ComponentsSchema>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
  };
};

export type BuildOpenApiDocumentOptions = Pick<SwaggerGeneratorOptions, 'groupByTag' | 'includeMethodNameInDescription'> & {
  /**
   * The OpenAPI version the schemas are written for. `3.1` writes them as JSON
   * Schema 2020-12 (a `null` type, not 3.0's `nullable`); default `3.0`, as
   * joi-to-swagger writes them. Set the root document's `openapi` to match.
   */
  openApiVersion?: '3.0' | '3.1';
};

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

    const as31 = options.openApiVersion === '3.1';
    const methods = (doc.paths[route.path] ??= {});
    methods[route.method.toLowerCase()] = as31 ? toOpenApi31Operation(operation) : operation;
    const schemas = as31
      ? Object.fromEntries(
          Object.entries(components.schemas).map(([name, schema]) => [
            name,
            toOpenApi31Schema(schema as Record<string, unknown>) as typeof schema,
          ]),
        )
      : components.schemas;
    doc.components.schemas = { ...doc.components.schemas, ...schemas };
  }
  if (securitySchemes && Object.keys(securitySchemes).length > 0) {
    doc.components.securitySchemes = { ...securitySchemes };
  }
  return doc;
}
