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

// Exact allowlists per frontend contract (see docs/BACKEND_REPO_SPEC.md)
const userRoles = [
  'udemy_instructor',
  'coursera_creator',
  'teachable_creator',
  'corporate_trainer',
  'instructional_designer',
  'certification_body',
  'educator',
  'content_creator',
  'other',
] as const;

// "Courses created" — only these 3 (frontend reverted to 3 options)
const earlyAccessPriorities = ['very_interested', 'somewhat_interested', 'just_exploring'] as const;

// What do you teach? (optional) — exact 7 topic slugs from frontend
const videoTopics = [
  'technical_skills',
  'business_finance',
  'academic',
  'creative_skills',
  'language_learning',
  'career_prep',
  'personal_development',
] as const;

const useCases = [
  'create_learning_videos',
  'summarize_concepts',
  'study_faster',
  'build_courses',
  'content_creation',
  'experimenting',
] as const;

const aiExperienceLevels = ['beginner', 'intermediate', 'advanced', 'power_user'] as const;

// Biggest challenge? (optional) — frontend dropdown
const biggestChallenges = [
  'recording_takes_too_long',
  'editing_tedious',
  'voice_quality_issues',
  'keeping_content_updated',
  'scaling_content',
  'production_costs',
] as const;

// Export needs (optional) — frontend dropdown
const exportNeedsOptions = [
  'udemy_mp4',
  'scorm_lms',
  'coursera_format',
  'multiple_platforms',
] as const;

// Optional enum: accept empty string from "Select..." placeholder and treat as omitted
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(values).optional())
    .optional();
}

const submitInterestSchema = z.object({
  // Required fields
  fullName: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Invalid email address'),
  role: z.enum(userRoles, { errorMap: () => ({ message: 'Please select a valid role' }) }),
  earlyAccessPriority: z.enum(earlyAccessPriorities, {
    errorMap: () => ({ message: 'Please select your interest level' }),
  }),
  videoTopics: z.array(z.enum(videoTopics)).optional().default([]),
  useCase: optionalEnum(useCases),
  aiExperience: optionalEnum(aiExperienceLevels),
  biggestChallenge: optionalEnum(biggestChallenges),
  exportNeeds: optionalEnum(exportNeedsOptions),
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
      const fieldErrors = validated.error.flatten().fieldErrors as Record<string, string[]>;
      throw new ValidationError('Validation failed', { fieldErrors });
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
