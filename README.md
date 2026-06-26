# AWS Lambda API Tools

A production-proven toolkit for building structured, type-safe REST APIs on AWS Lambda + API Gateway. Define routes declaratively, get automatic OpenAPI documentation, built-in validation, security, and — new in v0.1.39 — **async binding metadata** that tells AI agents and tooling which API calls have corresponding WebSocket completion events.

## Why This Package

Building APIs on Lambda often means reinventing routing, validation, documentation, and security for every project. This package provides a batteries-included framework that:

- Turns a single Lambda function into a full REST API with path-based routing
- Generates OpenAPI/Swagger specs automatically from your Joi schemas
- Handles JWT validation, CORS, security headers, and request validation as middleware
- Runs locally with a built-in dev server (no SAM/Serverless Framework needed for iteration)
- Declares async WebSocket bindings alongside REST routes for event-driven architectures
- Sets up GitHub Actions OIDC IAM with a single command

Battle-tested in enterprise environments handling millions of requests across multiple production applications.

## Features

- **Declarative Route Configuration** — Define routes as data, not code. Method, path, handler, docs, auth, and async bindings in one object.
- **Automatic OpenAPI Generation** — Joi request/response schemas convert to OpenAPI 3.0 specs. Run `generate-oas` and get a complete API spec.
- **Route-Module Codegen** — Generate (and CI-verify) the static handler map from your route config with `generate-route-modules`. No more silent 404s from a forgotten registration.
- **Async Binding Metadata** — Declare which WebSocket events correspond to each route's async results. Emitted as `x-async-binding` OpenAPI extensions for AI agents, SDK codegen, and documentation.
- **Middleware Chain** — Composable, type-safe middleware. JWT validation, schema validation, response headers — stack them per-route.
- **Schema Validation** — Joi-based request/response validation with automatic 400 error responses.
- **JWT Authentication** — Built-in JWT validation middleware with token rotation support.
- **Security Configuration** — CORS (exact, regex, pattern-based origins), security headers, credential handling — all from a JSON config file.
- **Response Header Helpers** — Rate limiting, cache control, security headers, auth headers — add from any middleware.
- **Local Dev Server** — `createDevServer()` runs your Lambda routes as a local HTTP server. No deploy needed during development.
- **GitHub Actions IAM** — One command to create OIDC IAM roles for secure CI/CD deployments.
- **TypeScript First** — Full type safety across route configs, handlers, middleware, and schemas.

## Installation

```bash
npm install aws-lambda-api-tools
```

## Quick Start

### 1. Define Route Configuration

```typescript
// routes-config.ts
import { ConfigRouteEntry, RouteConfig } from 'aws-lambda-api-tools';

const routes: ConfigRouteEntry[] = [
  {
    description: 'Create a new user',
    swaggerMethodName: 'createUser',
    method: 'POST',
    path: '/api/v1/users',
    handlerPath: 'src/routes/users/create-user',
    generateOpenApiDocs: true,
    authorizeRoute: true,
  },
  {
    description: 'Get user by ID',
    swaggerMethodName: 'getUser',
    method: 'GET',
    path: '/api/v1/users/{userId}',
    handlerPath: 'src/routes/users/get-user',
    generateOpenApiDocs: true,
    authorizeRoute: true,
  },
  {
    description: 'Generate a report (async)',
    swaggerMethodName: 'generateReport',
    method: 'POST',
    path: '/api/v1/reports',
    handlerPath: 'src/routes/reports/generate-report',
    generateOpenApiDocs: true,
    authorizeRoute: true,
    asyncBinding: {
      event: 'report:completed',
      room: 'user:{userId}',
      description: 'Fires when the report generation completes',
      lifecycleEvents: [
        { event: 'report:progress', description: 'Progress percentage update' },
        { event: 'report:failed', description: 'Report generation failed' },
      ],
    },
  },
];

export const routeConfig: RouteConfig = {
  authorizeAllRoutes: false,
  routes,
  routesBaseUrlPath: '/api/v1',
};
```

### 2. Create Route Handlers

