import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { CardImage, ImageAsset, ImagePrompt } from './types';

type Metadata = { placeId: string; kind: 'upload' | 'ai'; sourceUrl: string; author: string; license: string; licenseUrl: string; prompt?: ImagePrompt; reference?: ImageAsset['reference'] };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const safeId = /^[a-zA-Z0-9_-]{1,80}$/;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const imageRoot = () => resolve(process.env.TIMESTORY_IMAGE_DIR || 'data/images');

function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS)
    throw new Error('이미지 해상도는 1픽셀 이상, 총 2천만 픽셀 이하여야 합니다.');
  return { width, height };
}

// Read dimensions before browser decoding to reject compressed raster bombs.
function inspect(bytes: Uint8Array): { mime: ImageAsset['mime']; width: number; height: number } {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('이미지 파일 크기는 최대 8MB입니다.');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR')
    return { mime: 'image/png', ...dimensions(data.readUInt32BE(16), data.readUInt32BE(20)) };
  if (data.length >= 12 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 0xff) break;
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8)
        return { mime: 'image/jpeg', ...dimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)) };
      offset += length;
    }
  }
  if (data.length >= 25 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const type = data.toString('ascii', 12, 16);
    if (type === 'VP8X' && data.length >= 30) return { mime: 'image/webp', ...dimensions(1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)) };
    if (type === 'VP8 ' && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a)
      return { mime: 'image/webp', ...dimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff) };
    if (type === 'VP8L' && data[20] === 0x2f) {
      const packed = data.readUInt32LE(21);
      return { mime: 'image/webp', ...dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1) };
    }
  }
  throw new Error('정상적인 PNG, JPEG, WebP 이미지 형식만 사용할 수 있습니다.');
}

function checkMetadata(metadata: Metadata | ImageAsset) {
  if (typeof metadata.placeId !== 'string' || !safeId.test(metadata.placeId) || !['photo', 'upload', 'ai'].includes(metadata.kind)) throw new Error('이미지 장소 또는 자산 종류가 올바르지 않습니다.');
  if (typeof metadata.author !== 'string' || !metadata.author.trim() || metadata.author.length > 500 ||
      typeof metadata.license !== 'string' || !metadata.license.trim() || metadata.license.length > 500)
    throw new Error('이미지 출처와 사용 권리(라이선스)를 입력해야 합니다.');
  for (const value of [metadata.sourceUrl, metadata.licenseUrl]) if (typeof value !== 'string' || value.length > 2048) throw new Error('이미지 출처 주소가 너무 깁니다.');
  if (metadata.prompt && JSON.stringify(metadata.prompt).length > 12000) throw new Error('이미지 생성 프롬프트가 너무 깁니다.');
  if (metadata.reference) {
    const reference = metadata.reference;
    if (!safeId.test(reference.id) || !safeId.test(reference.placeId) || !/^[a-f0-9]{64}$/.test(reference.sha256) || reference.placeId !== metadata.placeId)
      throw new Error('참조 이미지의 장소 또는 해시가 올바르지 않습니다.');
    for (const value of [reference.author, reference.license, reference.sourceUrl, reference.licenseUrl])
      if (typeof value !== 'string' || value.length > 2048) throw new Error('참조 이미지 출처 메타데이터가 올바르지 않습니다.');
  }
}

async function safeRead(root: string, name: string, limit = MAX_BYTES): Promise<Uint8Array> {
  const base = await realpath(root);
  const path = resolve(root, name);
  const canonical = await realpath(path);
  if (!canonical.startsWith(base + sep)) throw new Error('허용되지 않은 이미지 파일 경로입니다.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw new Error('이미지 파일 크기는 최대 8MB입니다.');
    const bytes = await file.readFile();
    if (bytes.length > limit) throw new Error('이미지 파일 크기 상한을 초과했습니다.');
    return bytes;
  } finally { await file.close(); }
}

export async function readImage(asset: ImageAsset): Promise<Uint8Array> {
  let root: string;
  let name: string;
  const photo = /^\/places\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(?:jpe?g|png|webp))$/.exec(asset.src);
  const stored = /^\/api\/images\/([a-zA-Z0-9_-]{1,80})$/.exec(asset.src);
  if (photo && asset.kind === 'photo') { root = resolve('public/places'); name = photo[1]; }
  else if (stored && asset.kind !== 'photo' && stored[1] === asset.id) { root = imageRoot(); name = `${stored[1]}.png`; }
  else throw new Error('허용되지 않은 이미지 자산 경로입니다.');
  checkMetadata(asset);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('이미지 SHA256 해시가 올바르지 않습니다.');
  const bytes = await safeRead(root, name);
  if (digest(bytes) !== asset.sha256) throw new Error('이미지 SHA256 해시가 일치하지 않습니다.');
  const actual = inspect(bytes);
  if (actual.mime !== asset.mime) throw new Error('이미지 MIME 형식이 메타데이터와 다릅니다.');
  if (actual.width !== asset.width || actual.height !== asset.height) throw new Error('이미지 해상도가 메타데이터와 다릅니다.');
  return bytes;
}

