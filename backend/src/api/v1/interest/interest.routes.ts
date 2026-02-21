/**
 * Interest/Waitlist Routes
 *
 * Handles waitlist form submissions and admin management.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { interestService } from '@/api/interest-service';
import { ValidationError } from '@/lib/errors';
import { success } from '@/lib/response';
import { asyncHandler, authenticate, requireAdmin } from '@/middleware';

const router = Router();

// =============================================================================
// Schemas
// =============================================================================

const submitInterestSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  isBetaUser: z.boolean().optional(),
});

// =============================================================================
// Public Endpoints
// =============================================================================

/**
 * POST /api/v1/interest/submit
 * Submit interest form to join the waitlist
 */
router.post(
  '/submit',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = submitInterestSchema.safeParse(req.body);

    if (!validated.success) {
      throw new ValidationError(validated.error.message);
    }

    const submission = await interestService.submitInterestForm(validated.data);

    return success(res, {
      submission,
      message: 'Thank you for your interest! You have been added to our waitlist.',
    });
  })
);

/**
 * GET /api/v1/interest/stats
 * Get waitlist statistics (public summary)
 */
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await interestService.getInterestStats();

    return success(res, { stats });
  })
);

// =============================================================================
// Admin Endpoints (require authentication + admin role)
// =============================================================================

/**
 * GET /api/v1/interest/submissions
 * Get all interest submissions (admin only)
 */
router.get(
  '/submissions',
  authenticate,
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const submissions = await interestService.getInterestSubmissions();

    return success(res, { submissions });
  })
);

/**
 * GET /api/v1/interest/submissions/:id
 * Get a single submission by ID (admin only)
 */
router.get(
  '/submissions/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Submission ID is required');
    }

    const submission = await interestService.getInterestSubmissionById(id);

    if (!submission) {
      throw new ValidationError('Submission not found');
    }

    return success(res, { submission });
  })
);

/**
 * PATCH /api/v1/interest/submissions/:id
 * Update submission status (admin only)
 */
router.patch(
  '/submissions/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Submission ID is required');
    }

    const validated = updateStatusSchema.safeParse(req.body);

    if (!validated.success) {
      throw new ValidationError(validated.error.message);
    }

    const submission = await interestService.updateSubmissionStatus(
      id,
      validated.data.status,
      validated.data.isBetaUser
    );

    return success(res, {
      submission,
      message: 'Submission updated successfully',
    });
  })
);

/**
 * DELETE /api/v1/interest/submissions/:id
 * Delete a submission (admin only)
 */
router.delete(
  '/submissions/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Submission ID is required');
    }

    await interestService.deleteSubmission(id);

    return success(res, { message: 'Submission deleted successfully' });
  })
);

export default router;
