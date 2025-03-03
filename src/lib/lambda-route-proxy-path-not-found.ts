import { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  RouteArguments,
  RouteModule,
} from './types-and-interfaces';

const handler = async (input: RouteArguments): Promise<any> => {
  const v1Method = (input.rawEvent as APIGatewayProxyEvent).requestContext.httpMethod;
  const v2Method = (input.rawEvent as APIGatewayProxyEventV2).requestContext.http.method;
  if (v1Method === 'OPTIONS' || v2Method === 'OPTIONS') {
    return {
      statusCode: 200, 
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': 300,
      }
    };
  }
  return { statusCode: 404, body: JSON.stringify('Not found') };
};

export const lambdaRouteProxyPathNotFound: RouteModule = {
  routeChain: [handler],
  routeSchema: {},
};
