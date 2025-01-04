import * as joi from 'joi';
import joiToSwagger, { ComponentsSchema } from 'joi-to-swagger';
import { ConfigRouteEntry, RouteSchema } from './types-and-interfaces';
import * as swaggerTypes from './swagger-specification-types';

type RouteSpecType = {
  path: {
    description: string,
    operationId?: string,
    parameters?: Array<swaggerTypes.ParameterObject>,
    requestBody?: swaggerTypes.RequestBody,
    responses?: Record<string, swaggerTypes.ResponseObject>,
  },
  components: {
    schemas: Record<string, ComponentsSchema>,
  },
};

export const generateRouteSwaggerSpec = (schema: RouteSchema, routeEntry: ConfigRouteEntry): RouteSpecType => {
  const { requestBody: requestBodyJoiSchema, query: queryJoiSchema, params: pathParamsJoiSchema, responseBody: responseBodyJoiSchema } = { requestBody: {}, query: {}, params: {}, responseBody: {}, ...schema };
  const { description, swaggerMethodName } = routeEntry;
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

  return {
    path: {
      description,
      operationId: swaggerMethodName || undefined,
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
