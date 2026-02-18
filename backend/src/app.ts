/**
 * Express Application Setup
 *
 * Configures middleware, routes, and error handling.
 */

import express, { Application } from 'express';
import { v1Routes, healthRoutes } from '@/api';
import { API_VERSION } from '@/config/constants';
import {
  requestLoggerWithFilter,
  errorHandler,
  notFoundHandler,
  securityHeaders,
  cors,
  rateLimit,
} from '@/middleware';

/**
 * Create and configure Express application
 */
export function createApp(): Application {
  const app = express();

  // ==========================================================================
  // Pre-route Middleware
  // ==========================================================================

  // Security headers
  app.use(securityHeaders);

  // CORS
  app.use(cors());

  // Request parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging with request ID
  app.use(requestLoggerWithFilter);

  // Rate limiting
  app.use(rateLimit());

  // ==========================================================================
  // Routes
  // ==========================================================================

  // Health check routes (no auth required, no versioning)
  app.use('/health', healthRoutes);

  // API v1 routes
  app.use(API_VERSION.V1, v1Routes);

  // Legacy routes for backward compatibility
  // TODO: Remove these after frontend migration
  // Mount video routes directly at /api/video (not through v1Routes which adds /video again)
  app.use('/api', v1Routes);

  // ==========================================================================
  // Post-route Middleware
  // ==========================================================================

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

export default createApp;
