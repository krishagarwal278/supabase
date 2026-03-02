/**
 * Server Entry Point
 *
 * Initializes environment, polyfills, and starts the HTTP server.
 */

// Polyfill fetch globals for Node.js (required for some SDKs)
import dotenv from 'dotenv';
import { FormData, File, Blob } from 'formdata-node';
import fetch, { Headers, Request, Response } from 'node-fetch';
import { createApp } from './app';
import { initializeEnv } from '@/config/env';
import { logger } from '@/lib/logger';
import { preloadFalClient } from '@/services/image-generation.service';

if (!globalThis.fetch) {
  (globalThis as unknown as Record<string, unknown>).fetch = fetch;
  (globalThis as unknown as Record<string, unknown>).Headers = Headers;
  (globalThis as unknown as Record<string, unknown>).Request = Request;
  (globalThis as unknown as Record<string, unknown>).Response = Response;
}
if (typeof globalThis.FormData === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).FormData = FormData;
  (globalThis as unknown as Record<string, unknown>).File = File;
  (globalThis as unknown as Record<string, unknown>).Blob = Blob;
}

// Load environment variables before anything else
dotenv.config();

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(server: ReturnType<typeof import('http').createServer>): void {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    server.close((err) => {
      if (err) {
        logger.error('Error during shutdown', { error: err });
        process.exit(1);
      }

      logger.info('Server closed successfully');
      process.exit(0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Handle uncaught exceptions and rejections
 */
function setupErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error,
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    // Don't exit for unhandled rejections, but log them
  });
}

/**
 * Main startup function
 */
async function main(): Promise<void> {
  try {
    // Initialize and validate environment
    const env = initializeEnv();
    logger.setLevel(env.LOG_LEVEL);

    logger.info('Starting server...', {
      environment: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
    });

    // Set up error handlers
    setupErrorHandlers();

    // Preload Fal client so its dynamic import runs at startup, not during a request.
    // Avoids "Channel closed" when ts-node-dev restarts mid-request.
    await preloadFalClient();

    // Create Express app
    const app = createApp();

    // Start HTTP server
    const server = app.listen(env.PORT, () => {
      logger.info(`Server listening on port ${env.PORT}`, {
        port: env.PORT,
        environment: env.NODE_ENV,
        nodeVersion: process.version,
      });
    });

    // Set up graceful shutdown
    setupGracefulShutdown(server);
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Start the server
main();
