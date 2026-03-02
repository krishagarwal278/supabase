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
const AUDIO_STORAGE_BUCKET = 'generated-audio';
const IMAGES_STORAGE_BUCKET = 'generated-images';

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
      fileSizeLimit: 50 * 1024 * 1024, // 50MB (some Supabase plans reject 100MB)
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
 * Ensure the images storage bucket exists (for slideshow images, etc.)
 */
async function ensureImagesBucketExists(): Promise<void> {
  const supabase = getServiceClient();
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.name === IMAGES_STORAGE_BUCKET);

  if (!bucketExists) {
    serviceLogger.info(`Creating storage bucket: ${IMAGES_STORAGE_BUCKET}`);
    const { error } = await supabase.storage.createBucket(IMAGES_STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024, // 5MB per image
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
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
 * Ensure the audio storage bucket exists (for TTS output)
 */
async function ensureAudioBucketExists(): Promise<void> {
  const supabase = getServiceClient();

  const { data: buckets } = await supabase.storage.listBuckets();

  const bucketExists = buckets?.some((b) => b.name === AUDIO_STORAGE_BUCKET);

  if (!bucketExists) {
    serviceLogger.info(`Creating storage bucket: ${AUDIO_STORAGE_BUCKET}`);
    const { error } = await supabase.storage.createBucket(AUDIO_STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB limit for audio
      allowedMimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav'],
    });

    if (error && !error.message.includes('already exists')) {
      throw new ExternalServiceError(
        'Supabase Storage',
        `Failed to create audio bucket: ${error.message}`
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
 * Download an image from URL and upload to Supabase Storage (images bucket).
 * Use for slideshow slide images (JPG/PNG) instead of the video bucket.
 */
export async function saveImageFromUrl(
  externalUrl: string,
  options: {
    userId?: string;
    filename?: string;
    folder?: string;
  } = {}
): Promise<{ storageUrl: string; storagePath: string }> {
  const { userId, filename, folder = 'slideshow-images' } = options;

  serviceLogger.info('Downloading image from URL', {
    url: externalUrl.substring(0, 80),
    userId,
  });

  try {
    await ensureImagesBucketExists();

    const response = await fetch(externalUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const finalFilename = filename || `${randomUUID()}.${ext}`;
    const storagePath = userId
      ? `${folder}/${userId}/${finalFilename}`
      : `${folder}/${finalFilename}`;

    const supabase = getServiceClient();
    const { error } = await supabase.storage
      .from(IMAGES_STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: contentType.split(';')[0].trim(), upsert: true });

    if (error) {
      throw new Error(`Failed to upload image: ${error.message}`);
    }

    const { data: urlData } = supabase.storage
      .from(IMAGES_STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    return { storageUrl: urlData.publicUrl, storagePath };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    serviceLogger.error('Failed to save image from URL', { error: msg });
    throw new ExternalServiceError('Storage', `Failed to save image: ${msg}`);
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

/**
 * Save TTS audio buffer to Supabase Storage and return public URL
 */
export async function saveAudioFromBuffer(
  buffer: Buffer | ArrayBuffer,
  options: {
    userId?: string;
    filename?: string;
    folder?: string;
    contentType?: string;
  } = {}
): Promise<{ storageUrl: string; storagePath: string }> {
  const { userId, filename, folder = 'tts', contentType = 'audio/mpeg' } = options;

  await ensureAudioBucketExists();

  const data = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : buffer;
  const extension = contentType.includes('mp4') ? 'mp4' : 'mp3';
  const finalFilename = filename || `${randomUUID()}.${extension}`;
  const storagePath = userId
    ? `${folder}/${userId}/${finalFilename}`
    : `${folder}/${finalFilename}`;

  const supabase = getServiceClient();
  const { error } = await supabase.storage
    .from(AUDIO_STORAGE_BUCKET)
    .upload(storagePath, data, { contentType, upsert: true });

  if (error) {
    throw new Error(`Failed to upload audio to storage: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(AUDIO_STORAGE_BUCKET).getPublicUrl(storagePath);

  serviceLogger.info('Audio saved to Supabase Storage', {
    storagePath,
    size: data.length,
  });

  return { storageUrl: urlData.publicUrl, storagePath };
}
