import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachDefaultImages, getStoredImage, imageDataUri, readImage, storeImage } from '../src/lib/images';
import { createFixtureStory } from '../src/lib/fixture';
import { DEFAULT_BRIEF, newRun } from '../src/lib/run';
import type { ImageAsset } from '../src/lib/types';
import { chromium } from 'playwright';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const metadata = { placeId: 'pangyo-museum', kind: 'upload' as const, sourceUrl: '', author: '촬영자', license: '사용 권한 확인', licenseUrl: '' };
let folder: string;
let original: string | undefined;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'timestory-images-')); original = process.env.TIMESTORY_IMAGE_DIR; process.env.TIMESTORY_IMAGE_DIR = folder; });
afterEach(async () => { if (original === undefined) delete process.env.TIMESTORY_IMAGE_DIR; else process.env.TIMESTORY_IMAGE_DIR = original; await rm(folder, { recursive: true, force: true }); });

describe('image asset boundary', () => {
  it('decodes a raster, removes trailing payload and persists place-bound metadata with a verified hash', async () => {
    const input = Buffer.concat([PNG, Buffer.from('<script>injected()</script>')]);
    const asset = await storeImage(input, metadata);
    const bytes = await readImage(asset);
    expect(Buffer.from(bytes).includes(Buffer.from('<script>'))).toBe(false);
    expect(asset).toMatchObject({ width: 1, height: 1, mime: 'image/png', kind: 'upload', placeId: 'pangyo-museum' });
    expect(asset.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(asset.src).toBe(`/api/images/${asset.id}`);
    expect(await getStoredImage(asset.id)).toEqual(asset);
    expect(await imageDataUri(asset)).toMatch(/^data:image\/png;base64,/);
    const other = await storeImage(PNG, { ...metadata, placeId: 'yuldong-park' });
    expect(other.id).not.toBe(asset.id);
    expect((await getStoredImage(asset.id)).placeId).toBe('pangyo-museum');
  }, 60000);

  it.each([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('https://example.org/photo.jpg'), Buffer.from('GIF89a')])('rejects non-raster allowed-format input %#', async bytes => {
    await expect(storeImage(bytes, metadata)).rejects.toThrow(/PNG|JPEG|WebP|형식/);
  });

  it('rejects oversized bytes and raster decompression bombs before decoding', async () => {
    await expect(storeImage(new Uint8Array(8 * 1024 * 1024 + 1), metadata)).rejects.toThrow(/8MB|크기/);
    const giant = Buffer.from(PNG); giant.writeUInt32BE(100000, 16); giant.writeUInt32BE(100000, 20);
    await expect(storeImage(giant, metadata)).rejects.toThrow(/해상도|픽셀/);
  });

  it('rejects file path escapes, external URLs and unsafe manifest IDs', async () => {
    const fake = { id: 'fake', placeId: 'pangyo-museum', kind: 'photo', src: '/places/../secret.png', sha256: 'a'.repeat(64), width: 1, height: 1, mime: 'image/png', sourceUrl: '', author: 'author', license: 'license', licenseUrl: '', createdAt: '2026-09-13T00:00:00Z' } as ImageAsset;
    for (const src of ['/places/../secret.png', '/places/%2e%2e/secret.png', 'https://example.org/image.png', '/api/images/../../secret'])
      await expect(readImage({ ...fake, src })).rejects.toThrow(/경로|주소|자산/);
    await expect(getStoredImage('../secret')).rejects.toThrow(/ID|경로/);
  });

  it('detects tampered stored bytes and inconsistent MIME metadata', async () => {
    const asset = await storeImage(PNG, metadata);
    await expect(readImage({ ...asset, mime: 'image/jpeg' })).rejects.toThrow(/MIME|형식/);
    const bytes = await readFile(join(folder, `${asset.id}.png`));
    await writeFile(join(folder, `${asset.id}.png`), Buffer.concat([bytes, Buffer.from('tamper')]));
    await expect(readImage(asset)).rejects.toThrow(/해시|SHA/);
  }, 60000);

  it('honors cancellation and rejects missing ownership metadata', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(storeImage(PNG, metadata, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(storeImage(PNG, { ...metadata, license: '' })).rejects.toThrow(/권리|라이선스|출처/);
  });

  it('normalizes real JPEG and WebP rasters to PNG with their decoded dimensions', async () => {
    const browser = await chromium.launch({ headless: true });
    let rasters: string[];
    try { const page = await browser.newPage(); rasters = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 127; canvas.height = 89; const context = canvas.getContext('2d')!; context.fillStyle = '#244cc5'; context.fillRect(0, 0, 127, 89); return ['image/jpeg', 'image/webp'].map(mime => canvas.toDataURL(mime).split(',')[1]); }); }
    finally { await browser.close(); }
    for (const encoded of rasters) {
      const asset = await storeImage(Buffer.from(encoded, 'base64'), metadata);
      expect(asset).toMatchObject({ width: 127, height: 89, mime: 'image/png' });
      expect(Buffer.from(await readImage(asset)).subarray(1, 4).toString()).toBe('PNG');
    }
  }, 60000);

  it('persists reference copyright metadata independently and refuses a different place reference', async () => {
    const reference = { id: 'photo-pangyo-museum', placeId: 'pangyo-museum', sha256: 'b'.repeat(64), sourceUrl: 'https://example.org/photo', author: '원저작자', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
    const asset = await storeImage(PNG, { ...metadata, kind: 'ai', reference });
    expect((await getStoredImage(asset.id)).reference).toEqual(reference);
    await expect(storeImage(PNG, { ...metadata, kind: 'ai', reference: { ...reference, placeId: 'yuldong-park' } })).rejects.toThrow(/참조.*장소/);
  }, 60000);

  it('gives original and expanded place cards their registered photos', async () => {
    const run = newRun({ mode: 'fixture' }); Object.assign(run, createFixtureStory(run), { version: 1 });
    run.revisions.push({ version: 1, createdAt: run.createdAt, cards: structuredClone(run.cards), claims: [], reason: '초안' });
    expect(await attachDefaultImages(run)).toBe(true);
    expect(run.cards.map(card => card.image?.src)).toEqual(Array(4).fill('/places/pangyo-museum.jpg'));
    expect(run.revisions[0].cards).toEqual(run.cards);
    expect(await attachDefaultImages(run)).toBe(false);
    const expandedRun = newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: 'korea-jobworld', place: '한국잡월드' } }); Object.assign(expandedRun, createFixtureStory(expandedRun));
    expect(await attachDefaultImages(expandedRun)).toBe(true);
    expect(expandedRun.cards.map(card => card.image?.src)).toEqual(Array(4).fill('/places/korea-jobworld.jpg'));
  });
});
