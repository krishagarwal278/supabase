/**
 * Database Client
 *
 * Centralized Supabase client initialization and management.
 * Provides both service role (admin) and user-scoped clients.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@/config/env';
import { DatabaseError } from '@/lib/errors';
import { logger } from '@/lib/logger';

let serviceClient: SupabaseClient | null = null;

/**
 * Get the service role Supabase client (admin operations)
 * This client bypasses RLS and should be used carefully.
 */
export function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    const env = getEnv();
    serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    logger.debug('Supabase service client initialized');
  }
  return serviceClient;
}

/**
 * Create a user-scoped Supabase client using their JWT token.
 * This client respects RLS policies.
 */
export function createUserClient(token: string): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Database health check
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();

  try {
    const client = getServiceClient();

    // Simple query to check connectivity
    const { error } = await client.from('projects').select('id').limit(1);

    const latencyMs = Date.now() - start;

    if (error) {
      return {
        healthy: false,
        latencyMs,
        error: error.message,
      };
    }

    return {
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    return {
      healthy: false,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute a database operation with error handling
 */
export async function executeQuery<T>(
  operation: () => Promise<{ data: T | null; error: { message: string; code?: string } | null }>
): Promise<T> {
  const { data, error } = await operation();

  if (error) {
    logger.error('Database query failed', {
      error: new Error(error.message),
      code: error.code,
    });
    throw new DatabaseError(error.message, { code: error.code });
  }

  if (data === null) {
    throw new DatabaseError('Query returned null data');
  }

  return data;
}

// Type exports for Supabase
export type { SupabaseClient };
