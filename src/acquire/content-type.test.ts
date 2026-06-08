import { describe, expect, it } from 'vitest';
import { detectContentType } from './content-type';

const encode = (s: string) => new TextEncoder().encode(s);

describe('detectContentType', () => {
  it('detects HTML from a text/html header', () => {
    expect(detectContentType('text/html; charset=utf-8', new Uint8Array())).toBe('html');
  });

  it('detects PDF from an application/pdf header', () => {
    expect(detectContentType('application/pdf', new Uint8Array())).toBe('pdf');
  });

  it('detects PDF from the %PDF magic when header is missing', () => {
    expect(detectContentType(null, encode('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('detects PNG from the magic when header is missing', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectContentType(null, png)).toBe('image-png');
  });

  it('detects JPEG from the magic when header is missing', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectContentType(null, jpeg)).toBe('image-jpeg');
  });

  it('detects HTML by sniffing the body when header is missing', () => {
    expect(detectContentType(null, encode('<!DOCTYPE html><html>...</html>'))).toBe('html');
    expect(detectContentType(null, encode('<html lang="en">...'))).toBe('html');
  });

  it('prefers a trustworthy header over byte sniffing', () => {
    // Header says HTML, bytes look like PDF, but header wins.
    expect(detectContentType('text/html', encode('%PDF-1.7'))).toBe('html');
  });

  it('returns "unknown" when neither header nor body classifies', () => {
    expect(detectContentType(null, encode('random plaintext that is not html'))).toBe('unknown');
    expect(detectContentType('application/octet-stream', new Uint8Array([0, 1, 2, 3]))).toBe(
      'unknown'
    );
  });
});
