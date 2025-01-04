import {
  RouteArguments,
  RouteModule,
} from './types-and-interfaces';

const handler = async (input: RouteArguments): Promise<any> => {
  if (input.rawEvent!.requestContext.http.method === 'OPTIONS') {
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
