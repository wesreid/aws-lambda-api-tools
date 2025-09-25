import { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import { Schema } from 'joi';
import * as swaggerTypes from './swagger-specification-types';

export type ConfigRouteEntry = {
  functionName?: string;
  description: string;
  swaggerMethodName?: string,
  path: string;
  method: 'ANY' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';
  generateOpenApiDocs: boolean,
  handlerPath: string;
  authorizeRoute?: boolean;
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

export type RouteConfig = {
  authorizeAllRoutes?: boolean;
  routes: Array<ConfigRouteEntry>;
  security?: SecurityConfig;
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
  requestBody?: Schema<any> | { [key: string]: Schema<any> };
  responseBody?: Schema<any> | { [key: string]: Schema<any> };
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
