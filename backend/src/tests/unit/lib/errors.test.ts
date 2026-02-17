/**
 * Error Classes Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  DatabaseError,
  ExternalServiceError,
  isAppError,
  wrapError,
} from '@/lib/errors';

describe('Error Classes', () => {
  describe('ValidationError', () => {
    it('should create error with correct properties', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });

      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.isOperational).toBe(true);
      expect(error.details).toEqual({ field: 'email' });
    });
  });

  describe('NotFoundError', () => {
    it('should create error with resource and identifier', () => {
      const error = new NotFoundError('Project', '123');

      expect(error.message).toBe("Project with identifier '123' not found");
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should create error without identifier', () => {
      const error = new NotFoundError('User');

      expect(error.message).toBe('User not found');
    });
  });

  describe('AuthenticationError', () => {
    it('should have default message', () => {
      const error = new AuthenticationError();

      expect(error.message).toBe('Authentication required');
      expect(error.statusCode).toBe(401);
    });

    it('should accept custom message', () => {
      const error = new AuthenticationError('Token expired');

      expect(error.message).toBe('Token expired');
    });
  });

  describe('AuthorizationError', () => {
    it('should have correct status code', () => {
      const error = new AuthorizationError();

      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('AUTHORIZATION_ERROR');
    });
  });

  describe('DatabaseError', () => {
    it('should be operational error', () => {
      const error = new DatabaseError('Connection failed');

      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('ExternalServiceError', () => {
    it('should include service name in message', () => {
      const error = new ExternalServiceError('OpenAI', 'Rate limit exceeded');

      expect(error.message).toBe('OpenAI: Rate limit exceeded');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new ValidationError('test'))).toBe(true);
      expect(isAppError(new NotFoundError('test'))).toBe(true);
    });

    it('should return false for regular errors', () => {
      expect(isAppError(new Error('test'))).toBe(false);
      expect(isAppError('string')).toBe(false);
      expect(isAppError(null)).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('should return AppError unchanged', () => {
      const original = new ValidationError('test');
      const wrapped = wrapError(original);

      expect(wrapped).toBe(original);
    });

    it('should wrap regular Error', () => {
      const original = new Error('Something failed');
      const wrapped = wrapError(original);

      expect(wrapped.message).toBe('Something failed');
      expect(wrapped.statusCode).toBe(500);
    });

    it('should wrap string', () => {
      const wrapped = wrapError('string error');

      expect(wrapped.message).toBe('string error');
    });

    it('should use default message for unknown types', () => {
      const wrapped = wrapError(undefined, 'Default message');

      expect(wrapped.message).toBe('Default message');
    });
  });
});
