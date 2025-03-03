
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

function pathToRegex(path: string): string {
  // Convert route path to regex pattern
  return path
    .replace(/\//g, '\\/') // Escape forward slashes
    .replace(/{([^}]+)}/g, '(?<$1>[^/]+)'); // Convert {param} to named capture groups
}

export function getRouteConfigByPath(
  eventPath: string,
  configs: ConfigRouteEntry[],
): ConfigRouteEntry & { params?: { [key: string]: string } } {
  const normalizedPath = eventPath.replace(/^\//, ''); // Remove leading slash
  for (const config of configs) {
    const pattern = pathToRegex(config.path);
    const regex = new RegExp(`^${pattern}$`);
    const match = regex.exec(normalizedPath);
    if (match) {
      const params = match.groups || {};
      return { ...config, params };
    }
    if (regex.test(eventPath)) {
      return config;
    }
  }

  throw new CustomError(JSON.stringify({ message: 'path no found' }), 400);
}

export const lambdaRouteProxyEntryHandler = (config: RouteConfig, availableRouteModules: { [key: string]: any }) =>
  async (event: APIGatewayProxyEventV2) => {
    console.log(`Event Data: ${JSON.stringify(event)}`);
    const isProxied = "httpMethod" in event && "requestContext" in event
    if(isProxied) {
      const routeConfig = getRouteConfigByPath(event.requestContext.http.path, config.routes);
      event.routeKey = `${event.requestContext.http.method} ${routeConfig.path}`;
      event.pathParameters = routeConfig.params;
    }

    const {
      routeKey,
      queryStringParameters,
      pathParameters,
      body,
      isBase64Encoded,
    } = event;
    let retVal: any = {};
    try {
      const [method = '', path = ''] = routeKey.split(' ');
      if (shouldAuthorizeRoute(config, getRouteConfigEntry(config, method, path))) {
        await authorizeRoute(event);
      }
      const routeModule = getRouteModule(config, method, path, availableRouteModules);

      console.log(`isBase64Encoded: ${isBase64Encoded}`);
      console.log(`body: ${body}`);
      const decodedBody = isBase64Encoded ? Buffer.from(body!, 'base64').toString('utf-8') : undefined;
      console.log(`decodedBody:
      ${decodedBody}`);


      retVal = await getRouteModuleResult(routeModule, {
        query: queryStringParameters,
        params: pathParameters,
        body: body ? decodedBody || JSON.parse(body) : undefined,
        rawEvent: event,
      });

      if(isProxied) {
        if(retVal.statusCode && !retVal.body) {
          console.log('body must be included when status code is set', retVal);
          throw new CustomError('No body found', 500);
        } else if(retVal.statusCode && retVal.body) {
          retVal = {
            ...retVal,
            isBase64Encoded: false,
            headers: {
              'Content-Type': 'application/json',
              ...retVal.headers??{}
            },
            body: typeof retVal.body === 'object' ? JSON.stringify(retVal.body): retVal.body
          };
        } else {
          retVal = {
            statusCode: 200,
            body: JSON.stringify(retVal),
            'Content-Type': 'application/json',
          }
        }
      }
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