```typescript
// src/routes/users/create-user.ts
import Joi from 'joi';
import {
  RouteModule,
  RouteSchema,
  RouteArguments,
  jwtValidationMiddleware,
  schemaValidationMiddleware,
} from 'aws-lambda-api-tools';

const routeSchema: RouteSchema = {
  requestBody: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().min(1).max(100).required(),
  }),
  responseBody: Joi.object({
    id: Joi.string().required(),
    email: Joi.string().required(),
    name: Joi.string().required(),
    createdAt: Joi.string().isoDate().required(),
  }),
};

const handler = async (args: RouteArguments) => {
  const { email, name } = args.body;
  const user = await createUser({ email, name });
  return { statusCode: 201, body: user };
};

export default {
  routeChain: [jwtValidationMiddleware, schemaValidationMiddleware(routeSchema), handler],
  routeSchema,
} as RouteModule;
```

### 3. Register Route Modules

Because the Lambda is esbuild-bundled, handlers must be **statically imported** — a
dynamic `require(handlerPath)` can't be bundled. So a `route-modules.ts` maps each
route's `handlerPath` to its imported module:

```typescript
// route-modules.ts
import { RouteModule } from 'aws-lambda-api-tools';
import createUser from './routes/users/create-user';
import getUser from './routes/users/get-user';
import generateReport from './routes/reports/generate-report';

export const routeModules: Record<string, RouteModule> = {
  'src/routes/users/create-user': createUser,
  'src/routes/users/get-user': getUser,
  'src/routes/reports/generate-report': generateReport,
};
```

**Don't hand-maintain this.** A route that's in the config but missing from this map
is a silent 404 at runtime. Generate it from your route config instead:

```bash
npx aws-lambda-api-tools generate-route-modules
```

