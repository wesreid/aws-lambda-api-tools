import {
  RouteArguments,
  RouteModule,
} from './types-and-interfaces';

const handler = async (input: RouteArguments): Promise<any> => {
  console.log('--- NOT FOUND HANDLER ---');
  console.log(input.rawEvent!.requestContext.http.method);
  if (input.rawEvent!.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200, 
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': 300,
        'Access-Control-Expose-Headers': 'Access-Control-Allow-Origin',
        'Access-Control-Allow-Credentials': true,
        'Content-Type': 'application/json',
      },
    };
  }
  return { statusCode: 404, body: JSON.stringify('Not found') };
};

export const lambdaRouteProxyPathNotFound: RouteModule = {
  routeChain: [handler],
  routeSchema: {},
};
