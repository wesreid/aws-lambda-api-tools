# AWS Lambda API Tools

A powerful toolkit for building enterprise-grade REST APIs with AWS Lambda and API Gateway (HTTP API). This package provides a structured approach to routing, middleware management, schema validation, and JWT authentication, with full TypeScript support.

## Key Features

- 🛣️ **Structured Routing** - Define routes with complete type safety and automatic OpenAPI documentation generation
- 🔒 **JWT Authentication** - Built-in JWT validation middleware
- ✅ **Schema Validation** - Request/response validation using Joi
- 🚦 **Middleware Chain** - Flexible middleware system with type-safe middleware composition
- 📝 **OpenAPI/Swagger** - Automatic API documentation generation
- 🔍 **Type Safety** - Comprehensive TypeScript support
- 🎯 **Path Parameters** - Support for dynamic route parameters
- ⚡ **Performance** - Optimized for AWS Lambda execution

## Installation

```shell
npm install aws-lambda-api-tools
```

## Quick Start

### 1. Define Your Route Handlers

```typescript
// handlers/users/create-user.ts
import {
  RouteModule,
  RouteSchema,
  jwtValidationMiddleware,
  schemaValidationMiddleware,
} from 'aws-lambda-api-tools';

const routeSchema: RouteSchema = {
  requestBody: CreateUserRequestSchema,
  responseBody: CreateUserResponseSchema,
};

export const handler = async (input: RouteArguments) => {
  // Your handler logic here
  return {
    statusCode: 200,
    body: { /* response data */ }
  };
};

export default {
  routeChain: [
    jwtValidationMiddleware,
    schemaValidationMiddleware(routeSchema),
    handler
  ],
  routeSchema,
} as RouteModule;
```

### 2. Configure Your Routes

```typescript
// routes/users.config.ts
import { ConfigRouteEntry } from 'aws-lambda-api-tools';

export default [
  {
    description: 'Create user',
    swaggerMethodName: 'createUser',
    generateOpenApiDocs: true,
    handlerPath: 'handlers/users/create-user',
    method: 'POST',
    path: '/api/v1/users',
  },
  {
    description: 'Get user by ID',
    swaggerMethodName: 'getUser',
    generateOpenApiDocs: true,
    handlerPath: 'handlers/users/get-user',
    method: 'GET',
    path: '/api/v1/users/{userId}',
  }
] as Array<ConfigRouteEntry>;
```

### 3. Create Your Lambda Handler

```typescript
// index.ts
import { lambdaRouteProxyEntryHandler } from 'aws-lambda-api-tools';
import { config } from './routes-config';
import { routeModules } from './route-modules';

export const handler = lambdaRouteProxyEntryHandler(config, routeModules);
```

## Route Configuration

Routes are defined using the `ConfigRouteEntry` interface:

```typescript
interface ConfigRouteEntry {
  description: string;
  swaggerMethodName: string;
  generateOpenApiDocs: boolean;
  handlerPath: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY';
  path: string;
}
```

## Middleware

### Built-in Middleware

#### JWT Validation
```typescript
import { jwtValidationMiddleware } from 'aws-lambda-api-tools';

const routeModule: RouteModule = {
  routeChain: [
    jwtValidationMiddleware,
    handler
  ]
};
```

#### Schema Validation
```typescript
import { schemaValidationMiddleware } from 'aws-lambda-api-tools';

const schema: RouteSchema = {
  requestBody: Joi.object({
    name: Joi.string().required()
  }),
  responseBody: Joi.object({
    id: Joi.string(),
    name: Joi.string()
  })
};

const routeModule: RouteModule = {
  routeChain: [
    schemaValidationMiddleware(schema),
    handler
  ],
  routeSchema: schema
};
```

## Error Handling

The package includes a `CustomError` class for standardized error responses:

```typescript
import { CustomError } from 'aws-lambda-api-tools';

throw new CustomError('Resource not found', 404);
```

## Type Definitions

Key TypeScript interfaces:

```typescript
interface RouteModule {
  routeChain: MiddlewareChain;
  routeSchema?: RouteSchema;
}

interface RouteSchema {
  requestBody?: joi.Schema;
  responseBody?: joi.Schema;
  query?: Record<string, joi.Schema>;
  params?: Record<string, joi.Schema>;
}

interface RouteArguments {
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  routeData: any;
}
```

## Best Practices

1. **Organized Route Structure**
   - Group routes by feature/resource
   - Use consistent file naming conventions
   - Separate route configs from handlers

2. **Type Safety**
   - Define schemas for request/response validation
   - Use TypeScript interfaces for route configurations
   - Leverage middleware type definitions

3. **Error Handling**
   - Use `CustomError` for consistent error responses
   - Implement proper error middleware
   - Handle edge cases appropriately

4. **Security**
   - Always use JWT validation for protected routes
   - Implement proper permission checks
   - Validate all input data

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
