import http from 'http';
import { parse } from 'url';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { RouteConfig, RouteModule, RouteArguments, ConfigRouteEntry } from './types-and-interfaces';
import { CustomError } from './custom-error';
import { getRouteModule, getRouteConfigByPath } from './lambda-route-proxy-entry-handler';

export interface DevServerOptions {
  port?: number;
  routeConfig: RouteConfig;
  routeModules: Record<string, RouteModule>;
  corsHeaders?: Record<string, string>;
}

// Default CORS headers
const defaultCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Transform HTTP request to AWS API Gateway v2 event format
function createApiGatewayEvent(req: http.IncomingMessage, body: string): APIGatewayProxyEventV2 {
  const url = parse(req.url || '', true);
  const path = url.pathname || '';

  // Convert IncomingHttpHeaders to APIGatewayProxyEventHeaders
  const apiGatewayHeaders: Record<string, string> = {};
  if (req.headers) {
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        // Convert string[] to string by taking the first value
        const headerValue = Array.isArray(value) ? value[0] : value;
        if (headerValue !== undefined) {
          apiGatewayHeaders[key] = headerValue;
        }
      }
    }
  }

  // Convert query parameters to proper format
  const apiGatewayQuery: Record<string, string | undefined> = {};
  if (url.query) {
    for (const [key, value] of Object.entries(url.query)) {
      if (value !== undefined) {
        // Convert string[] to string by taking the first value
        apiGatewayQuery[key] = Array.isArray(value) ? value[0] : value;
      }
    }
  }

  // Extract path parameters (will be populated by route matching)
  const pathParameters: Record<string, string> = {};

  // API Gateway v2 format
  return {
    version: '2.0',
    routeKey: `${req.method} ${path}`,
    rawPath: path,
    rawQueryString: url.search?.substring(1) || '',
    headers: apiGatewayHeaders,
    queryStringParameters: apiGatewayQuery,
    pathParameters: pathParameters,
    body: body || undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'dev',
      apiId: 'dev',
      domainName: 'localhost',
      domainPrefix: 'dev',
      http: {
        method: req.method || 'GET',
        path: path,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'] || '',
      },
      requestId: Math.random().toString(36).substring(7),
      routeKey: `${req.method} ${path}`,
      stage: 'dev',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  };
}


// Extract path parameters from request path using route configuration
function extractPathParameters(
  path: string,
  method: string,
  routeConfig: RouteConfig,
): Record<string, string> {
  try {
    const routeConfigEntry = getRouteConfigByPath(path, method, routeConfig.routes);
    return routeConfigEntry.params || {};
  } catch (error) {
    // Route not found, return empty params
    return {};
  }
}

