/**
 * Projects Routes
 *
 * CRUD operations for projects.
 */

import { Router, Request, Response } from 'express';
import { ValidationError } from '@/lib/errors';
import { success, created, noContent, paginated } from '@/lib/response';
import { authenticate } from '@/middleware/auth';
import { asyncHandler } from '@/middleware/error-handler';
import { projectService } from '@/services';
import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  uuidSchema,
  paginationSchema,
} from '@/types/api';

const router = Router();

/**
 * POST /api/v1/projects
 * Create a new project
 */
router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const validated = createProjectRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const project = await projectService.createProject(validated.data);
    return created(res, project);
  })
);

/**
 * GET /api/v1/projects
 * Get all projects with pagination
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const paginationResult = paginationSchema.safeParse(req.query);

    if (!paginationResult.success) {
      throw paginationResult.error;
    }

    const { page, limit } = paginationResult.data;
    const userId = req.query['userId'] as string | undefined;

    const { projects, total } = await projectService.getProjects({
      page,
      limit,
      userId: userId || undefined,
    });

    return paginated(res, projects, { page, limit, total });
  })
);

/**
 * GET /api/v1/projects/:id
 * Get a project by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    const project = await projectService.getProjectById(idResult.data);
    return success(res, project);
  })
);

/**
 * PUT /api/v1/projects/:id
 * Update a project
 */
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    const bodyResult = updateProjectRequestSchema.safeParse(req.body);

    if (!bodyResult.success) {
      throw bodyResult.error;
    }

    const project = await projectService.updateProject(idResult.data, bodyResult.data);
    return success(res, project);
  })
);

/**
 * DELETE /api/v1/projects/:id
 * Delete a project
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    await projectService.deleteProject(idResult.data);
    return noContent(res);
  })
);

export default router;
