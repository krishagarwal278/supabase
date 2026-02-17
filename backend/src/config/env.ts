/**
 * Environment Configuration
 *
 * Validates and exports all environment variables with type safety.
 * Fails fast at startup if required variables are missing.
 */

import { z } from 'zod';

/**
 * Environment variable schema with validation rules
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000').transform(Number),

  // Supabase
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUPABASE_ANON_KEY: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Runway ML (optional - video generation)
  RUNWAY_API_KEY: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(Number),
});

/**
 * Parse environment variables with fallback for Vite-prefixed vars
 */
function getEnvValue(key: string): string | undefined {
  return process.env[key] || process.env[`VITE_${key}`];
}

/**
 * Build environment object from process.env
 */
function buildEnvObject(): Record<string, string | undefined> {
  return {
    NODE_ENV: process.env['NODE_ENV'],
    PORT: process.env['PORT'],
    SUPABASE_URL: getEnvValue('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY:
      process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_KEY'],
    SUPABASE_ANON_KEY: getEnvValue('SUPABASE_ANON_KEY'),
    OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
    RUNWAY_API_KEY: process.env['RUNWAY_API_KEY'],
    LOG_LEVEL: process.env['LOG_LEVEL'],
    CORS_ORIGIN: process.env['CORS_ORIGIN'],
    RATE_LIMIT_WINDOW_MS: process.env['RATE_LIMIT_WINDOW_MS'],
    RATE_LIMIT_MAX_REQUESTS: process.env['RATE_LIMIT_MAX_REQUESTS'],
  };
}

/**
 * Validated environment configuration
 */
export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Initialize and validate environment variables.
 * Call this at application startup.
 * @throws Error if validation fails
 */
export function initializeEnv(): Env {
  const envObject = buildEnvObject();
  const result = envSchema.safeParse(envObject);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(`Environment validation failed:\n${errors}\n\nPlease check your .env file.`);
  }

  _env = result.data;
  return _env;
}

/**
 * Get validated environment configuration.
 * @throws Error if env not initialized
 */
export function getEnv(): Env {
  if (!_env) {
    throw new Error('Environment not initialized. Call initializeEnv() at application startup.');
  }
  return _env;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return getEnv().NODE_ENV === 'development';
}

/**
 * Check if running in test
 */
export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}
