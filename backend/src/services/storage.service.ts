/**
 * Storage Service
 *
 * Handles file uploads to Supabase Storage, including
 * downloading external URLs and re-uploading to persistent storage.
 */

import { randomUUID } from 'crypto';
import { getServiceClient } from '@/lib/database';
import { ExternalServiceError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const serviceLogger = logger.child({ service: 'storage' });

const STORAGE_BUCKET = 'generated-videos';

/**
 * Ensure the storage bucket exists
 */
async function ensureBucketExists(): Promise<void> {
  const supabase = getServiceClient();

  const { data: buckets } = await supabase.storage.listBuckets();

  const bucketExists = buckets?.some((b) => b.name === STORAGE_BUCKET);

  if (!bucketExists) {
    serviceLogger.info(`Creating storage bucket: ${STORAGE_BUCKET}`);
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 100 * 1024 * 1024, // 100MB limit
      allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    });

    if (error && !error.message.includes('already exists')) {
      throw new ExternalServiceError(
        'Supabase Storage',
        `Failed to create bucket: ${error.message}`
      );
    }
  }
}

/**
 * Download a video from an external URL and upload to Supabase Storage
 * Returns the persistent Supabase Storage URL
 */
export async function saveVideoFromUrl(
  externalUrl: string,
  options: {
    userId?: string;
    filename?: string;
    folder?: string;
  } = {}
): Promise<{
  storageUrl: string;
  storagePath: string;
}> {
  const { userId, filename, folder = 'test-videos' } = options;

  serviceLogger.info('Downloading video from external URL', {
    url: externalUrl.substring(0, 100),
    userId,
  });

  try {
    // Ensure bucket exists
    await ensureBucketExists();

    // Download the video from the external URL
    const response = await fetch(externalUrl);

    if (!response.ok) {
      throw new Error(`Failed to download video: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const videoBuffer = await response.arrayBuffer();

    serviceLogger.debug('Video downloaded', {
      size: videoBuffer.byteLength,
      contentType,
    });

    // Generate a unique filename
    const extension = contentType.includes('webm') ? 'webm' : 'mp4';
    const finalFilename = filename || `${randomUUID()}.${extension}`;
    const storagePath = userId
      ? `${folder}/${userId}/${finalFilename}`
      : `${folder}/${finalFilename}`;

    // Upload to Supabase Storage
    const supabase = getServiceClient();
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, videoBuffer, {
      contentType,
      upsert: true,
    });

    if (error) {
      throw new Error(`Failed to upload to storage: ${error.message}`);
    }

    // Get the public URL
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

    const storageUrl = urlData.publicUrl;

    serviceLogger.info('Video saved to Supabase Storage', {
      storagePath,
      storageUrl,
      size: videoBuffer.byteLength,
    });

    return {
      storageUrl,
      storagePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceLogger.error('Failed to save video from URL', { error: errorMessage });
    throw new ExternalServiceError('Storage', `Failed to save video: ${errorMessage}`);
  }
}

/**
 * Delete a video from Supabase Storage
 */
export async function deleteVideo(storagePath: string): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);

  if (error) {
    serviceLogger.warn('Failed to delete video', { storagePath, error: error.message });
  }
}

/**
 * Get public URL for a storage path
 */
export function getPublicUrl(storagePath: string): string {
  const supabase = getServiceClient();
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

  return data.publicUrl;
}
