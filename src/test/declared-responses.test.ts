/**
 * A route declares every response it can give, by status code, and the OpenAPI
 * document carries each one: success and error, with or without a body.
 *
 * Before this, every operation had exactly one response, `200`, built from
 * `responseBody`. A `201` create, a `204` delete and every error body went
 * undescribed, so a generated client could type none of them.
 */
import * as Joi from 'joi';
import { buildOpenApiDocument } from '../lib/openapi-document-generator';
import { generateRouteSwaggerSpec } from '../lib/swagger-route-specification-generator';
import type { ConfigRouteEntry, RouteConfig, RouteModule } from '../lib/types-and-interfaces';

const ErrorBody = Joi.object({
  error: Joi.object({
    code: Joi.string().required(),
    message: Joi.string().required(),
  }).required(),
}).meta({ className: 'ErrorBody' });

const Order = Joi.object({
  id: Joi.string().required(),
  status: Joi.string().valid('working', 'filled').required(),
  limitPrice: Joi.number().allow(null).required(),
}).meta({ className: 'Order' });

const PlaceOrderRequest = Joi.object({
  symbol: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
})
  .required()
  .meta({ className: 'PlaceOrderRequest' });

const MODULES: Record<string, RouteModule> = {
  'src/routes/orders/place-order': {
    routeSchema: {
      requestBody: PlaceOrderRequest,
      responses: {
        '201': { description: 'The order was placed', body: Order },
        '400': { description: 'The request is invalid', body: ErrorBody },
        '404': { description: 'The account does not exist', body: ErrorBody },
      },
    },
    routeChain: [async () => ({})],
  },
  'src/routes/orders/cancel-order': {
    routeSchema: {
      params: { orderId: Joi.string().required() },
      responses: {
        '204': { description: 'The order was cancelled' },
        '409': { description: 'The order has already filled', body: ErrorBody },
      },
    },
    routeChain: [async () => ({})],
  },
  'src/routes/orders/list-orders': {
    routeSchema: {
      query: { symbol: Joi.string().optional() },
      responses: {
        '200': { description: 'The account\'s orders', body: Joi.array().items(Order).meta({ className: 'OrderList' }) },
      },
    },
    routeChain: [async () => ({})],
  },
};

function route(entry: Pick<ConfigRouteEntry, 'method' | 'path' | 'handlerPath' | 'swaggerMethodName'>): ConfigRouteEntry {
  return { description: `${entry.method} ${entry.path}`, generateOpenApiDocs: true, ...entry };
}

const CONFIG: RouteConfig = {
  routesBaseUrlPath: '/api/v1',
  routes: [
    route({ method: 'POST', path: '/api/v1/orders', handlerPath: 'src/routes/orders/place-order', swaggerMethodName: 'placeOrder' }),
    route({ method: 'DELETE', path: '/api/v1/orders/{orderId}', handlerPath: 'src/routes/orders/cancel-order', swaggerMethodName: 'cancelOrder' }),
    route({ method: 'GET', path: '/api/v1/orders', handlerPath: 'src/routes/orders/list-orders', swaggerMethodName: 'listOrders' }),
  ],
};

const loadModule = (handlerPath: string): RouteModule => {
  const mod = MODULES[handlerPath];
  if (!mod) throw new Error(`fixture has no module ${handlerPath}`);
  return mod;
};

const ENTRY = route({ method: 'POST', path: '/api/v1/things', handlerPath: 'src/routes/things/post-thing', swaggerMethodName: 'postThing' });