export function createDevServer(options: DevServerOptions): http.Server {
  const { port = 3001, routeConfig, routeModules, corsHeaders = defaultCorsHeaders } = options;

  const server = http.createServer(async (req, res) => {
    console.log(`Request: ${req.method} ${req.url}`);

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200, corsHeaders);
      res.end();
      return;
    }

    try {
      // Read request body
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const url = parse(req.url || '', true);
          const path = url.pathname || '';
          const method = req.method || 'GET';

          // Extract path parameters using route configuration (before creating event)
          const pathParams = extractPathParameters(path, method, routeConfig);

          // Create API Gateway event
          const event = createApiGatewayEvent(req, body);
          event.pathParameters = pathParams;

          // Find matching route module
          const routeModule = getRouteModule(routeConfig, method, path, routeModules);

          if (!routeModule) {
            console.log(`Route not found - Method: ${method}, Path: ${path}`);
            res.writeHead(404, {
              ...corsHeaders,
              'Content-Type': 'application/json',
            });
            res.end(
              JSON.stringify({
                success: false,
                error: 'Route not found',
                path: path,
                method: method,
                availableRoutes: routeConfig.routes.map((r) => `${r.method} ${r.path}`),
              }),
            );
            return;
          }

          // Parse body if it's JSON
          let parsedBody: any = body;
          if (body && req.headers['content-type']?.includes('application/json')) {
            try {
              parsedBody = JSON.parse(body);
            } catch (e) {
              // Keep as string if parsing fails
            }
          }

          // Create RouteArguments
          const routeArgs: RouteArguments = {
            params: pathParams,
            query: event.queryStringParameters,
            body: parsedBody,
            rawEvent: event,
            routeData: {
              rawEvent: event,
            },
          };

          // Execute the route chain
          const routeChain = routeModule.routeChain || [];
          if (routeChain.length === 0) {
            res.writeHead(500, {
              ...corsHeaders,
              'Content-Type': 'application/json',
            });
            res.end(
              JSON.stringify({
                success: false,
                error: 'No handler function found in routeChain',
              }),
            );
            return;
          }

          // Execute middleware chain sequentially
          let currentArgs = routeArgs;
          let result;

          for (let i = 0; i < routeChain.length; i++) {
            const middleware = routeChain[i];
            if (!middleware) {
              console.error(`Middleware at index ${i} is undefined`);
              continue;
            }

            result = await middleware(currentArgs);

            // If middleware returns a response (statusCode), stop execution
            if (result && typeof result === 'object' && 'statusCode' in result) {
              break;
            }

            // Otherwise, treat result as updated args for next middleware
            if (result && typeof result === 'object' && !('statusCode' in result)) {
              currentArgs = result;
            }
          }

          // Send response
          const statusCode = result?.statusCode || 200;
          const responseHeaders = {
            ...corsHeaders,
            'Content-Type': 'application/json',
            ...(result?.headers || {}),
          };

          res.writeHead(statusCode, responseHeaders);

          // Ensure response body is a string
          let responseBody: string;
          if (typeof result === 'string') {
            responseBody = result;
          } else if (result && typeof result === 'object' && 'body' in result) {
            responseBody = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
          } else {
            responseBody = JSON.stringify(result);
          }

          res.end(responseBody);
        } catch (error: any) {
          console.error('Error:', error);

          // Check if headers were already sent
          if (!res.headersSent) {
            let statusCode = 500;
            let responseBody: string;

            if (error instanceof CustomError) {
              statusCode = error.httpStatusCode || error._httpStatusCode || 500;
              responseBody = error.message;
            } else if (error && typeof error === 'object') {
              if ('_httpStatusCode' in error) {
                statusCode = error._httpStatusCode;
                responseBody = error._message || error.message || JSON.stringify({ success: false, error: 'Unknown error' });
              } else if ('httpStatusCode' in error) {
                statusCode = error.httpStatusCode;
                responseBody = error.message || JSON.stringify({ success: false, error: 'Unknown error' });
              } else {
                responseBody = JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              }
            } else {
              responseBody = JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }

            res.writeHead(statusCode, {
              ...corsHeaders,
              'Content-Type': 'application/json',
            });
            res.end(responseBody);
          }
        }
      });
    } catch (error: any) {
      console.error('Error:', error);

      if (!res.headersSent) {
        let statusCode = 500;
        let responseBody: string;

        if (error instanceof CustomError) {
          statusCode = error.httpStatusCode || error._httpStatusCode || 500;
          responseBody = error.message;
        } else if (error && typeof error === 'object') {
          if ('_httpStatusCode' in error) {
            statusCode = error._httpStatusCode;
            responseBody = error._message || error.message || JSON.stringify({ success: false, error: 'Unknown error' });
          } else if ('httpStatusCode' in error) {
            statusCode = error.httpStatusCode;
            responseBody = error.message || JSON.stringify({ success: false, error: 'Unknown error' });
          } else {
            responseBody = JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        } else {
          responseBody = JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        res.writeHead(statusCode, {
          ...corsHeaders,
          'Content-Type': 'application/json',
        });
        res.end(responseBody);
      }
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Development server running on http://localhost:${port}`);
    console.log('📡 API endpoints available:');

    // Dynamically list all routes from the route configuration
    routeConfig.routes
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((route) => {
        console.log(`  ${route.method.padEnd(5)} ${route.path}`);
      });
  });

  return server;
}