export async function imageDataUri(asset: ImageAsset): Promise<string> {
  return `data:${asset.mime};base64,${Buffer.from(await readImage(asset)).toString('base64')}`;
}

export async function getStoredImage(assetId: string): Promise<ImageAsset> {
  if (typeof assetId !== 'string' || !safeId.test(assetId)) throw new Error('이미지 ID 또는 경로가 올바르지 않습니다.');
  const raw: unknown = JSON.parse(Buffer.from(await safeRead(imageRoot(), `${assetId}.json`, 32000)).toString('utf8'));
  if (!raw || typeof raw !== 'object') throw new Error('이미지 메타데이터가 올바르지 않습니다.');
  const asset = raw as ImageAsset;
  if (asset.id !== assetId || asset.src !== `/api/images/${assetId}` || !['upload', 'ai'].includes(asset.kind)) throw new Error('이미지 자산 ID가 일치하지 않습니다.');
  await readImage(asset);
  return asset;
}

export async function storeImage(bytes: Uint8Array, metadata: Metadata, signal = new AbortController().signal): Promise<ImageAsset> {
  signal.throwIfAborted();
  checkMetadata(metadata);
  if (!['upload', 'ai'].includes(metadata.kind)) throw new Error('저장 가능한 이미지 자산 종류가 아닙니다.');
  const original = inspect(bytes);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let browser: Browser | undefined;
  const closeBrowser = () => { void browser?.close().catch(() => {}); };
  bounded.addEventListener('abort', closeBrowser, { once: true });
  const id = randomUUID();
  const root = imageRoot();
  let wroteImage = false;
  try {
    browser = await chromium.launch({ headless: true });
    bounded.throwIfAborted();
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:">');
    const encoded = await page.evaluate(async ({ data, mime, maxPixels }) => {
      const decoded = await createImageBitmap(new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: mime }));
      try {
        if (decoded.width < 1 || decoded.height < 1 || decoded.width * decoded.height > maxPixels) throw new Error('이미지 해상도 상한 초과');
        const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('이미지 변환을 시작할 수 없습니다.');
        context.drawImage(decoded, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      } finally { decoded.close(); }
    }, { data: Buffer.from(bytes).toString('base64'), mime: original.mime, maxPixels: MAX_PIXELS });
    bounded.throwIfAborted();
    const normalized = Buffer.from(encoded, 'base64');
    const raster = inspect(normalized);
    const asset: ImageAsset = { ...structuredClone(metadata), id, src: `/api/images/${id}`, sha256: digest(normalized), width: raster.width, height: raster.height, mime: 'image/png', createdAt: new Date().toISOString() };
    await mkdir(root, { recursive: true });
    wroteImage = true;
    await writeFile(resolve(root, `${id}.png`), normalized, { flag: 'wx', signal: bounded });
    await writeFile(resolve(root, `${id}.json`), JSON.stringify(asset, null, 2), { flag: 'wx', signal: bounded });
    bounded.throwIfAborted();
    return asset;
  } catch (error) {
    if (wroteImage) await Promise.all([rm(resolve(root, `${id}.png`), { force: true }), rm(resolve(root, `${id}.json`), { force: true })]);
    bounded.throwIfAborted();
    if (error instanceof Error && /could not be decoded|InvalidStateError|ImageBitmap/.test(error.message))
      throw new Error('이미지를 디코딩할 수 없습니다. 정상적인 PNG, JPEG, WebP 파일을 선택해 주세요.');
    throw error;
  } finally {
    bounded.removeEventListener('abort', closeBrowser);
    await browser?.close();
  }
}

export async function defaultPlaceImage(placeIdOrName: string): Promise<CardImage | undefined> {
  const { getPlace } = await import('./places');
  const place = getPlace(placeIdOrName);
  if (!place?.photo) return undefined;
  const photo = place.photo;
  const match = /^\/places\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(?:jpe?g|png|webp))$/.exec(photo.src);
  if (!match) throw new Error('기본 사진 자산 경로가 올바르지 않습니다.');
  const bytes = await safeRead(resolve('public/places'), match[1]);
  const raster = inspect(bytes);
  return { id: `photo-${place.id}`, placeId: place.id, kind: 'photo', src: photo.src, sha256: digest(bytes), ...raster, sourceUrl: photo.sourceUrl, author: photo.author, license: photo.license, licenseUrl: photo.licenseUrl, createdAt: '2026-09-13T00:00:00.000Z', crop: { x: 0.5, y: 0.5, zoom: 1 } };
}