describe('declared responses', () => {
  it('emits every declared status, success and error, each with its own description and body', () => {
    const doc = buildOpenApiDocument(CONFIG, loadModule);
    const place = doc.paths['/api/v1/orders']!.post!;

    expect(Object.keys(place.responses!)).toEqual(['201', '400', '404']);
    expect(place.responses!['201']).toEqual({
      description: 'The order was placed',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
    });
    expect(place.responses!['400']).toEqual({
      description: 'The request is invalid',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
    });
    expect(place.responses!['404']!.description).toBe('The account does not exist');
  });

  it('emits a response with no body as a description alone', () => {
    const doc = buildOpenApiDocument(CONFIG, loadModule);
    const cancel = doc.paths['/api/v1/orders/{orderId}']!.delete!;

    expect(cancel.responses!['204']).toEqual({ description: 'The order was cancelled' });
    expect(Object.keys(cancel.responses!)).toEqual(['204', '409']);
  });

  it('collects the named schemas of every response into components', () => {
    const doc = buildOpenApiDocument(CONFIG, loadModule);
    const schemas = doc.components.schemas!;

    expect(Object.keys(schemas).sort()).toEqual(['ErrorBody', 'Order', 'OrderList', 'PlaceOrderRequest']);
    expect(schemas.Order).toMatchObject({
      type: 'object',
      required: ['id', 'status', 'limitPrice'],
      properties: { status: { type: 'string', enum: ['working', 'filled'] } },
    });
    expect(schemas.OrderList).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Order' } });
  });

  it('defines a named schema nested in an unnamed body, so its $ref resolves', () => {
    const Leg = Joi.object({ price: Joi.number().required() }).meta({ className: 'Leg' });
    const { path, components } = generateRouteSwaggerSpec(
      {
        requestBody: Joi.object({ legs: Joi.array().items(Leg).required() }),
        responses: { '200': { description: 'ok', body: Joi.object({ first: Leg.required() }) } },
      },
      ENTRY,
    );

    expect((path.requestBody!.content!['application/json']!.schema as any).properties.legs.items).toEqual({
      $ref: '#/components/schemas/Leg',
    });
    expect((path.responses!['200']!.content!['application/json']!.schema as any).properties.first).toEqual({
      $ref: '#/components/schemas/Leg',
    });
    expect(Object.keys(components.schemas)).toEqual(['Leg']);
  });

  it('marks a request body required when its schema is required', () => {
    const doc = buildOpenApiDocument(CONFIG, loadModule);
    const place = doc.paths['/api/v1/orders']!.post!;

    expect(place.requestBody).toMatchObject({
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/PlaceOrderRequest' } } },
    });
  });

  it('leaves a request body optional when its schema does not say required', () => {
    const { path } = generateRouteSwaggerSpec({ requestBody: Joi.object({ name: Joi.string() }) }, ENTRY);
    expect(path.requestBody).not.toHaveProperty('required');
  });

  it('writes every declared response in 3.1 dialect when asked', () => {
    const nullableModules: Record<string, RouteModule> = {
      'src/routes/things/post-thing': {
        routeSchema: {
          responses: {
            '200': { description: 'ok', body: Joi.object({ at: Joi.string().allow(null).required() }) },
            '422': { description: 'unprocessable', body: Joi.object({ reason: Joi.string().allow(null).required() }) },
          },
        },
        routeChain: [async () => ({})],
      },
    };
    const doc = buildOpenApiDocument({ routes: [ENTRY] }, (p) => nullableModules[p]!, { openApiVersion: '3.1' });
    const responses = doc.paths['/api/v1/things']!.post!.responses!;

    expect((responses['200']!.content!['application/json']!.schema as any).properties.at.type).toEqual(['string', 'null']);
    expect((responses['422']!.content!['application/json']!.schema as any).properties.reason.type).toEqual(['string', 'null']);
  });

  it('refuses a route that declares both responses and responseBody, naming the route', () => {
    expect(() =>
      generateRouteSwaggerSpec(
        {
          responseBody: Joi.object({ id: Joi.string() }),
          responses: { '200': { description: 'ok', body: Joi.object({ id: Joi.string() }) } },
        },
        ENTRY,
      ),
    ).toThrow('POST /api/v1/things: declare responses or responseBody, not both');
  });

  it.each(['20', '600', 'ok', '2xx'])('refuses the status key %s, naming the route', (status) => {
    expect(() => generateRouteSwaggerSpec({ responses: { [status]: { description: 'x' } } }, ENTRY)).toThrow(
      `POST /api/v1/things: response status "${status}" is not an HTTP status code (100-599) or "default"`,
    );
  });

  it('refuses a declared response without a description, naming the route and status', () => {
    expect(() => generateRouteSwaggerSpec({ responses: { '200': { description: '' } } }, ENTRY)).toThrow(
      'POST /api/v1/things: response 200 needs a description',
    );
  });

  it('accepts the default response', () => {
    const { path } = generateRouteSwaggerSpec(
      { responses: { '200': { description: 'ok' }, default: { description: 'Any other failure', body: ErrorBody } } },
      ENTRY,
    );
    expect(Object.keys(path.responses!)).toEqual(['200', 'default']);
  });

  describe('a route that declares no responses is unchanged', () => {
    it('emits its responseBody as the 200 response', () => {
      const { path } = generateRouteSwaggerSpec({ responseBody: Joi.object({ id: Joi.string() }) }, ENTRY);
      expect(path.responses).toEqual({
        '200': {
          description: 'Default response body',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
            },
          },
        },
      });
    });

    it('emits the default 200 when it declares no response at all', () => {
      const { path } = generateRouteSwaggerSpec({}, ENTRY);
      expect(path.responses).toEqual({ '200': { description: 'Default response' } });
    });
  });
});
