
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { CustomError } from './custom-error';
import { RouteConfig, ConfigRouteEntry, RouteArguments, RouteModule } from './types-and-interfaces';
import { authorizeRoute } from './authorization-helper';

const getRouteConfigEntry = (config: RouteConfig, method: string, path: string) =>
  config.routes.find(r => r.path.toLowerCase() === path.toLowerCase() && r.method.toLowerCase() === method.toLowerCase()) as ConfigRouteEntry;

const shouldAuthorizeRoute = (routesConfig: RouteConfig, routeConfigEntry: ConfigRouteEntry) =>
  (routesConfig.authorizeAllRoutes && routeConfigEntry.authorizeRoute !== false)
  ||
  routeConfigEntry.authorizeRoute === true;


export const getRouteModule = (config: RouteConfig, method: string, path: string, availableRouteModules: { [key: string]: any }): RouteModule => {
  const routeEntry = getRouteConfigEntry(config, method, path);
  let routeModule = null;
  console.log(`route entry: ${JSON.stringify(routeEntry)}`);
  if (routeEntry) {
    const matchingRouteModuleMapKey = Object.keys(availableRouteModules).find((k: string) => routeEntry.handlerPath.endsWith(k));
    // routeModule = availableRouteModules[routeEntry.handlerPath.split('/').reverse()[0]];
    routeModule = availableRouteModules[matchingRouteModuleMapKey!];
  }
  return routeModule;
};

export const getRouteModuleResult = async ({ routeChain }: RouteModule, incoming: RouteArguments): Promise<any> => {
  let returnValue = incoming;
  for (const chainFn of routeChain) {
    returnValue = await chainFn(returnValue);
  }
  return returnValue;
};

export const lambdaRouteProxyEntryHandler = (config: RouteConfig, availableRouteModules: { [key: string]: any }) =>
  async (event: APIGatewayProxyEventV2) => {
    console.log(`Event Data: ${JSON.stringify(event)}`);
    const {
      routeKey,
      queryStringParameters,
      pathParameters,
      body,
    } = event;
    let retVal = {};
    try {
      const [method, path] = routeKey.split(' ');
      if (shouldAuthorizeRoute(config, getRouteConfigEntry(config, method!, path!))) {
        await authorizeRoute(event);
      }
      const routeModule = getRouteModule(config, method!, path!, availableRouteModules);
      retVal = await getRouteModuleResult(routeModule, {
        query: queryStringParameters,
        params: pathParameters,
        body: body ? JSON.parse(body) : undefined,
        rawEvent: event,
      });
    } catch (error: any) {
      console.error(JSON.stringify({ error, stack: error.stack }));
      if (error instanceof CustomError) {
        retVal = {
          statusCode: error.httpStatusCode,
          headers: { 'Content-Type': 'application/json' },
          body: error.message,
        };
      } else {
        retVal = {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: error.message || JSON.stringify(error),
        };
      }
    }
    return retVal;
  };
