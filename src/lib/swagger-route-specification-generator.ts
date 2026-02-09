import * as joi from 'joi';
import joiToSwagger, { ComponentsSchema } from 'joi-to-swagger';
import { ConfigRouteEntry, RouteSchema } from './types-and-interfaces';
import * as swaggerTypes from './swagger-specification-types';

type RouteSpecType = {
  path: {
    description: string,
    operationId?: string,
    tags?: string[],
    parameters?: Array<swaggerTypes.ParameterObject>,
    requestBody?: swaggerTypes.RequestBody,
    responses?: Record<string, swaggerTypes.ResponseObject>,
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

export const generateRouteSwaggerSpec = (schema: RouteSchema, routeEntry: ConfigRouteEntry, options?: SwaggerGeneratorOptions): RouteSpecType => {
  const { requestBody: requestBodyJoiSchema, query: queryJoiSchema, params: pathParamsJoiSchema, responseBody: responseBodyJoiSchema } = { requestBody: {}, query: {}, params: {}, responseBody: {}, ...schema };
  const { description, swaggerMethodName, tag, path: routePath } = routeEntry;
  const {
    routesBaseUrlPath,
    groupByTag = true,
    includeMethodNameInDescription = true,
  } = options || {};
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
    },
    components: {
      schemas: componentSchemas,
    },
  };
};
