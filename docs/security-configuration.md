# Security Configuration

## Overview

The `aws-lambda-api-tools` framework now supports comprehensive security configuration to prevent common security vulnerabilities and misconfigurations. This replaces the previous hardcoded security headers with a flexible, secure-by-default configuration system.

## Configuration Files

The framework looks for security configuration in the following order:

1. `api-security.json` (recommended)
2. `api-security.js` 
3. `.api-security.json` (hidden file)
4. `package.json` under `apiSecurity` key

## Configuration Schema

```typescript
interface SecurityConfig {
  cors?: {
    allowOrigin?: string | string[];
    allowMethods?: string[];
    allowHeaders?: string[];
    allowCredentials?: boolean;
    maxAge?: number;
  };
  defaultHeaders?: Record<string, string>;
  jwtRotationHeaders?: {
    enabled?: boolean;
    rotationRequiredHeader?: string;
    rotationReasonHeader?: string;
  };
}
```

## Example Configuration

```json
{
  "cors": {
    "allowOrigin": [
      "https://app.example.com",
      "https://staging.example.com",
      "http://localhost:3000"
    ],
    "allowMethods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allowHeaders": [
      "Content-Type", 
      "Authorization", 
      "X-Requested-With"
    ],
    "allowCredentials": false,
    "maxAge": 86400
  },
  "defaultHeaders": {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "jwtRotationHeaders": {
    "enabled": true,
    "rotationRequiredHeader": "X-Token-Rotation-Required",
    "rotationReasonHeader": "X-Token-Rotation-Reason"
  }
}
```

## Security Features

### 1. CORS Protection
- **Secure by default**: No origins allowed unless explicitly configured
- **Validation**: Prevents dangerous wildcard + credentials combination
- **Origin validation**: Only allows requests from configured origins

### 2. Security Headers
- **Configurable defaults**: Set standard security headers
- **Override support**: Route handlers can override defaults
- **Best practices**: Includes recommended security headers

### 3. JWT Rotation Headers
- **Automatic injection**: Adds rotation headers when `routeData.needsJwtRotation` is true
- **Configurable headers**: Customize header names
- **Framework integration**: Works seamlessly with authentication middleware

## Security Validations

The framework performs automatic security validations:

### Dangerous Configurations
- **Error**: `allowCredentials: true` with `allowOrigin: "*"`
- **Warning**: Using wildcard origins
- **Warning**: No CORS origins configured
- **Warning**: Missing recommended security headers

### Recommended Headers
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

## JWT Rotation Integration

When using authentication middleware that sets `routeData.needsJwtRotation = true`, the framework automatically adds JWT rotation headers:

```typescript
// In your auth middleware:
return {
  ...args,
  routeData: {
    ...args.routeData,
    needsJwtRotation: true, // Framework detects this
    user: validatedUser
  }
};

// Framework automatically adds:
// X-Token-Rotation-Required: true
// X-Token-Rotation-Reason: secret-rotated
```

## Best Practices

1. **Always configure explicit origins** - Never use wildcards in production
2. **Disable credentials** unless absolutely necessary
3. **Include security headers** - Use the recommended defaults
4. **Test CORS configuration** - Verify only intended origins can access your API
5. **Monitor security warnings** - Address any validation warnings

## Environment-Specific Configuration

```javascript
// api-security.js (dynamic configuration)
module.exports = {
  cors: {
    allowOrigin: process.env.NODE_ENV === 'production' 
      ? ['https://app.example.com']
      : ['http://localhost:3000', 'https://staging.example.com'],
    allowCredentials: false
  }
};
```

## Middleware Header Control

Middleware can add headers that will be automatically included in responses using the framework's helper functions:

### Basic Header Management
```typescript
import { RouteArguments, addResponseHeader, addResponseHeaders } from 'aws-lambda-api-tools';

export const myMiddleware = async (args: RouteArguments): Promise<RouteArguments> => {
  // Add a single header
  let result = addResponseHeader(args, 'X-Custom-Header', 'value');
  
  // Add multiple headers
  result = addResponseHeaders(result, {
    'X-Request-ID': generateRequestId(),
    'X-Processing-Time': Date.now().toString(),
  });
  
  return result;
};
```

### Specialized Header Helpers
```typescript
import { 
  addRateLimitHeaders, 
  addCacheHeaders, 
  addSecurityHeaders,
  addAuthHeaders 
} from 'aws-lambda-api-tools';

// Rate limiting headers
result = addRateLimitHeaders(args, 100, 95, resetTime);

// Cache control headers  
result = addCacheHeaders(args, 3600, { public: true });

// Security headers
result = addSecurityHeaders(args, {
  contentSecurityPolicy: "default-src 'self'",
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
});

// Authentication headers
result = addAuthHeaders(args, {
  tokenRotationRequired: true,
  tokenRotationReason: 'secret-rotated',
});
```

### Header Priority Order
Headers are merged in the following priority order (highest priority last):

1. **Default security headers** (from config)
2. **CORS headers** (from config)  
3. **JWT rotation headers** (automatic)
4. **Middleware headers** (via `args.responseHeaders`)
5. **Handler headers** (from response object)

### Example: Authentication Middleware
```typescript
export const authMiddleware = async (args: RouteArguments): Promise<RouteArguments> => {
  const validationResult = await validateToken(token);
  
  let result = {
    ...args,
    routeData: {
      ...args.routeData,
      isAuthenticated: true,
      user: validationResult.user,
    },
  };

  // Add rotation headers if needed
  if (validationResult.needsJwtRotation) {
    result = addAuthHeaders(result, {
      tokenRotationRequired: true,
      tokenRotationReason: 'secret-rotated',
    });
  }

  return result;
};
```

This security configuration system ensures your API follows security best practices while providing the flexibility needed for different deployment environments.
