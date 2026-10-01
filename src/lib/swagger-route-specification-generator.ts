import * as joi from 'joi';
import joiToSwagger, { ComponentsSchema } from 'joi-to-swagger';
import { ConfigRouteEntry, RouteSchema, AsyncBindingConfig, MiddlewareChain, SecuritySchemeObject } from './types-and-interfaces';
import * as swaggerTypes from './swagger-specification-types';
import { assertSchemesDeclared, securityOfChain, SecurityRequirementObject } from './openapi-security';

type RouteSpecType = {
  path: {
    description: string,
    operationId?: string,
    tags?: string[],
    parameters?: Array<swaggerTypes.ParameterObject>,
    requestBody?: swaggerTypes.RequestBody,
    responses?: Record<string, swaggerTypes.ResponseObject>,
    security?: SecurityRequirementObject[],
    'x-async-binding'?: Record<string, unknown>,
    [extension: `x-${string}`]: unknown,
  },
  components: {
    schemas: Record<string, ComponentsSchema>,
  },
};

export type SwaggerGeneratorOptions = {
  /** Base URL path used to derive tags from route paths (e.g., '/api/v1') */
  routesBaseUrlPath?: string;
  /** If false, disables automatic tag grouping. Defaults to true. */
  groupByTag?: boolean;
  /** If true, appends `apiClient.{methodName}` to the description. Defaults to true. */
  includeMethodNameInDescription?: boolean;
  /**
   * The document's security schemes. When a route's chain declares security, every
   * scheme it names must be one of these.
   */
  securitySchemes?: Record<string, SecuritySchemeObject>;
};

/**
 * Derives a tag name from a route path by extracting the first resource segment
 * after the base URL path. E.g., '/api/v1/campaigns/:campaignId/analytics' => 'Campaigns'
 */
