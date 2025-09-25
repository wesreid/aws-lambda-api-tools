import { RouteArguments } from './types-and-interfaces';

/**
 * Helper utilities for middleware to manage response headers
 */

/**
 * Add a header to be included in the response
 * Middleware can use this to add headers that will be automatically included
 */
export function addResponseHeader(
  args: RouteArguments, 
  name: string, 
  value: string
): RouteArguments {
  return {
    ...args,
    responseHeaders: {
      ...args.responseHeaders,
      [name]: value,
    },
  };
}

/**
 * Add multiple headers to be included in the response
 */
export function addResponseHeaders(
  args: RouteArguments, 
  headers: Record<string, string>
): RouteArguments {
  return {
    ...args,
    responseHeaders: {
      ...args.responseHeaders,
      ...headers,
    },
  };
}

/**
 * Conditionally add a header based on some condition
 */
export function addConditionalHeader(
  args: RouteArguments,
  condition: boolean,
  name: string,
  value: string
): RouteArguments {
  if (!condition) return args;
  
  return addResponseHeader(args, name, value);
}

/**
 * Add rate limiting headers
 */
export function addRateLimitHeaders(
  args: RouteArguments,
  limit: number,
  remaining: number,
  resetTime: number
): RouteArguments {
  return addResponseHeaders(args, {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetTime.toString(),
  });
}

/**
 * Add cache control headers
 */
export function addCacheHeaders(
  args: RouteArguments,
  maxAge: number,
  options: {
    public?: boolean;
    private?: boolean;
    noCache?: boolean;
    noStore?: boolean;
    mustRevalidate?: boolean;
  } = {}
): RouteArguments {
  const cacheDirectives = [];
  
  if (options.public) cacheDirectives.push('public');
  if (options.private) cacheDirectives.push('private');
  if (options.noCache) cacheDirectives.push('no-cache');
  if (options.noStore) cacheDirectives.push('no-store');
  if (options.mustRevalidate) cacheDirectives.push('must-revalidate');
  if (maxAge > 0) cacheDirectives.push(`max-age=${maxAge}`);
  
  return addResponseHeader(args, 'Cache-Control', cacheDirectives.join(', '));
}

/**
 * Add security headers for specific middleware needs
 */
export function addSecurityHeaders(
  args: RouteArguments,
  headers: {
    contentSecurityPolicy?: string;
    strictTransportSecurity?: string;
    referrerPolicy?: string;
    permissionsPolicy?: string;
  }
): RouteArguments {
  const securityHeaders: Record<string, string> = {};
  
  if (headers.contentSecurityPolicy) {
    securityHeaders['Content-Security-Policy'] = headers.contentSecurityPolicy;
  }
  if (headers.strictTransportSecurity) {
    securityHeaders['Strict-Transport-Security'] = headers.strictTransportSecurity;
  }
  if (headers.referrerPolicy) {
    securityHeaders['Referrer-Policy'] = headers.referrerPolicy;
  }
  if (headers.permissionsPolicy) {
    securityHeaders['Permissions-Policy'] = headers.permissionsPolicy;
  }
  
  return addResponseHeaders(args, securityHeaders);
}

/**
 * Add custom authentication headers
 */
export function addAuthHeaders(
  args: RouteArguments,
  headers: {
    tokenRotationRequired?: boolean;
    tokenRotationReason?: string;
    authRealm?: string;
    authScheme?: string;
  }
): RouteArguments {
  const authHeaders: Record<string, string> = {};
  
  if (headers.tokenRotationRequired) {
    authHeaders['X-Token-Rotation-Required'] = 'true';
  }
  if (headers.tokenRotationReason) {
    authHeaders['X-Token-Rotation-Reason'] = headers.tokenRotationReason;
  }
  if (headers.authRealm) {
    authHeaders['WWW-Authenticate'] = `${headers.authScheme || 'Bearer'} realm="${headers.authRealm}"`;
  }
  
  return addResponseHeaders(args, authHeaders);
}
