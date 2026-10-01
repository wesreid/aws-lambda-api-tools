/**
 * The OpenAPI document carries standard `security`, derived from what each route's
 * middleware declares, and passes a route's `x-` extensions through untouched.
 *
 * The library knows no product's schemes or permissions: a product declares them on
 * its own middleware (`declareSecurity`) and its own route config (`openApi.securitySchemes`).
 */
import * as Joi from 'joi';
import { buildOpenApiDocument } from '../lib/openapi-document-generator';
import { declareSecurity, securityOfChain } from '../lib/openapi-security';
import type { ConfigRouteEntry, RouteArguments, RouteConfig, RouteModule } from '../lib/types-and-interfaces';

// ---------------------------------------------------------------------------
// A fixture product: its own schemes, its own auth and permission middleware.
// ---------------------------------------------------------------------------

const SECURITY_SCHEMES = {
  userToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  agentAssertion: { type: 'apiKey', in: 'header', name: 'x-agent-assertion' },
} as const;

const calls: string[] = [];

const requireUserOrKey = declareSecurity(
  async (args: RouteArguments) => {
    calls.push('auth');
    return args;
  },
  { authenticates: ['userToken', 'apiKey', 'agentAssertion'] },
);

function requirePermission(...permissions: string[]) {
  return declareSecurity(
    async (args: RouteArguments) => {
      calls.push(`permission:${permissions.join(',')}`);
      return args;
    },
    { requires: permissions },
  );
}

const undeclaredLogging = async (args: RouteArguments) => args;

const MODULES: Record<string, RouteModule> = {
  'src/routes/orders/list-orders': {
    routeSchema: { query: { symbol: Joi.string().optional() } },
    routeChain: [requireUserOrKey, requirePermission('orders:read'), undeclaredLogging],
  },
  'src/routes/orders/place-order': {
    routeSchema: {
      requestBody: Joi.object({ symbol: Joi.string().required(), quantity: Joi.number().integer().min(1).required() }),
    },
    routeChain: [requireUserOrKey, requirePermission('orders:write', 'trading:enabled')],
  },
  'src/routes/health/get-health': {
    routeSchema: {},
    routeChain: [undeclaredLogging],
  },
  'src/routes/renders/start-render': {
    routeSchema: { requestBody: Joi.object({ projectId: Joi.string().required() }) },
    routeChain: [requireUserOrKey, requirePermission('renders:create')],
  },
};

const X_AGENT_PLACE_ORDER = {
  expose: true,
  effect: 'transaction',
  consequence: 'Places a live order with the broker.',
  nested: { list: [1, 'two', { three: null }] },
};

function route(entry: Partial<ConfigRouteEntry> & Pick<ConfigRouteEntry, 'method' | 'path' | 'handlerPath'>): ConfigRouteEntry {
  return { description: `${entry.method} ${entry.path}`, generateOpenApiDocs: true, ...entry };
}

function fixtureConfig(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    routesBaseUrlPath: '/api/v1',
    openApi: { securitySchemes: SECURITY_SCHEMES },
    routes: [
      route({
        method: 'GET',
        path: '/api/v1/orders',
        handlerPath: 'src/routes/orders/list-orders',
        swaggerMethodName: 'listOrders',
        extensions: { 'x-agent': { expose: true, effect: 'view', pa: true } },
      }),
      route({
        method: 'POST',
        path: '/api/v1/orders',
        handlerPath: 'src/routes/orders/place-order',
        swaggerMethodName: 'placeOrder',
        extensions: { 'x-agent': X_AGENT_PLACE_ORDER },
      }),
      route({
        method: 'GET',
        path: '/api/v1/health',
        handlerPath: 'src/routes/health/get-health',
        swaggerMethodName: 'getHealth',
      }),
      route({
        method: 'POST',
        path: '/api/v1/renders',
        handlerPath: 'src/routes/renders/start-render',
        swaggerMethodName: 'startRender',
        asyncBinding: { event: 'render:completed', room: 'render:{renderId}' },
        extensions: { 'x-agent': { expose: true, effect: 'job' } },
      }),
      route({
        method: 'GET',
        path: '/api/v1/internal',
        handlerPath: 'src/routes/orders/list-orders',
        generateOpenApiDocs: false,
      }),
    ],
    ...overrides,
  };
}

const loadModule = (handlerPath: string): RouteModule => {
  const mod = MODULES[handlerPath];
  if (!mod) throw new Error(`fixture has no module ${handlerPath}`);
  return mod;
};