export const deriveTagFromPath = (routePath: string, basePath?: string): string => {
  let relativePath = routePath;
  if (basePath) {
    relativePath = routePath.startsWith(basePath) ? routePath.slice(basePath.length) : routePath;
  }
  // Remove leading slash, split, find first non-param segment
  const segments = relativePath.replace(/^\//, '').split('/');
  const resourceSegment = segments.find(s => !s.startsWith(':') && !s.startsWith('{') && s.length > 0);
  if (!resourceSegment) return 'Default';
  // Convert kebab-case to Title Case (e.g., 'merge-fields' => 'Merge Fields')
  return resourceSegment
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

function buildAsyncBindingExtension(asyncBinding?: AsyncBindingConfig): Record<string, unknown> {
  if (!asyncBinding) return {};

  const extension: Record<string, unknown> = {
    event: asyncBinding.event,
    room: asyncBinding.room,
  };

  if (asyncBinding.idField) {
    extension.idField = asyncBinding.idField;
  }

  if (asyncBinding.description) {
    extension.description = asyncBinding.description;
  }

  if (asyncBinding.lifecycleEvents && asyncBinding.lifecycleEvents.length > 0) {
    extension.lifecycleEvents = asyncBinding.lifecycleEvents;
  }

  if (asyncBinding.payload) {
    try {
      const { swagger } = joiToSwagger(asyncBinding.payload);
      extension.payload = swagger;
    } catch {
      // If payload schema fails to convert, omit it
    }
  }

  return { 'x-async-binding': extension };
}

/** The route's `x-` extensions, emitted exactly as declared. */
function buildPassThroughExtensions(routeEntry: ConfigRouteEntry, route: string): Record<string, unknown> {
  const extensions = routeEntry.extensions;
  if (!extensions) return {};
  for (const key of Object.keys(extensions)) {
    if (!key.startsWith('x-')) {
      throw new Error(`${route}: extension "${key}" is not an OpenAPI extension; its name must start with "x-"`);
    }
    if (key === 'x-async-binding') {
      throw new Error(`${route}: x-async-binding is emitted from the route's asyncBinding, not from extensions`);
    }
  }
  return { ...extensions };
}

/** The route's standard `security`, from what its middleware chain declares. */
function buildSecurity(
  routeChain: MiddlewareChain | undefined,
  securitySchemes: Record<string, SecuritySchemeObject> | undefined,
  route: string,
): { security?: SecurityRequirementObject[] } {
  const security = securityOfChain(routeChain, route);
  if (!security) return {};
  assertSchemesDeclared(security, securitySchemes, route);
  return { security };
}

/**
 * The OpenAPI operation for one route. Pass the route's middleware chain to emit its
 * standard `security` (see `declareSecurity`).
 */
export const generateRouteSwaggerSpec = (
  schema: RouteSchema,
  routeEntry: ConfigRouteEntry,
  options?: SwaggerGeneratorOptions,
  routeChain?: MiddlewareChain,
): RouteSpecType => {
  const { requestBody: requestBodyJoiSchema, query: queryJoiSchema, params: pathParamsJoiSchema, responseBody: responseBodyJoiSchema } = { requestBody: {}, query: {}, params: {}, responseBody: {}, ...schema };
  const { description, swaggerMethodName, tag, path: routePath } = routeEntry;
  const {
    routesBaseUrlPath,
    groupByTag = true,
    includeMethodNameInDescription = true,
    securitySchemes,
  } = options || {};
  const routeName = `${routeEntry.method} ${routePath}`;
  // console.log('schema:')
  // console.log(schema);
  let parameters: Array<swaggerTypes.ParameterObject> = [];
  let requestBody: swaggerTypes.RequestBody | undefined = undefined;
  let responseBody: swaggerTypes.ResponseObject = { description: 'Default response' };
  // let requestBodyRefKey: string | undefined;
  // let responseBodyRefKey: string | undefined;
  let componentSchemas: Record<string, ComponentsSchema> = {};
  if (pathParamsJoiSchema && Object.keys(pathParamsJoiSchema).length > 0) {
    const pathParamsKeys = Object.keys(pathParamsJoiSchema);
    const pathParamsSwaggerParameters = pathParamsKeys.map<swaggerTypes.ParameterObject>((key) => ({
      name: key,
      in: 'path',
      required: true,
      schema: joiToSwagger(pathParamsJoiSchema[key]!).swagger,
    }));
    parameters = Array<swaggerTypes.ParameterObject>().concat(parameters, pathParamsSwaggerParameters);
  }
  if (queryJoiSchema && Object.keys(queryJoiSchema).length > 0) {
    const queryKeys = Object.keys(queryJoiSchema);
    const queryParamsSwaggerParameters = queryKeys.map<swaggerTypes.ParameterObject>((key) => {
      const { presence } = queryJoiSchema[key]!._flags;
      return {
        name: key,
        in: 'query',
        required: presence === 'required',
        schema: joiToSwagger(queryJoiSchema[key]!).swagger,
      };
    });
    parameters = Array<swaggerTypes.ParameterObject>().concat(parameters, queryParamsSwaggerParameters);
  }
  if (requestBodyJoiSchema && Object.keys(requestBodyJoiSchema).length > 0) {
    const { swagger, components: requestComponent } = joiToSwagger(
      joi.isSchema(requestBodyJoiSchema) ? requestBodyJoiSchema : joi.object(requestBodyJoiSchema)
    );
    requestBody = {
      description: 'Default response body',
      content: {
        'application/json': {
          schema: swagger,
        },
      },
    };
    // console.log(swagger);
    if (swagger.$ref || (swagger.items && swagger.items.$ref)) {
      // requestBodyRefKey = swagger.$ref.split('/').reverse()[0];
      componentSchemas = { ...componentSchemas, ...requestComponent!.schemas };
    }
  }
  if (responseBodyJoiSchema && Object.keys(responseBodyJoiSchema).length > 0) {
    const { swagger, components: responseComponent } = joiToSwagger(
      joi.isSchema(responseBodyJoiSchema) ? responseBodyJoiSchema : joi.object(responseBodyJoiSchema)
    );
    // console.log(JSON.stringify(j2s, null, 2));
    // console.log(swagger);
    responseBody = {
      description: 'Default response body',
      content: {
        'application/json': {
          schema: swagger,
        },
      },
    };
    if (swagger.$ref || (swagger.items && swagger.items.$ref)) {
      // responseBodyRefKey = swagger.$ref.split('/').reverse()[0];
      componentSchemas = { ...componentSchemas, ...responseComponent!.schemas };
    }
  }

  // Build enhanced description with API client method name
  let enhancedDescription = description;
  if (includeMethodNameInDescription && swaggerMethodName) {
    enhancedDescription = `${description} — \`apiClient.${swaggerMethodName}()\``;
  }

  // Determine tags
  const tags: string[] = [];
  if (groupByTag) {
    if (tag) {
      tags.push(tag);
    } else {
      tags.push(deriveTagFromPath(routePath, routesBaseUrlPath));
    }
  }

  return {
    path: {
      description: enhancedDescription,
      operationId: swaggerMethodName || undefined,
      ...(tags.length > 0 ? { tags } : {}),
      parameters,
      requestBody,
      responses: {
        '200': responseBody,
      },
      ...buildSecurity(routeChain, securitySchemes, routeName),
      ...buildAsyncBindingExtension(routeEntry.asyncBinding),
      ...buildPassThroughExtensions(routeEntry, routeName),
    },
    components: {
      schemas: componentSchemas,
    },
  };
};
