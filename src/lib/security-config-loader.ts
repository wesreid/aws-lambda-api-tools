import * as fs from 'fs';
import * as path from 'path';
import { SecurityConfig } from './types-and-interfaces';

/**
 * Default security configuration (minimal and secure)
 */
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  cors: {
    allowOrigin: [], // No origins allowed by default - must be explicitly configured
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowCredentials: false, // Secure default
    maxAge: 86400, // 24 hours
  },
  defaultHeaders: {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
  },
  jwtRotationHeaders: {
    enabled: true,
    rotationRequiredHeader: 'X-Token-Rotation-Required',
    rotationReasonHeader: 'X-Token-Rotation-Reason',
  },
};

/**
 * Load security configuration from project root
 * Looks for: api-security.json, api-security.js, or embedded in package.json
 */
export function loadSecurityConfig(projectRoot: string = process.cwd()): SecurityConfig {
  const configPaths = [
    path.join(projectRoot, 'api-security.json'),
    path.join(projectRoot, 'api-security.js'),
    path.join(projectRoot, '.api-security.json'),
  ];

  let userConfig: Partial<SecurityConfig> = {};

  // Try to load from dedicated config files
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        if (configPath.endsWith('.js')) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          userConfig = require(configPath);
        } else {
          const configContent = fs.readFileSync(configPath, 'utf8');
          userConfig = JSON.parse(configContent);
        }
        console.log(`Loaded security config from: ${configPath}`);
        break;
      } catch (error) {
        console.warn(`Failed to load security config from ${configPath}:`, error);
      }
    }
  }

  // Try to load from package.json
  if (Object.keys(userConfig).length === 0) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.apiSecurity) {
          userConfig = packageJson.apiSecurity;
          console.log('Loaded security config from package.json');
        }
      } catch (error) {
        console.warn('Failed to load security config from package.json:', error);
      }
    }
  }

  // Merge with defaults and validate
  const mergedConfig = mergeSecurityConfig(DEFAULT_SECURITY_CONFIG, userConfig);
  validateSecurityConfig(mergedConfig);
  
  return mergedConfig;
}

/**
 * Deep merge security configurations
 */
function mergeSecurityConfig(defaults: SecurityConfig, user: Partial<SecurityConfig>): SecurityConfig {
  return {
    cors: {
      ...defaults.cors,
      ...user.cors,
    },
    defaultHeaders: {
      ...defaults.defaultHeaders,
      ...user.defaultHeaders,
    },
    jwtRotationHeaders: {
      ...defaults.jwtRotationHeaders,
      ...user.jwtRotationHeaders,
    },
  };
}

/**
 * Validate security configuration for common misconfigurations
 */
function validateSecurityConfig(config: SecurityConfig): void {
  // Validate CORS configuration
  if (config.cors) {
    const { allowOrigin, allowCredentials } = config.cors;
    
    // Check for dangerous wildcard with credentials
    const hasWildcard = allowOrigin === '*' || 
      (Array.isArray(allowOrigin) && allowOrigin.some(origin => origin === '*'));
    
    if (allowCredentials && hasWildcard) {
      throw new Error(
        'SECURITY ERROR: Cannot use Access-Control-Allow-Credentials: true with Access-Control-Allow-Origin: *. ' +
        'This is a security vulnerability. Specify explicit origins instead.'
      );
    }

    // Warn about wildcard origins
    if (hasWildcard) {
      console.warn(
        'WARNING: Using wildcard (*) for Access-Control-Allow-Origin. ' +
        'Consider specifying explicit origins for better security.'
      );
    }

    // Validate that origins are provided
    if (Array.isArray(allowOrigin) && allowOrigin.length === 0) {
      console.warn(
        'WARNING: No CORS origins configured. API will reject all cross-origin requests. ' +
        'Configure allowOrigin in your security config if cross-origin access is needed.'
      );
    }
  }

  // Validate headers
  if (config.defaultHeaders) {
    const headers = config.defaultHeaders;
    
    // Check for missing security headers
    const recommendedHeaders = [
      'X-Content-Type-Options',
      'X-Frame-Options', 
      'X-XSS-Protection',
    ];
    
    for (const header of recommendedHeaders) {
      if (!headers[header]) {
        console.warn(`SECURITY: Consider adding ${header} header for better security`);
      }
    }
  }
}

/**
 * Check if an origin matches allowed origins (including regex patterns)
 */
function isOriginAllowed(
  requestOrigin: string,
  allowOrigin?: string | string[] | RegExp | RegExp[],
  allowOriginPatterns?: string[]
): boolean {
  if (!allowOrigin && !allowOriginPatterns) {
    return false;
  }
  
  // Handle wildcard
  if (allowOrigin === '*') {
    return true;
  }
  
  // Handle different allowOrigin types
  if (Array.isArray(allowOrigin)) {
    for (const origin of allowOrigin) {
      if (typeof origin === 'string' && origin === requestOrigin) {
        return true;
      }
      if (origin instanceof RegExp && origin.test(requestOrigin)) {
        return true;
      }
    }
  } else if (typeof allowOrigin === 'string') {
    return allowOrigin === requestOrigin;
  } else if (allowOrigin instanceof RegExp) {
    return allowOrigin.test(requestOrigin);
  }
  
  // Handle regex patterns from JSON config (as strings)
  if (allowOriginPatterns && allowOriginPatterns.length > 0) {
    for (const pattern of allowOriginPatterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(requestOrigin)) {
          return true;
        }
      } catch (error) {
        console.warn(`Invalid regex pattern in allowOriginPatterns: ${pattern}`, error);
      }
    }
  }
  
  return false;
}

/**
 * Generate CORS headers based on configuration and request origin
 */
export function generateCorsHeaders(config: SecurityConfig, requestOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (!config.cors || !requestOrigin) {
    return headers;
  }

  const { allowOrigin, allowOriginPatterns, allowMethods, allowHeaders, allowCredentials, maxAge } = config.cors;

  // Check if the request origin is allowed
  if (isOriginAllowed(requestOrigin, allowOrigin, allowOriginPatterns)) {
    // IMPORTANT: Always return the exact request origin, never the pattern
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    
    // Add other CORS headers only if origin is allowed
    if (allowMethods && allowMethods.length > 0) {
      headers['Access-Control-Allow-Methods'] = allowMethods.join(', ');
    }
    
    if (allowHeaders && allowHeaders.length > 0) {
      headers['Access-Control-Allow-Headers'] = allowHeaders.join(', ');
    }
    
    if (allowCredentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    
    if (maxAge) {
      headers['Access-Control-Max-Age'] = maxAge.toString();
    }
  }

  return headers;
}

/**
 * Generate JWT rotation headers if needed
 */
export function generateJwtRotationHeaders(
  config: SecurityConfig, 
  routeData: any
): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (!config.jwtRotationHeaders?.enabled || !routeData?.needsJwtRotation) {
    return headers;
  }

  const { rotationRequiredHeader, rotationReasonHeader } = config.jwtRotationHeaders;
  
  if (rotationRequiredHeader) {
    headers[rotationRequiredHeader] = 'true';
  }
  
  if (rotationReasonHeader) {
    headers[rotationReasonHeader] = 'secret-rotated';
  }

  return headers;
}
