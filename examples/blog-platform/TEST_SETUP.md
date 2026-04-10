# SWR Hooks Testing Setup

## Prerequisites

Install the testing dependencies:

```bash
cd examples/blog-platform
npm install --save-dev \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  jest \
  jest-environment-jsdom \
  @types/jest \
  ts-jest
```

## Jest Configuration

Create `jest.config.js` in the blog-platform root:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx'
  ],
};
```

## Setup File

Create `jest.setup.js`:

```javascript
import '@testing-library/jest-dom';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});
```

## Update package.json

Add test scripts:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Files

- `src/lib/__tests__/swr-hooks.test.ts` - SWR hooks tests
- `src/lib/__tests__/flarebase-jwt.test.ts` - Flarebase JWT client tests (to be created)

## Test Coverage

The test suite covers:
- ✅ Authentication hooks (login, register, logout)
- ✅ Query hooks (useNamedQuery, useArticles)
- ✅ JWT integration (authenticated vs guest)
- ✅ Error handling (auth errors, network errors, server errors)
- ✅ SWR configuration options
- ✅ Conditional queries

## Example Test Output

```
PASS  src/lib/__tests__/swr-hooks.test.ts
  SWR Hooks
    useAuth
      ✓ should return unauthenticated state initially (5ms)
      ✓ should return authenticated state after login (15ms)
      ✓ should register new user (12ms)
      ✓ should logout user (8ms)
    useNamedQuery
      ✓ should fetch named query with JWT (20ms)
      ✓ should handle query errors (10ms)
      ✓ should pass parameters to query (18ms)
      ✓ should not fetch when condition is false (5ms)
    useArticles
      ✓ should fetch articles list (22ms)
      ✓ should handle empty articles list (15ms)
    JWT Integration
      ✓ should include JWT in query requests (25ms)
      ✓ should work with guest context when unauthenticated (18ms)
    SWR Configuration
      ✓ should use custom SWR options (20ms)
      ✓ should support conditional queries (12ms)
    Error Handling
      ✓ should handle authentication errors (10ms)
      ✓ should handle network errors (8ms)
      ✓ should handle server errors (9ms)

Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

## Continuous Integration

These tests can be integrated into CI/CD pipelines:

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```
