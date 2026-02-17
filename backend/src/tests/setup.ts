/**
 * Test Setup
 *
 * Global test configuration and mocks.
 */

import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock environment variables
beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['PORT'] = '4000';
  process.env['SUPABASE_URL'] = 'https://test.supabase.co';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-key';
  process.env['OPENAI_API_KEY'] = 'test-openai-key';
  process.env['LOG_LEVEL'] = 'error';
  process.env['CORS_ORIGIN'] = '*';
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Clean up after all tests
afterAll(() => {
  vi.restoreAllMocks();
});
