# AWS Lambda API Tools

> **Alpha Release Notice**: This package is currently in alpha. While it has been battle-tested in enterprise environments, the public API may undergo changes as we gather community feedback.

## Author's Note

Over the past five years, I've developed and refined this toolkit while building enterprise-grade applications on AWS. What started as a simple routing solution has evolved into a comprehensive toolkit that has successfully handled millions of requests in production environments.

This package embodies best practices learned from:
- Migrating from AWS CDK v1.x to v2.x
- Building and maintaining large-scale Lambda-based APIs
- Supporting multiple enterprise applications in production
- Implementing robust security and validation patterns
- Optimizing Lambda cold starts and performance

While the core functionality is stable and proven, I'm releasing this as an alpha version to gather community feedback and ensure the public API meets the needs of a broader audience.

### Coming Soon
- Complete example project from zero to production
- Step-by-step AWS account setup guide
- CDK infrastructure templates
- Performance optimization guides
- Advanced middleware patterns
- Real-world use cases

## Key Features

- 🛣️ **Structured Routing** - Define routes with complete type safety and automatic OpenAPI documentation generation
- 🔒 **JWT Authentication** - Built-in JWT validation middleware
- ✅ **Schema Validation** - Request/response validation using Joi
- 🚦 **Middleware Chain** - Flexible middleware system with type-safe middleware composition
- 📝 **OpenAPI/Swagger** - Automatic API documentation generation
- 🔍 **Type Safety** - Comprehensive TypeScript support
- 🎯 **Path Parameters** - Support for dynamic route parameters
- ⚡ **Performance** - Optimized for AWS Lambda execution.

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

## GitHub Actions IAM Setup

This package includes a utility to set up IAM OIDC authentication for GitHub Actions, allowing secure deployments to AWS without storing long-lived credentials.

### Usage

Create or update an IAM stack for GitHub Actions OIDC authentication:

```bash
npx aws-lambda-api-tools create-gha-iam-stack --repo=owner/repo-name
```

### Options

- `--repo`: (Required, Multiple) GitHub repository in the format `owner/repo-name`. Can be specified multiple times to grant access to multiple repositories
- `--policy`: (Optional) AWS managed policy name to attach to the role. Defaults to 'AdministratorAccess'
- Uses AWS credentials from your environment or AWS_PROFILE

### Examples

**Single Repository:**
```bash
npx aws-lambda-api-tools create-gha-iam-stack --repo=myorg/my-service
```

**Multiple Repositories:**
```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/service-a \
  --repo=myorg/service-b \
  --repo=myorg/service-c
```

**Custom IAM Policy:**
```bash
npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/my-service \
  --policy=AWSLambda_FullAccess
```

**Using AWS Profile:**
```bash
AWS_PROFILE=staging npx aws-lambda-api-tools create-gha-iam-stack \
  --repo=myorg/my-service
```

### Implementation Details

The tool creates a CloudFormation stack named `GithubActionsIam` containing:

1. An OIDC Provider for GitHub Actions (if it doesn't exist)
2. An IAM Role with:
   - Trust policy configured for the specified GitHub repositories
   - Specified AWS managed policy attached (defaults to AdministratorAccess)

The role ARN is output after stack creation/update and can be used in your GitHub Actions workflows.

### Using in GitHub Actions

Add the following to your GitHub Actions workflow:

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}  # Role ARN from stack output
          aws-region: us-east-1
      
      - name: Deploy
        run: |
          # Your deployment steps here
```

Set the `AWS_ROLE_ARN` secret in your GitHub repository to the role ARN output by the create-gha-iam-stack command.

### Updating Existing Stacks

You can run the command again with different repositories to update the stack:
- New repositories will be added to the trust policy
- Existing repositories will remain unchanged
- The attached policy can be updated by specifying a new --policy value


## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT