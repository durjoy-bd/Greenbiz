import { ApiError } from './errors';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Accepts only a base64 JPEG, PNG or WebP data URL whose bytes really are that format. */
export function parseImageDataUrl(value: string, maxBytes: number): { type: ImageType; bytes: Buffer } {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new ApiError(400, 'Use a JPEG, PNG or WebP data URL. External image URLs are not allowed.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxBytes || bytes.length < 12 || bytes.toString('base64') !== match[2]) throw new ApiError(400, `Image must be valid base64 and at most ${Math.round(maxBytes / 1024)} KB.`);
  const kind = match[1];
  const valid =
    kind === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : kind === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new ApiError(400, 'The image format does not match its declared type.');
  return { type: `image/${kind}` as ImageType, bytes };
}
export const dataUrl = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
