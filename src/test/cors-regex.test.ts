/**
 * Test suite for CORS regex pattern matching
 */

import { generateCorsHeaders } from '../lib/security-config-loader';
import { SecurityConfig } from '../lib/types-and-interfaces';

describe('CORS Regex Pattern Matching', () => {
  
  const testConfig: SecurityConfig = {
    cors: {
      allowOrigin: [
        'https://xorbit.app',
        'http://localhost:3000'
      ],
      allowOriginPatterns: [
        '^https://[a-zA-Z0-9-]+\\.xorbit\\.dev$',
        '^https://[a-zA-Z0-9-]+\\.xorbit\\.app$',
        '^http://localhost:[0-9]+$'
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      allowCredentials: false,
      maxAge: 86400
    }
  };

  describe('Exact String Matching', () => {
    test('should allow exact string matches', () => {
      const headers = generateCorsHeaders(testConfig, 'https://xorbit.app');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://xorbit.app');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    });

    test('should allow localhost exact match', () => {
      const headers = generateCorsHeaders(testConfig, 'http://localhost:3000');
      expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });

    test('should reject non-matching exact strings', () => {
      const headers = generateCorsHeaders(testConfig, 'https://evil.com');
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
  });

  describe('Regex Pattern Matching', () => {
    test('should allow subdomains matching xorbit.dev pattern', () => {
      const testCases = [
        'https://S1401.xorbit.dev',
        'https://T2502.xorbit.dev',
        'https://api.xorbit.dev',
        'https://admin-panel.xorbit.dev',
        'https://user123.xorbit.dev'
      ];

      testCases.forEach(origin => {
        const headers = generateCorsHeaders(testConfig, origin);
        expect(headers['Access-Control-Allow-Origin']).toBe(origin);
        expect(headers['Access-Control-Allow-Methods']).toBeDefined();
      });
    });

    test('should allow subdomains matching xorbit.app pattern', () => {
      const testCases = [
        'https://S1401.xorbit.app',
        'https://api.xorbit.app',
        'https://staging.xorbit.app'
      ];

      testCases.forEach(origin => {
        const headers = generateCorsHeaders(testConfig, origin);
        expect(headers['Access-Control-Allow-Origin']).toBe(origin);
      });
    });

    test('should allow localhost with any port', () => {
      const testCases = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8080',
        'http://localhost:9999'
      ];

      testCases.forEach(origin => {
        const headers = generateCorsHeaders(testConfig, origin);
        expect(headers['Access-Control-Allow-Origin']).toBe(origin);
      });
    });

    test('should reject origins that do not match patterns', () => {
      const testCases = [
        'https://evil.xorbit.dev',      // No subdomain
        'http://S1401.xorbit.dev',      // Wrong protocol
        'https://S1401.xorbit.com',     // Wrong domain
        'https://S1401.evil.dev',       // Wrong base domain
        'https://localhost:3000',       // Wrong protocol for localhost
        'http://localhost:abc',         // Non-numeric port
        'https://S1401.xorbit.dev.evil.com' // Domain spoofing attempt
      ];

      testCases.forEach(origin => {
        const headers = generateCorsHeaders(testConfig, origin);
        expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
      });
    });
  });

  describe('Mixed Configuration', () => {
    test('should handle both exact strings and regex patterns', () => {
      // Exact match should work
      let headers = generateCorsHeaders(testConfig, 'https://xorbit.app');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://xorbit.app');

      // Regex match should work
      headers = generateCorsHeaders(testConfig, 'https://S1401.xorbit.dev');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://S1401.xorbit.dev');

      // Non-matching should be rejected
      headers = generateCorsHeaders(testConfig, 'https://evil.com');
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
  });

  describe('Security Edge Cases', () => {
    test('should not be vulnerable to regex injection', () => {
      const maliciousConfig: SecurityConfig = {
        cors: {
          allowOriginPatterns: [
            '.*', // Overly permissive - should be avoided
            '^https://[a-zA-Z0-9-]+\\.xorbit\\.dev$'
          ]
        }
      };

      // This would match anything due to .* pattern
      const headers = generateCorsHeaders(maliciousConfig, 'https://evil.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://evil.com');
      
      // This demonstrates why regex patterns should be carefully crafted
    });

    test('should handle invalid regex patterns gracefully', () => {
      const invalidConfig: SecurityConfig = {
        cors: {
          allowOriginPatterns: [
            '[invalid regex',  // Invalid regex
            '^https://[a-zA-Z0-9-]+\\.xorbit\\.dev$' // Valid regex
          ]
        }
      };

      // Should still work with valid pattern despite invalid one
      const headers = generateCorsHeaders(invalidConfig, 'https://S1401.xorbit.dev');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://S1401.xorbit.dev');
    });

    test('should return exact origin, never the pattern', () => {
      const origin = 'https://S1401.xorbit.dev';
      const headers = generateCorsHeaders(testConfig, origin);
      
      // Should return the exact origin, not the regex pattern
      expect(headers['Access-Control-Allow-Origin']).toBe(origin);
      expect(headers['Access-Control-Allow-Origin']).not.toContain('.*');
      expect(headers['Access-Control-Allow-Origin']).not.toContain('[a-zA-Z0-9-]+');
    });
  });

  describe('Performance Considerations', () => {
    test('should handle multiple patterns efficiently', () => {
      const configWithManyPatterns: SecurityConfig = {
        cors: {
          allowOriginPatterns: [
            '^https://[a-zA-Z0-9-]+\\.domain1\\.com$',
            '^https://[a-zA-Z0-9-]+\\.domain2\\.com$',
            '^https://[a-zA-Z0-9-]+\\.domain3\\.com$',
            '^https://[a-zA-Z0-9-]+\\.xorbit\\.dev$',
            '^http://localhost:[0-9]+$'
          ]
        }
      };

      const start = Date.now();
      const headers = generateCorsHeaders(configWithManyPatterns, 'https://S1401.xorbit.dev');
      const duration = Date.now() - start;

      expect(headers['Access-Control-Allow-Origin']).toBe('https://S1401.xorbit.dev');
      expect(duration).toBeLessThan(10); // Should be very fast
    });
  });

});

export {};
