/**
 * Document Extraction Service
 *
 * Extracts plain text from uploaded documents (DOCX, PDF, TXT) for use in
 * slideshow generation. Ensures the full document content is used so
 * slides are highly relevant to the source material.
 */

import mammoth from 'mammoth';
// pdf-parse v1 (Node-compatible); v2's pdfjs-dist crashes in ts-node
import pdfParse from 'pdf-parse';
import { logger } from '@/lib/logger';

const serviceLogger = logger.child({ service: 'document-extraction' });

const MIME_ALIASES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

export interface ExtractionResult {
  text: string;
  byteLength: number;
  format: 'docx' | 'pdf' | 'txt' | 'unknown';
}

/**
 * Extract full text from a document buffer.
 * Supports .docx (Word) and .txt. For DOCX, uses mammoth for maximum extraction.
 */
export async function extractTextFromDocument(
  buffer: Buffer,
  mimeType?: string
): Promise<ExtractionResult> {
  const normalizedMime = (mimeType || '').toLowerCase().split(';')[0].trim();
  const format = MIME_ALIASES[normalizedMime] || inferFormatFromBuffer(buffer);

  if (format === 'docx' || format === 'doc') {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    serviceLogger.info('Extracted text from DOCX', {
      byteLength: buffer.length,
      charLength: text.length,
      messagesCount: result.messages?.length ?? 0,
    });
    if (result.messages?.length) {
      serviceLogger.debug('Mammoth messages', {
        messages: result.messages.slice(0, 5).map((m) => m.message),
      });
    }
    return { text, byteLength: buffer.length, format: 'docx' };
  }

  if (format === 'pdf') {
    const data = await pdfParse(buffer);
    const text = (data?.text ?? '').trim();
    serviceLogger.info('Extracted text from PDF', {
      byteLength: buffer.length,
      charLength: text.length,
    });
    return { text, byteLength: buffer.length, format: 'pdf' };
  }

  if (format === 'txt') {
    const text = buffer.toString('utf-8').trim();
    serviceLogger.info('Extracted text from TXT', {
      byteLength: buffer.length,
      charLength: text.length,
    });
    return { text, byteLength: buffer.length, format: 'txt' };
  }

  throw new Error(
    `Unsupported document type: ${normalizedMime || 'unknown'}. Use .docx, .pdf, or .txt.`
  );
}

function inferFormatFromBuffer(buffer: Buffer): string {
  if (buffer.length < 4) {
    return 'unknown';
  }
  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }
  // DOCX is a ZIP; check PK magic bytes
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return 'docx';
  }
  return 'unknown';
}