See [Generate Route Modules](#generate-route-modules) below for wiring it into your
build + CI.

### 4. Lambda Entry Point

```typescript
// index.ts
import { lambdaRouteProxyEntryHandler } from 'aws-lambda-api-tools';
import { routeConfig } from './routes-config';
import { routeModules } from './route-modules';

export const handler = lambdaRouteProxyEntryHandler(routeConfig, routeModules);
```

That's it. One Lambda function serves your entire API with routing, validation, auth, and documentation.

---

## Async Binding Metadata

Modern APIs often trigger asynchronous work — image generation, report compilation, video processing — where the HTTP response acknowledges the request, but the actual result arrives later via WebSocket or Server-Sent Events.

The `asyncBinding` field on `ConfigRouteEntry` declares this relationship at the source:

```typescript
{
  description: 'Generate a video clip',
  swaggerMethodName: 'generateClip',
  method: 'POST',
  path: '/api/v1/clips/generate',
  handlerPath: 'src/routes/clips/generate-clip',
  generateOpenApiDocs: true,
  asyncBinding: {
    event: 'generation:completed',
    room: 'generation:{jobId}',
    description: 'Fires when the video clip generation pipeline completes',
    lifecycleEvents: [
      { event: 'generation:progress', description: 'Progress update with phase info' },
      { event: 'generation:queued', description: 'Job queued waiting for capacity' },
      { event: 'generation:failed', description: 'Generation failed with error details' },
    ],
  },
}
```

### What This Produces

When you run `generate-oas`, the OpenAPI spec for this operation includes:

```yaml
/api/v1/clips/generate:
  post:
    operationId: generateClip
    description: Generate a video clip
    x-async-binding:
      event: "generation:completed"
      room: "generation:{jobId}"
      description: "Fires when the video clip generation pipeline completes"
      lifecycleEvents:
        - event: "generation:progress"
          description: "Progress update with phase info"
        - event: "generation:queued"
          description: "Job queued waiting for capacity"
        - event: "generation:failed"
          description: "Generation failed with error details"
```

### Who Consumes This

- **AI Agents** — An agent calling `generateClip()` knows to subscribe to `generation:{jobId}` and wait for `generation:completed` before continuing its workflow.
- **API Client Codegen** — Downstream tools can generate subscribe/unsubscribe helpers alongside REST methods.
- **Documentation** — API docs can show developers which WebSocket events to listen for after calling an async endpoint.
- **Monitoring** — Observability tools can correlate HTTP requests with their eventual async completions.

### AsyncBindingConfig Reference

```typescript
type AsyncBindingConfig = {
  /** WebSocket event name emitted on async completion */
  event: string;
  /** Room/channel pattern for subscription (e.g., 'generation:{jobId}', 'user:{userId}') */
  room: string;
  /** Additional lifecycle events beyond completion */
  lifecycleEvents?: Array<{
    event: string;
    description?: string;
  }>;
  /** Description of when the completion event fires */
  description?: string;
  /** Joi schema for the completion event payload */
  payload?: Schema;
};
```

---

## Route Configuration Reference

```typescript
type ConfigRouteEntry = {
  /** Human-readable description (used in OpenAPI) */
  description: string;
  /** Operation ID / API client method name (e.g., 'createUser') */
  swaggerMethodName?: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';
  /** Route path with {param} placeholders */
  path: string;
  /** Path to the handler module (must match key in routeModules) */
  handlerPath: string;
  /** Whether to include in generated OpenAPI docs */
  generateOpenApiDocs: boolean;
  /** Override auth for this route (true = require, false = skip) */
  authorizeRoute?: boolean;
  /** OpenAPI tag for grouping (auto-derived from path if not set) */
  tag?: string;
  /** Lambda function name override */
  functionName?: string;
  /** Async WebSocket binding metadata */
  asyncBinding?: AsyncBindingConfig;
};

type RouteConfig = {
  /** Apply auth to all routes by default */
  authorizeAllRoutes?: boolean;
  /** All route entries */
  routes: ConfigRouteEntry[];
  /** Base URL path for tag derivation (e.g., '/api/v1') */
  routesBaseUrlPath?: string;
  /** Security configuration */
  security?: SecurityConfig;
};
```

---

## Middleware

### Built-in Middleware

#### JWT Validation

```typescript
import { jwtValidationMiddleware } from 'aws-lambda-api-tools';

export default {
  routeChain: [jwtValidationMiddleware, handler],
  routeSchema,
} as RouteModule;
```

Validates the `Authorization: Bearer <token>` header. Decoded claims are available on `args.routeData`.

#### Schema Validation

```typescript
import { schemaValidationMiddleware } from 'aws-lambda-api-tools';

const routeSchema: RouteSchema = {
  params: { userId: Joi.string().uuid().required() },
  query: { include: Joi.string().valid('posts', 'comments') },
  requestBody: Joi.object({ name: Joi.string().required() }),
  responseBody: Joi.object({ id: Joi.string(), name: Joi.string() }),
};

export default {
  routeChain: [schemaValidationMiddleware(routeSchema), handler],
  routeSchema,
} as RouteModule;
```

### Response Header Helpers

Add headers from any middleware in the chain:

```typescript
import {
  addResponseHeader,
  addRateLimitHeaders,
  addCacheHeaders,
  addSecurityHeaders,
} from 'aws-lambda-api-tools';

const rateLimitMiddleware = (args: RouteArguments) => {
  return addRateLimitHeaders(args, 100, 95, Date.now() + 3600000);
};

const cacheMiddleware = (args: RouteArguments) => {
  return addCacheHeaders(args, 300, { public: true, mustRevalidate: true });
};
```

---

## Security Configuration

Create an `api-security.json` in your project root:

```json
{
  "cors": {
    "allowOrigin": ["https://myapp.com", "https://staging.myapp.com"],
    "allowOriginPatterns": ["^https://[a-zA-Z0-9-]+\\.preview\\.myapp\\.com$"],
    "allowMethods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allowHeaders": ["Content-Type", "Authorization"],
    "allowCredentials": true,
    "maxAge": 86400
  },
  "defaultHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block"
  },
  "jwtRotationHeaders": {
    "enabled": true,
    "rotationRequiredHeader": "X-Token-Rotation-Required",
    "rotationReasonHeader": "X-Token-Rotation-Reason"
  }
}
```

Supports exact string origins, regex patterns (as strings for JSON compatibility), and wildcard. Validates configuration on load and warns about insecure patterns.

---

## Local Development Server

Run your Lambda routes locally without deploying:

```typescript
import { createDevServer } from 'aws-lambda-api-tools';
import { routeConfig } from './routes-config';
import { routeModules } from './route-modules';

createDevServer({
  port: 3000,
  routeConfig,
  routeModules,
});
```

```bash
# Or as a script in package.json
node -r ts-node/register dev-server.ts
```

The dev server simulates API Gateway v2 events, handles CORS preflight, and provides the same routing behavior as production.

---

## CLI Tools

### Generate OpenAPI Spec

```bash
npx generate-oas
```

Reads your route configs and handler schemas, produces an OpenAPI 3.0 JSON spec including `x-async-binding` extensions.

### Generate Route Modules

Generates the static `route-modules.ts` map from your `*_routes-config` files (the
single source of truth), so the esbuild-bundled handler map can never drift from
your route config. A missing entry would otherwise be a silent production 404.

```bash
# Write/refresh the map
npx aws-lambda-api-tools generate-route-modules

# Verify it's up to date (CI / pre-commit) — exits non-zero if stale,
# and reports routes declared-but-unregistered (404s) or dead entries.
npx aws-lambda-api-tools generate-route-modules --check
```

Options:

| Flag | Default | Description |
|---|---|---|
| `--routes-dir <dir>` | `src/routes` | Directory scanned recursively for `*_routes-config*` files |
| `--out <path>` | `src/route-modules.ts` | Output file |
| `--type-import <module>` | `aws-lambda-api-tools` | Module the `RouteModule` type is imported from |
| `--check` | `false` | Verify only; exit non-zero if stale |

It scans config files for `handlerPath` declarations (no TypeScript execution
required), so it's safe to run as a pre-build / pre-commit step. Recommended wiring:

```jsonc
// package.json
{
  "scripts": {
    "routes:gen": "aws-lambda-api-tools generate-route-modules",
    "prebuild": "npm run routes:gen",
    "predev": "npm run routes:gen"
  }
}
```

Add `aws-lambda-api-tools generate-route-modules --check` to CI / your pre-commit
hook to fail fast if the map ever drifts.

A programmatic API is also exported: `generateRouteModules`, `checkRouteModules`,
`collectHandlerPaths`, `renderRouteModules`, and `handlerPathToIdentifier`.

### GitHub Actions IAM Setup

Create OIDC IAM roles for secure CI/CD (no long-lived credentials):

```bash
# Single repo
npx aws-lambda-api-tools create-gha-iam-stack --repo=myorg/my-service

# Multiple repos
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/service-a \
  --repo=myorg/service-b

# Custom policy
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/my-service \
  --policy=AWSLambda_FullAccess

# Manage repos
npx aws-lambda-api-tools create-gha-iam-stack --mode=list
npx aws-lambda-api-tools create-gha-iam-stack --remove-repo=myorg/old-service
```

---

## Error Handling

```typescript
import { CustomError } from 'aws-lambda-api-tools';

// Throws a structured error with HTTP status code
throw new CustomError('User not found', 404);
throw new CustomError('Insufficient permissions', 403);
```

---

## Agent-Ready APIs

When you declare `asyncBinding` on your routes, your API becomes **agent-ready** — AI agents can programmatically understand which endpoints trigger async work and how to subscribe for results.

This is the foundation for building AI assistants that can orchestrate complex workflows across your API:

1. Agent calls `POST /clips/generate` → gets `{ jobId: "abc123" }`
2. Agent reads `x-async-binding` from the spec → knows to subscribe to room `generation:abc123`
3. Agent listens for `generation:progress`, `generation:completed`, or `generation:failed`
4. Agent continues its workflow when the async result arrives

No manual binding configuration needed. The API spec IS the contract.

*Closure Agent SDK integration coming Summer 2026.*

---

## Roadmap

- **Zod schema support** — Use Zod as an alternative to Joi for request/response validation and OpenAPI generation
- **AsyncAPI spec generation** — Generate AsyncAPI documents from `asyncBinding` metadata alongside OpenAPI
- **WebSocket route support** — First-class WebSocket route handlers with the same middleware pattern
- **Rate limiting middleware** — Built-in token bucket / sliding window rate limiting
- **OpenTelemetry integration** — Automatic tracing spans per route handler

---

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a PR.

## License

MIT
