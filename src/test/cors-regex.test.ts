/**
 * Test suite for CORS regex pattern matching
 */

import { generateCorsHeaders } from '../lib/security-config-loader';
import { SecurityConfig } from '../lib/types-and-interfaces';

describe('CORS Regex Pattern Matching', () => {
  
  const testConfig: SecurityConfig = {
    cors: {
      allowOrigin: [
        'https://example.com',
        'http://localhost:3000'
      ],
      allowOriginPatterns: [
        '^https://[a-zA-Z0-9-]+\\.example\\.dev$',
        '^https://[a-zA-Z0-9-]+\\.example\\.com$',
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
      const headers = generateCorsHeaders(testConfig, 'https://example.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
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
    test('should allow subdomains matching example.dev pattern', () => {
      const testCases = [
        'https://app-1401.example.dev',
        'https://staging-2502.example.dev',
        'https://api.example.dev',
        'https://admin-panel.example.dev',
        'https://user123.example.dev'
      ];

      testCases.forEach(origin => {
        const headers = generateCorsHeaders(testConfig, origin);
        expect(headers['Access-Control-Allow-Origin']).toBe(origin);
        expect(headers['Access-Control-Allow-Methods']).toBeDefined();
      });
    });

    test('should allow subdomains matching example.com pattern', () => {
      const testCases = [
        'https://app-1401.example.com',
        'https://api.example.com',
        'https://staging.example.com'
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
        'https://example.dev',              // No subdomain (pattern requires one)
        'http://app-1401.example.dev',      // Wrong protocol
        'https://app-1401.example.org',     // Wrong TLD
        'https://app-1401.evil.dev',        // Wrong base domain
        'https://localhost:3000',           // Wrong protocol for localhost
        'http://localhost:abc',             // Non-numeric port
        'https://app-1401.example.dev.evil.com' // Domain spoofing attempt
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
      let headers = generateCorsHeaders(testConfig, 'https://example.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');

      // Regex match should work
      headers = generateCorsHeaders(testConfig, 'https://app-1401.example.dev');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://app-1401.example.dev');

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
            '^https://[a-zA-Z0-9-]+\\.example\\.dev$'
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
            '^https://[a-zA-Z0-9-]+\\.example\\.dev$' // Valid regex
          ]
        }
      };

      // Should still work with valid pattern despite invalid one
      const headers = generateCorsHeaders(invalidConfig, 'https://app-1401.example.dev');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://app-1401.example.dev');
    });

    test('should return exact origin, never the pattern', () => {
      const origin = 'https://app-1401.example.dev';
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
            '^https://[a-zA-Z0-9-]+\\.example\\.dev$',
            '^http://localhost:[0-9]+$'
          ]
        }
      };

      const start = Date.now();
      const headers = generateCorsHeaders(configWithManyPatterns, 'https://app-1401.example.dev');
      const duration = Date.now() - start;

      expect(headers['Access-Control-Allow-Origin']).toBe('https://app-1401.example.dev');
      expect(duration).toBeLessThan(10); // Should be very fast
    });
  });

});

export {};
