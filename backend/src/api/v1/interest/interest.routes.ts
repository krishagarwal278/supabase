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

// Enum values for validation (must match frontend "I am a..." dropdown values)
const userRoles = [
  'student',
  'self_learner',
  'educator',
  'educator_professor', // Educator / Professor
  'content_creator',
  'teachable_creator', // Teachable Creator
  'udemy_instructor',
  'coursera_creator',
  'corporate_trainer', // Corporate Trainer / L&D
  'instructional_designer',
  'certification_body',
  'professional',
  'developer',
  'solopreneur', // Solopreneur / Individual
  'other',
] as const;

// Interest level + "Courses created" dropdown (all valid permutations)
const earlyAccessPriorities = [
  'very_interested',
  'somewhat_interested',
  'just_exploring',
  'planning_my_first_course', // Planning my first course
  'one_to_ten_courses', // 1-10 courses
  'power_creator', // 10+ courses (Power creator)
  'few_courses',
  'many_courses',
  'scale_courses',
] as const;

// What do you teach? (optional) — frontend tags + backend legacy values
const videoTopics = [
  'technical_skills',
  'business_finance',
  'academic',
  'academic_subjects', // frontend "Academic Subjects"
  'creative_skills',
  'creative_design', // frontend "Creative & Design"
  'language_learning',
  'languages', // frontend "Languages"
  'career_prep',
  'professional_certs', // frontend "Professional Certs"
  'personal_development',
  'personal_dev', // frontend "Personal Dev"
  'programming_tech', // frontend "Programming & Tech"
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
    errorMap: () => ({ message: 'Please select "Courses created"' }),
  }),
  // Optional: any combination of tags (0 to all), max 20 for safety
  videoTopics: z
    .array(z.enum(videoTopics))
    .max(20, 'Select up to 20 topics')
    .optional()
    .default([]),
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
      const first = validated.error.flatten().fieldErrors;
      const msg =
        first && Object.keys(first).length > 0
          ? `${Object.keys(first)[0]}: ${(Object.values(first)[0] as string[])?.[0] ?? validated.error.message}`
          : validated.error.message;
      throw new ValidationError(msg);
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