describe('buildOpenApiDocument — standard security and extension pass-through', () => {
  it('produces a complete document: every documented route, its security from its chain, its extensions untouched', () => {
    const doc = buildOpenApiDocument(fixtureConfig(), loadModule);

    // Every documented route, and only those.
    expect(Object.keys(doc.paths).sort()).toEqual(['/api/v1/health', '/api/v1/orders', '/api/v1/renders']);
    expect(Object.keys(doc.paths['/api/v1/orders']!).sort()).toEqual(['get', 'post']);

    const list = doc.paths['/api/v1/orders']!.get!;
    const place = doc.paths['/api/v1/orders']!.post!;
    const health = doc.paths['/api/v1/health']!.get!;
    const render = doc.paths['/api/v1/renders']!.post!;

    // operationIds and inputs are still there.
    expect(list.operationId).toBe('listOrders');
    expect(list.parameters).toEqual([expect.objectContaining({ name: 'symbol', in: 'query', required: false })]);
    expect(place.operationId).toBe('placeOrder');
    expect(place.requestBody?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      required: ['symbol', 'quantity'],
    });

    // Security: any one of the declared schemes, each requiring the declared permissions.
    expect(list.security).toEqual([
      { userToken: ['orders:read'] },
      { apiKey: ['orders:read'] },
      { agentAssertion: ['orders:read'] },
    ]);
    expect(place.security).toEqual([
      { userToken: ['orders:write', 'trading:enabled'] },
      { apiKey: ['orders:write', 'trading:enabled'] },
      { agentAssertion: ['orders:write', 'trading:enabled'] },
    ]);
    // A chain that declares nothing says nothing: the document never guesses.
    expect(health).not.toHaveProperty('security');

    // The schemes the product declared.
    expect(doc.components.securitySchemes).toEqual(SECURITY_SCHEMES);

    // Extensions reach the operation exactly as declared.
    expect(list['x-agent']).toEqual({ expose: true, effect: 'view', pa: true });
    expect(place['x-agent']).toEqual(X_AGENT_PLACE_ORDER);
    expect(health).not.toHaveProperty('x-agent');

    // The async binding is still emitted, next to a pass-through extension.
    expect(render['x-async-binding']).toEqual({ event: 'render:completed', room: 'render:{renderId}' });
    expect(render['x-agent']).toEqual({ expose: true, effect: 'job' });
    expect(render.security).toEqual([
      { userToken: ['renders:create'] },
      { apiKey: ['renders:create'] },
      { agentAssertion: ['renders:create'] },
    ]);

    // The document is plain data: it survives JSON unchanged.
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('keeps a declared middleware working exactly as before', async () => {
    calls.length = 0;
    const chain = MODULES['src/routes/orders/place-order']!.routeChain;
    let args: RouteArguments = { body: { symbol: 'X', quantity: 1 } };
    for (const step of chain) args = await step(args);
    expect(calls).toEqual(['auth', 'permission:orders:write,trading:enabled']);
    expect(args.body).toEqual({ symbol: 'X', quantity: 1 });
  });

  it('emits no securitySchemes when the product declares none, and no security when no route declares any', () => {
    const doc = buildOpenApiDocument(
      fixtureConfig({
        openApi: undefined,
        routes: [route({ method: 'GET', path: '/api/v1/health', handlerPath: 'src/routes/health/get-health' })],
      }),
      loadModule,
    );
    expect(doc.components).not.toHaveProperty('securitySchemes');
    expect(doc.paths['/api/v1/health']!.get).not.toHaveProperty('security');
  });

  it('refuses a route whose chain names a scheme the product did not declare', () => {
    expect(() =>
      buildOpenApiDocument(fixtureConfig({ openApi: { securitySchemes: { userToken: SECURITY_SCHEMES.userToken } } }), loadModule),
    ).toThrow(/GET \/api\/v1\/orders.*"apiKey".*securitySchemes/);
  });

  it('refuses required permissions on a route that declares no authentication', () => {
    const chain = [requirePermission('orders:read')];
    expect(() => securityOfChain(chain, 'GET /api/v1/orders')).toThrow(
      /GET \/api\/v1\/orders requires orders:read but no middleware in its chain declares how it authenticates/,
    );
  });

  it('requires every authentication step in series: the alternatives multiply', () => {
    const mfa = declareSecurity(async (a: RouteArguments) => a, { authenticates: ['otp'] });
    expect(securityOfChain([requireUserOrKey, mfa, requirePermission('p')], 'POST /x')).toEqual([
      { userToken: ['p'], otp: ['p'] },
      { apiKey: ['p'], otp: ['p'] },
      { agentAssertion: ['p'], otp: ['p'] },
    ]);
  });

  it('refuses an extension key that is not an x- extension, and one the library owns', () => {
    const bad = fixtureConfig();
    bad.routes[0] = { ...bad.routes[0]!, extensions: { agent: { expose: true } } as never };
    expect(() => buildOpenApiDocument(bad, loadModule)).toThrow(/GET \/api\/v1\/orders.*"agent".*x-/);

    const owned = fixtureConfig();
    owned.routes[0] = { ...owned.routes[0]!, extensions: { 'x-async-binding': {} } };
    expect(() => buildOpenApiDocument(owned, loadModule)).toThrow(/x-async-binding.*asyncBinding/);
  });

  it('refuses a malformed declaration', () => {
    expect(() => declareSecurity(async (a: RouteArguments) => a, { authenticates: [] })).toThrow(/at least one scheme/);
    expect(() => declareSecurity(async (a: RouteArguments) => a, { requires: [''] })).toThrow(/non-empty/);
    expect(() =>
      declareSecurity(async (a: RouteArguments) => a, { authenticates: ['a'], requires: ['b'] } as never),
    ).toThrow(/either `authenticates` or `requires`/);
  });
});
