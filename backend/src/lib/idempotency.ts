/**
 * In-memory idempotency cache for credit-consuming endpoints.
 * Prevents duplicate processing when the client retries (e.g. after navigation/refresh).
 * Keys expire after IDEMPOTENCY_TTL_MS to avoid unbounded growth.
 */

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PROCESSING_TTL_MS = 10 * 60 * 1000; // 10 min max for in-flight

interface Entry {
  status: 'processing' | 'completed' | 'failed';
  response?: unknown;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

export function getIdempotentResponse<T>(
  key: string
): { status: 'processing' } | { status: 'completed' | 'failed'; response: T } | null {
  prune();
  const entry = cache.get(key) as Entry | undefined;
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  if (entry.status === 'processing') {
    return { status: 'processing' };
  }
  return { status: entry.status as 'completed' | 'failed', response: entry.response as T };
}

export function setIdempotentResponse(
  key: string,
  status: 'completed' | 'failed',
  response: unknown
): void {
  prune();
  cache.set(key, {
    status,
    response,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

/** Mark that we are processing this key. Returns false if key already exists (duplicate request). */
export function setIdempotentProcessing(key: string): boolean {
  prune();
  if (cache.has(key)) {
    return false;
  }
  cache.set(key, {
    status: 'processing',
    expiresAt: Date.now() + PROCESSING_TTL_MS,
  });
  return true;
}
