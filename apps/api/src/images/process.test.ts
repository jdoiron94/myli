import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_PIXELS, processImage, sniffImageType, variantWidths } from './process.ts';
import { testImage } from './testing.ts';

async function processed(bytes: Uint8Array) {
  const result = await processImage(bytes);
  if (!result.ok) throw new Error(`expected an image, got ${result.problem}`);
  return result.image;
}

describe('sniffImageType', () => {
  it('knows a JPEG, PNG or WebP by its first bytes, and nothing else', async () => {
    const files = {
      jpeg: await testImage(10, 10, 'jpeg'),
      png: await testImage(10, 10, 'png'),
      webp: await testImage(10, 10, 'webp'),
      nothing: new Uint8Array(),
      text: new TextEncoder().encode('just some text'),
      gif: new TextEncoder().encode('GIF89a......'),
      'a RIFF that isn’t WebP': new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '),
    };

    expect(
      Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [name, sniffImageType(bytes) ?? null]),
      ),
    ).toEqual({
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      nothing: null,
      text: null,
      gif: null,
      'a RIFF that isn’t WebP': null,
    });
  });
});

describe('variantWidths', () => {
  it('serves each width up to the image’s own, and the image’s own if it’s narrower', () => {
    const widths = [4000, 2048, 1600, 800, 640, 300];
    expect(Object.fromEntries(widths.map((width) => [width, variantWidths(width)]))).toEqual({
      4000: [640, 1280, 2048],
      2048: [640, 1280, 2048],
      1600: [640, 1280, 1600],
      800: [640, 800],
      640: [640],
      300: [300],
    });
  });
});

describe('processImage', () => {
  it('resizes an image to each width, as WebP, keeping its shape', async () => {
    const image = await processed(await testImage(1600, 1200, 'jpeg'));

    expect(image.type).toBe('image/jpeg');
    expect({ width: image.width, height: image.height }).toEqual({ width: 1600, height: 1200 });
    expect(image.variants.map(({ width, height }) => [width, height])).toEqual([
      [640, 480],
      [1280, 960],
      [1600, 1200],
    ]);
    for (const variant of image.variants) {
      const metadata = await sharp(variant.bytes).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual([
        'webp',
        variant.width,
        variant.height,
      ]);
    }
  });

  it('turns a photo upright, and keeps none of its metadata', async () => {
    // As a phone writes it: stored sideways, with an orientation tag saying how to turn it, and
    // where it was taken.
    const sideways = await sharp(await testImage(1200, 800))
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: 'A. Baker' }, IFD3: { GPSLatitudeRef: 'N' } })
      .withIccProfile('p3')
      .jpeg()
      .toBuffer();
    const tagged = await sharp(sideways).metadata();
    expect([tagged.orientation, tagged.exif?.includes('A. Baker'), tagged.icc]).toEqual([
      6,
      true,
      expect.anything(),
    ]);

    const image = await processed(sideways);

    expect({ width: image.width, height: image.height }).toEqual({ width: 800, height: 1200 });
    expect(image.variants.map(({ width, height }) => [width, height])).toEqual([
      [640, 960],
      [800, 1200],
    ]);
    for (const variant of image.variants) {
      const metadata = await sharp(variant.bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it('refuses a file that isn’t a JPEG, PNG or WebP, whatever it’s called', async () => {
    const gif = await sharp(await testImage(10, 10))
      .gif()
      .toBuffer();

    expect(await processImage(gif)).toEqual({ ok: false, problem: 'not-an-image' });
    expect(await processImage(new TextEncoder().encode('%PDF-1.7'))).toEqual({
      ok: false,
      problem: 'not-an-image',
    });
  });

  it('refuses a file that starts like an image but can’t be read', async () => {
    const jpeg = await testImage(800, 600);

    expect(await processImage(jpeg.subarray(0, 200))).toEqual({
      ok: false,
      problem: 'unreadable',
    });
    expect(await processImage(Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 3]))).toEqual({
      ok: false,
      problem: 'unreadable',
    });
  });

  it('refuses more pixels than it can decode, from the header alone', async () => {
    // A PNG of one color compresses to a few kilobytes, however many pixels it has.
    const side = Math.ceil(Math.sqrt(MAX_PIXELS)) + 1;
    const huge = await sharp({
      create: { width: side, height: side, channels: 3, background: 'white' },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.byteLength).toBeLessThan(1024 * 1024);

    expect(await processImage(huge)).toEqual({ ok: false, problem: 'too-many-pixels' });
  });
});
