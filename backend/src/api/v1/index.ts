/**
 * API v1 Routes
 *
 * Aggregates all v1 API routes.
 */

import { Router } from 'express';
import healthRoutes from './health/health.routes';
import projectsRoutes from './projects/projects.routes';
import videoRoutes from './video/video.routes';

const router = Router();

// Mount routes
router.use('/projects', projectsRoutes);
router.use('/video', videoRoutes);

// Health routes are mounted at root level in app.ts
export { healthRoutes };

export default router;
