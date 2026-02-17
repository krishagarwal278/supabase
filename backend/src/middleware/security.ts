/**
 * Security Middleware
 *
 * Security headers and protections for the API.
 */

import { Request, Response, NextFunction } from 'express';
import { getEnv } from '@/config/env';

/**
 * CORS configuration
 */
export interface CorsOptions {
  origin: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Default CORS options
 */
function getDefaultCorsOptions(): CorsOptions {
  const env = getEnv();
  const origin = env.CORS_ORIGIN;

  return {
    origin: origin === '*' ? true : origin.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    credentials: true,
    maxAge: 86400, // 24 hours
  };
}

/**
 * Security headers middleware
 *
 * Adds various security headers to protect against common attacks.
 * Similar to Helmet.js functionality.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS Protection (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');

  next();
}

/**
 * CORS middleware
 */
export function cors(options?: Partial<CorsOptions>) {
  const opts = { ...getDefaultCorsOptions(), ...options };

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Handle origin
    if (opts.origin === true) {
      // Allow all origins
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else if (typeof opts.origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', opts.origin);
    } else if (Array.isArray(opts.origin) && origin) {
      if (opts.origin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    }

    // Handle credentials
    if (opts.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Expose headers
    if (opts.exposedHeaders?.length) {
      res.setHeader('Access-Control-Expose-Headers', opts.exposedHeaders.join(', '));
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      if (opts.methods?.length) {
        res.setHeader('Access-Control-Allow-Methods', opts.methods.join(', '));
      }
      if (opts.allowedHeaders?.length) {
        res.setHeader('Access-Control-Allow-Headers', opts.allowedHeaders.join(', '));
      }
      if (opts.maxAge) {
        res.setHeader('Access-Control-Max-Age', String(opts.maxAge));
      }
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Simple rate limiting middleware
 *
 * Implements a sliding window rate limiter using in-memory storage.
 * For production, consider using Redis-based rate limiting.
 */
export function rateLimit(options?: { windowMs?: number; maxRequests?: number }) {
  const env = getEnv();
  const windowMs = options?.windowMs || env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options?.maxRequests || env.RATE_LIMIT_MAX_REQUESTS;

  // In-memory store (use Redis in production for distributed systems)
  const requests = new Map<string, { count: number; resetTime: number }>();

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of requests.entries()) {
      if (value.resetTime < now) {
        requests.delete(key);
      }
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const record = requests.get(key);

    if (!record || record.resetTime < now) {
      // New window
      requests.set(key, { count: 1, resetTime: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
      next();
      return;
    }

    if (record.count >= maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
          details: { retryAfter },
        },
      });
      return;
    }

    // Increment count
    record.count++;
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));
    next();
  };
}
