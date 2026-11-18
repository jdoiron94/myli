import sharp from 'sharp';

/** A plain image of `width` × `height` pixels, as a file of `format`, for upload tests. */
export function testImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c0784a' } })
    .toFormat(format)
    .toBuffer();
}
