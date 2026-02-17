/**
 * Response Helpers Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { parsePaginationParams, createPaginationMeta } from '@/lib/response';

describe('Response Helpers', () => {
  describe('parsePaginationParams', () => {
    it('should return defaults when no params provided', () => {
      const result = parsePaginationParams({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should parse page and limit from strings', () => {
      const result = parsePaginationParams({ page: '3', limit: '50' });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(100); // (3-1) * 50
    });

    it('should enforce minimum page of 1', () => {
      const result = parsePaginationParams({ page: '0' });

      expect(result.page).toBe(1);
    });

    it('should enforce maximum limit of 100', () => {
      const result = parsePaginationParams({ limit: '500' });

      expect(result.limit).toBe(100);
    });
  });

  describe('createPaginationMeta', () => {
    it('should calculate pagination metadata correctly', () => {
      const meta = createPaginationMeta(2, 10, 45);

      expect(meta.page).toBe(2);
      expect(meta.limit).toBe(10);
      expect(meta.total).toBe(45);
      expect(meta.totalPages).toBe(5);
      expect(meta.hasNext).toBe(true);
      expect(meta.hasPrev).toBe(true);
    });

    it('should handle first page', () => {
      const meta = createPaginationMeta(1, 10, 45);

      expect(meta.hasPrev).toBe(false);
      expect(meta.hasNext).toBe(true);
    });

    it('should handle last page', () => {
      const meta = createPaginationMeta(5, 10, 45);

      expect(meta.hasPrev).toBe(true);
      expect(meta.hasNext).toBe(false);
    });

    it('should handle single page', () => {
      const meta = createPaginationMeta(1, 10, 5);

      expect(meta.totalPages).toBe(1);
      expect(meta.hasPrev).toBe(false);
      expect(meta.hasNext).toBe(false);
    });
  });
});
