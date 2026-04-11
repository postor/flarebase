/**
 * HTTP Error Handling Tests (TDD Approach)
 *
 * RED Phase: Write failing tests first
 * GREEN Phase: Fix code to make tests pass
 *
 * Tests ensure client handles HTTP errors with empty response bodies
 * (401 Unauthorized, etc.) without throwing JSON parsing errors.
 */

import { FlareClient } from '../dist/index.js';
import { describe, it, expect, beforeEach } from 'vitest';

const BASE_URL = 'http://localhost:3000';

describe('HTTP Error Handling - TDD', () => {

  let client;

  beforeEach(() => {
    client = new FlareClient({
      baseURL: BASE_URL,
      socketURL: 'ws://localhost:3000'
    });
  });

  describe('RED Phase: Tests that fail with current implementation', () => {

    describe('namedQuery() with invalid auth', () => {
      it('should throw meaningful error, not JSON parse error', async () => {
        // Try to access a protected named query without auth
        // This should return 401 with empty body

        try {
          // Use a query that requires authentication
          await client.namedQuery('get_user_profile');
          fail('Should have thrown an error');
        } catch (error) {
          // Should NOT be "Unexpected end of JSON input"
          expect(error.message).not.toMatch(/JSON/i);
          expect(error.message).not.toMatch(/unexpected end/i);
          expect(error.message).not.toMatch(/Failed to execute 'json'/i);

          // Should have meaningful error info
          expect(error.message).toMatch(/failed|unauthorized|401|403|error/i);
        }
      });
    });

    describe('Real scenario: Blog platform requests', () => {
      it('should handle articles query errors gracefully', async () => {
        try {
          // Simulating what the blog platform does
          const result = await client.query('articles', []);
          // If it succeeds, that's OK (server allows it)
          expect(result).toBeDefined();
        } catch (error) {
          // If it fails, should NOT be JSON parse error
          expect(error.message).not.toMatch(/JSON/i);
          expect(error.message).not.toMatch(/unexpected end/i);
          expect(error.message).not.toMatch(/Failed to execute 'json'/i);
        }
      });
    });

    describe('All API methods must check response.ok before .json()', () => {

      const testCases = [
        {
          name: 'query()',
          fn: () => client.query('test', [])
        },
        {
          name: 'namedQuery()',
          fn: () => client.namedQuery('nonexistent')
        },
        {
          name: 'collection.add()',
          fn: () => client.collection('test').add({ name: 'test' })
        },
        {
          name: 'collection.get()',
          fn: () => client.collection('test').get()
        },
        {
          name: 'doc.get()',
          fn: () => client.collection('test').doc('id').get()
        },
        {
          name: 'doc.update()',
          fn: () => client.collection('test').doc('id').update({ name: 'test' })
        },
        {
          name: 'doc.delete()',
          fn: () => client.collection('test').doc('id').delete()
        },
        {
          name: 'query.get()',
          fn: () => client.collection('test').where('name', '==', 'test').get()
        }
      ];

      for (const testCase of testCases) {
        it(`${testCase.name} should handle empty error responses`, async () => {
          try {
            await testCase.fn();
            // Success is OK - server might allow the request
          } catch (error) {
            // If error, must NOT be JSON parsing error
            expect(error.message).not.toMatch(/JSON/i);
            expect(error.message).not.toMatch(/unexpected end/i);
            expect(error.message).not.toMatch(/Failed to execute 'json'/i);

            // Error should include HTTP status info
            expect(error.message).toMatch(/\d{3}/); // Status code like 401, 403, etc.
          }
        });
      }
    });

    describe('SWR fetcher error handling', () => {
      it('should handle errors without JSON parse exceptions', async () => {
        const fetcher = client.swrFetcher;

        try {
          await fetcher('/collections/test');
        } catch (error) {
          expect(error.message).not.toMatch(/JSON/i);
          expect(error.message).not.toMatch(/unexpected end/i);
        }
      });
    });

    describe('Transaction error handling', () => {
      it('should handle transaction failures gracefully', async () => {
        try {
          await client.runTransaction(async (txn) => {
            await txn.set(client.collection('test').doc('id'), { name: 'test' });
          });
        } catch (error) {
          expect(error.message).not.toMatch(/JSON/i);
          expect(error.message).not.toMatch(/unexpected end/i);
        }
      });
    });
  });
});

function fail(message) {
  throw new Error(message);
}
