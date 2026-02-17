/**
 * Health Check Routes
 *
 * Endpoints for monitoring and container orchestration.
 */

import { Router, Request, Response } from 'express';
import { getEnv, isProduction } from '@/config/env';
import { checkDatabaseHealth } from '@/lib/database';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import { runwayService } from '@/services';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  uptime: number;
  environment: string;
  checks: {
    database: {
      status: 'healthy' | 'unhealthy';
      latencyMs?: number;
      error?: string;
    };
    services: {
      openai: {
        configured: boolean;
      };
      runway: {
        configured: boolean;
      };
    };
  };
}

/**
 * GET /health
 * Basic health check (for load balancers/k8s probes)
 */
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    return success(res, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * GET /health/live
 * Liveness probe - is the process running?
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /health/ready
 * Readiness probe - is the service ready to accept traffic?
 */
router.get(
  '/ready',
  asyncHandler(async (_req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();

    if (!dbHealth.healthy) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'Database connection failed',
        error: dbHealth.error,
      });
      return;
    }

    return success(res, {
      status: 'ready',
      database: {
        latencyMs: dbHealth.latencyMs,
      },
    });
  })
);

/**
 * GET /health/detailed
 * Detailed health status (for monitoring dashboards)
 */
router.get(
  '/detailed',
  asyncHandler(async (_req: Request, res: Response) => {
    const env = getEnv();
    const dbHealth = await checkDatabaseHealth();

    const healthStatus: HealthStatus = {
      status: dbHealth.healthy ? 'healthy' : 'degraded',
      version: process.env['npm_package_version'] || '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
      checks: {
        database: dbHealth.error
          ? { status: 'unhealthy' as const, latencyMs: dbHealth.latencyMs, error: dbHealth.error }
          : { status: 'healthy' as const, latencyMs: dbHealth.latencyMs },
        services: {
          openai: {
            configured: !!env.OPENAI_API_KEY,
          },
          runway: {
            configured: runwayService.isRunwayConfigured(),
          },
        },
      },
    };

    // Don't expose detailed info in production unless authenticated
    if (isProduction()) {
      return success(res, {
        status: healthStatus.status,
        timestamp: healthStatus.timestamp,
      });
    }

    return success(res, healthStatus);
  })
);

export default router;
