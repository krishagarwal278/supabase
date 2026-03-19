/**
 * Project Service
 *
 * Business logic for project operations.
 */

import { TABLES, PROJECT_STATUS } from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { NotFoundError, DatabaseError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { CreateProjectRequest, UpdateProjectRequest, ProjectStatus } from '@/types/api';
import { Project } from '@/types/models';

const serviceLogger = logger.child({ service: 'project' });

/**
 * Create a new project
 */
export async function createProject(data: CreateProjectRequest): Promise<Project> {
  serviceLogger.info('Creating project', { name: data.name });

  const supabase = getServiceClient();
  const { data: project, error } = await supabase
    .from(TABLES.PROJECTS)
    .insert([
      {
        name: data.name,
        description: data.description || null,
        content_type: data.content_type,
        status: PROJECT_STATUS.DRAFT,
      },
    ])
    .select()
    .single();

  if (error) {
    serviceLogger.error('Failed to create project', { error: error.message });
    throw new DatabaseError(`Failed to create project: ${error.message}`);
  }

  serviceLogger.info('Project created', { id: project.id });
  return project;
}

/**
 * Get all projects with optional pagination
 */
export async function getProjects(options?: {
  page?: number;
  limit?: number;
  userId?: string;
}): Promise<{ projects: Project[]; total: number }> {
  const supabase = getServiceClient();
  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from(TABLES.PROJECTS)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.userId) {
    query = query.eq('user_id', options.userId);
  }

  const { data: projects, error, count } = await query;

  if (error) {
    serviceLogger.error('Failed to fetch projects', { error: error.message });
    throw new DatabaseError(`Failed to fetch projects: ${error.message}`);
  }

  return {
    projects: projects || [],
    total: count || 0,
  };
}

/**
 * Get project names by IDs (batch). Returns a Map of id -> name for existing projects.
 */
export async function getProjectNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }
  const supabase = getServiceClient();
  const unique = [...new Set(ids)];
  const { data, error } = await supabase.from(TABLES.PROJECTS).select('id, name').in('id', unique);
  if (error) {
    serviceLogger.warn('Failed to fetch project names', { error: error.message });
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of data || []) {
    if (row.id && row.name) {
      map.set(row.id, row.name);
    }
  }
  return map;
}

/**
 * Get a project by ID
 */
export async function getProjectById(id: string): Promise<Project> {
  const supabase = getServiceClient();
  const { data: project, error } = await supabase
    .from(TABLES.PROJECTS)
    .select('*')
    .eq('id', id)
    .single();

  if (error || !project) {
    throw new NotFoundError('Project', id);
  }

  return project;
}

/**
 * Update a project
 */
export async function updateProject(id: string, data: UpdateProjectRequest): Promise<Project> {
  serviceLogger.info('Updating project', { id, updates: Object.keys(data) });

  // Build update object with only provided fields
  const updates: Partial<Project> = {};
  if (data.name !== undefined) {
    updates.name = data.name;
  }
  if (data.description !== undefined) {
    updates.description = data.description;
  }
  if (data.status !== undefined) {
    updates.status = data.status;
  }
  updates.updated_at = new Date().toISOString();

  const supabase = getServiceClient();
  const { data: project, error } = await supabase
    .from(TABLES.PROJECTS)
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Project', id);
    }
    serviceLogger.error('Failed to update project', { id, error: error.message });
    throw new DatabaseError(`Failed to update project: ${error.message}`);
  }

  serviceLogger.info('Project updated', { id });
  return project;
}

/**
 * Update project status
 */
export async function updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
  serviceLogger.info('Updating project status', { id, status });

  const supabase = getServiceClient();
  const { error } = await supabase
    .from(TABLES.PROJECTS)
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    serviceLogger.error('Failed to update project status', { id, error: error.message });
    throw new DatabaseError(`Failed to update project status: ${error.message}`);
  }
}

/**
 * Delete a project
 */
export async function deleteProject(id: string): Promise<void> {
  serviceLogger.info('Deleting project', { id });

  const supabase = getServiceClient();
  const { error } = await supabase.from(TABLES.PROJECTS).delete().eq('id', id);

  if (error) {
    serviceLogger.error('Failed to delete project', { id, error: error.message });
    throw new DatabaseError(`Failed to delete project: ${error.message}`);
  }

  serviceLogger.info('Project deleted', { id });
}
