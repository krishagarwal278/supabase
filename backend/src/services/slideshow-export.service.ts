/**
 * Slideshow Export Service
 *
 * Exports slideshow data to PPTX or PDF for download.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import pptxgen from 'pptxgenjs';
import { logger } from '@/lib/logger';

export interface SlideDataExport {
  slideNumber: number;
  title: string;
  bulletPoints: string[];
  narration: string;
  visualDescription: string;
  imageUrl?: string;
  /** Optional key fact/number (e.g. for badge) */
  keyStat?: string;
  /** Optional secondary line under title (e.g. date, source) */
  subtitle?: string;
}

const serviceLogger = logger.child({ service: 'slideshow-export' });

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  const contentType = res.headers.get('content-type') || 'image/png';
  const mediaType = contentType.split(';')[0].trim();
  return `${mediaType};base64,${b64}`;
}

export async function exportToPptx(slides: SlideDataExport[], title: string): Promise<Buffer> {
  const pres = new pptxgen();
  pres.title = title;
  pres.author = 'Videaa';
  pres.subject = title;

  for (const slide of slides) {
    const pptSlide = pres.addSlide();
    const yTitle = 0.25;
    pptSlide.addText(slide.title, {
      x: 0.5,
      y: yTitle,
      w: slide.keyStat ? 7 : 9,
      h: 0.75,
      fontSize: 24,
      bold: true,
      color: '363636',
    });
    if (slide.keyStat) {
      pptSlide.addText(slide.keyStat, {
        x: 7.5,
        y: 0.3,
        w: 2,
        h: 0.5,
        fontSize: 12,
        color: '363636',
        align: 'right',
        fill: { color: 'E8E8E8' },
        shape: 'roundRect',
      });
    }
    let yBody = 1.15;
    if (slide.subtitle) {
      pptSlide.addText(slide.subtitle, {
        x: 0.5,
        y: 1.0,
        w: 9,
        h: 0.4,
        fontSize: 12,
        color: '606060',
      });
      yBody = 1.45;
    }
    const bulletText = slide.bulletPoints.map((b) => `• ${b}`).join('\n');
    pptSlide.addText(bulletText, {
      x: 0.5,
      y: yBody,
      w: 5.5,
      h: 4,
      fontSize: 14,
      color: '404040',
      valign: 'top',
    });
    if (slide.imageUrl && slide.imageUrl.startsWith('http')) {
      try {
        const data = await fetchImageAsBase64(slide.imageUrl);
        pptSlide.addImage({ data, x: 6.25, y: 1.0, w: 3.25, h: 3.75 });
      } catch (e) {
        serviceLogger.warn('Could not add slide image to PPTX', { slideNumber: slide.slideNumber });
      }
    }
    if (slide.narration) {
      pptSlide.addNotes(slide.narration);
    }
  }

  const output = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(output as ArrayBuffer);
}

export async function exportToPdf(slides: SlideDataExport[], _title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const contentWidth = pageWidth - 2 * margin;

  for (const slide of slides) {
    const page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin - 24;
    page.drawText(slide.title, {
      x: margin,
      y,
      size: 22,
      font: fontBold,
      color: rgb(0.21, 0.21, 0.21),
      maxWidth: contentWidth - (slide.keyStat ? 120 : 0),
    });
    if (slide.keyStat) {
      page.drawText(slide.keyStat, {
        x: contentWidth - 110 + margin,
        y: pageHeight - margin - 20,
        size: 11,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
    y -= 28;
    if (slide.subtitle) {
      page.drawText(slide.subtitle, {
        x: margin,
        y,
        size: 11,
        font,
        color: rgb(0.38, 0.38, 0.38),
        maxWidth: contentWidth,
      });
      y -= 22;
    }
    y -= 14;
    const lineHeight = 18;
    const fontSize = 12;
    for (const bullet of slide.bulletPoints) {
      const text = `• ${bullet}`;
      const lines = wrapText(text, contentWidth * 0.6, font, fontSize);
      for (const line of lines) {
        if (y < margin + 40) {
          break;
        }
        page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.25, 0.25, 0.25) });
        y -= lineHeight;
      }
    }
    if (slide.imageUrl && slide.imageUrl.startsWith('http') && y > margin + 120) {
      try {
        const res = await fetch(slide.imageUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const imageBytes = new Uint8Array(buf);
          const contentType = res.headers.get('content-type') || '';
          const image = contentType.includes('png')
            ? await doc.embedPng(imageBytes)
            : await doc.embedJpg(imageBytes);
          const imgW = Math.min(280, contentWidth * 0.45);
          const imgH = (image.height / image.width) * imgW;
          const imgY = Math.max(margin, y - imgH - 20);
          page.drawImage(image, {
            x: margin + contentWidth - imgW,
            y: imgY,
            width: imgW,
            height: imgH,
          });
        }
      } catch {
        serviceLogger.warn('Could not add slide image to PDF', { slideNumber: slide.slideNumber });
      }
    }
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

export type ExportFormat = 'pptx' | 'pdf';

export async function exportSlideshow(
  slides: SlideDataExport[],
  options: { title?: string; format: ExportFormat }
): Promise<{ buffer: Buffer; mimeType: string; fileExtension: string }> {
  const title = options.title || 'Presentation';
  const format = options.format;
  if (slides.length === 0) {
    throw new Error('No slides to export');
  }
  serviceLogger.info('Exporting slideshow', { slideCount: slides.length, format, title });

  if (format === 'pptx') {
    const buffer = await exportToPptx(slides, title);
    return {
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileExtension: 'pptx',
    };
  }
  const buffer = await exportToPdf(slides, title);
  return { buffer, mimeType: 'application/pdf', fileExtension: 'pdf' };
}
