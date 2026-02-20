/**
 * API v1 Routes
 *
 * Aggregates all v1 API routes.
 */

import { Router } from 'express';
import creditsRoutes from './credits/credits.routes';
import healthRoutes from './health/health.routes';
import historyRoutes from './history/history.routes';
import projectsRoutes from './projects/projects.routes';
import usersRoutes from './users/users.routes';
import videoRoutes from './video/video.routes';

const router = Router();

// Mount routes
router.use('/projects', projectsRoutes);
router.use('/video', videoRoutes);
router.use('/credits', creditsRoutes);
router.use('/history', historyRoutes);
router.use('/users', usersRoutes);

// Health routes are mounted at root level in app.ts
export { healthRoutes };

export default router;
