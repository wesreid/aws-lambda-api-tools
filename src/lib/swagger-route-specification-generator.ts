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

/** A Joi schema as an OpenAPI JSON media type, with the named schemas it references. */
function jsonContent(schema: joi.Schema): { content: NonNullable<swaggerTypes.RequestBody['content']>; components: Record<string, ComponentsSchema> } {
  const { swagger, components } = joiToSwagger(schema);
  return {
    content: { 'application/json': { schema: swagger } },
    // Every named schema the body reaches, not only the body's own: a named schema
    // nested in an unnamed body is referenced by `$ref` and must be defined.
    components: components?.schemas ?? {},
  };
}

const RESPONSE_STATUS = /^[1-5][0-9][0-9]$/;

/** The route's declared `responses`, as OpenAPI responses. */
function buildDeclaredResponses(
  responses: NonNullable<RouteSchema['responses']>,
  route: string,
): { responses: Record<string, swaggerTypes.ResponseObject>; components: Record<string, ComponentsSchema> } {
  const out: Record<string, swaggerTypes.ResponseObject> = {};
  let components: Record<string, ComponentsSchema> = {};
  for (const [status, declared] of Object.entries(responses)) {
    if (status !== 'default' && !RESPONSE_STATUS.test(status)) {
      throw new Error(`${route}: response status "${status}" is not an HTTP status code (100-599) or "default"`);
    }
    if (!declared || typeof declared.description !== 'string' || declared.description.trim() === '') {
      throw new Error(`${route}: response ${status} needs a description`);
    }
    if (declared.body === undefined) {
      out[status] = { description: declared.description };
      continue;
    }
    const media = jsonContent(declared.body);
    out[status] = { description: declared.description, content: media.content };
    components = { ...components, ...media.components };
  }
  return { responses: out, components };
}

/** Whether a request body schema says the body must be sent. */
function isRequired(schema: joi.Schema): boolean {
  return (schema as unknown as { _flags?: { presence?: string } })._flags?.presence === 'required';
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
  const declaresResponses = schema.responses !== undefined;
  if (declaresResponses && schema.responseBody !== undefined) {
    throw new Error(`${routeName}: declare responses or responseBody, not both`);
  }
  let parameters: Array<swaggerTypes.ParameterObject> = [];
  let requestBody: swaggerTypes.RequestBody | undefined = undefined;
  let responses: Record<string, swaggerTypes.ResponseObject> = { '200': { description: 'Default response' } };
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
    const bodySchema = joi.isSchema(requestBodyJoiSchema) ? requestBodyJoiSchema : joi.object(requestBodyJoiSchema);
    const media = jsonContent(bodySchema);
    requestBody = {
      description: 'Default response body',
      ...(isRequired(bodySchema) ? { required: true } : {}),
      content: media.content,
    };
    componentSchemas = { ...componentSchemas, ...media.components };
  }
  if (declaresResponses) {
    const declared = buildDeclaredResponses(schema.responses!, routeName);
    responses = declared.responses;
    componentSchemas = { ...componentSchemas, ...declared.components };
  } else if (responseBodyJoiSchema && Object.keys(responseBodyJoiSchema).length > 0) {
    const media = jsonContent(joi.isSchema(responseBodyJoiSchema) ? responseBodyJoiSchema : joi.object(responseBodyJoiSchema));
    responses = { '200': { description: 'Default response body', content: media.content } };
    componentSchemas = { ...componentSchemas, ...media.components };
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
      responses,
      ...buildSecurity(routeChain, securitySchemes, routeName),
      ...buildAsyncBindingExtension(routeEntry.asyncBinding),
      ...buildPassThroughExtensions(routeEntry, routeName),
    },
    components: {
      schemas: componentSchemas,
    },
  };
};
