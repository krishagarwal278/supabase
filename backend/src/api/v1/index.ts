/**
 * API v1 Routes
 *
 * Aggregates all v1 API routes.
 */

import { Router } from 'express';
import chatRoutes from './chat/chat.routes';
import creditsRoutes from './credits/credits.routes';
import healthRoutes from './health/health.routes';
import historyRoutes from './history/history.routes';
import interestRoutes from './interest/interest.routes';
import projectsRoutes from './projects/projects.routes';
import usersRoutes from './users/users.routes';
import videoRoutes from './video/video.routes';

const router = Router();

// Use default export when present (fixes Router.use "got Object" when TS/Node interop gives { default: router })
const asRouter = (r: unknown, name: string): ReturnType<typeof Router> => {
  if (typeof r === 'function') {
    return r as ReturnType<typeof Router>;
  }
  const d = (r as { default?: unknown })?.default;
  if (typeof d === 'function') {
    return d as ReturnType<typeof Router>;
  }
  throw new Error(
    `Route "${name}" did not export a Router (got ${typeof r}). Check ${name}.routes.ts default export.`
  );
};

// Mount routes
router.use('/projects', asRouter(projectsRoutes, 'projects'));
router.use('/video', asRouter(videoRoutes, 'video'));
router.use('/chat', asRouter(chatRoutes, 'chat'));
router.use('/credits', asRouter(creditsRoutes, 'credits'));
router.use('/history', asRouter(historyRoutes, 'history'));
router.use('/interest', asRouter(interestRoutes, 'interest'));
router.use('/users', asRouter(usersRoutes, 'users'));

// Health routes are mounted at root level in app.ts
export { healthRoutes };

export default router;
