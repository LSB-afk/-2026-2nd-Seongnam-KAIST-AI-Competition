import { getPlace, type Place } from './places';

export const DETECTIVE_STORAGE_KEY = 'timestory.city-detective.v1';
export const MEMORY_STORAGE_KEY = 'timestory.city-memories.v1';
export const MAX_MEMORY_STORAGE_CHARS = 600_000;
export const MAX_MEMORY_PHOTO_CHARS = 180_000;
export const MAX_MEMORY_TEXT = 400;
const MAX_MEMORIES = 20;

export type LocalStorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type LocalRecords<T> = { records: T[]; error: string | null };
export type LocalSaveResult = { ok: boolean; error: string | null };
export type DetectiveCompletion = { questId: string; placeId: string; quoteText: string; sourceUrl: string; completedAt: string };
export type DetectiveQuest = {
  id: string; placeId: string; question: string; hint: string; answerIndex: number;
  options: { index: number; text: string; sourceUrl: string }[];
};
export type MemoryPhoto = { dataUrl: string; width: number; height: number };
export type CityMemory = {
  id: string; placeId: string; text: string; createdAt: string;
  consented: boolean; rightsConfirmed: boolean; reviewedAt: string | null;
  status: 'draft' | 'reviewed' | 'withdrawn'; photo: MemoryPhoto | null;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const validTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const safeSource = (value: string) => /^https:\/\//.test(value);

const QUEST_SEEDS: Record<string, { answerIndex: number; contains: string; question: string; hint: string }> = {
  'pangyo-museum': { answerIndex: 0, contains: '30분', question: '박물관에 마지막으로 입장할 수 있는 때를 알려주는 근거는 무엇일까요?', hint: '휴관 요일이나 주소 대신, 관람 종료 전 남은 시간을 말하는 문장을 찾아보세요.' },
  'central-park': { answerIndex: 1, contains: '수내동가옥', question: '중앙공원에서 만날 수 있는 문화유산의 이름을 찾아보세요.', hint: '공원의 경치나 주소 대신, 이름에 ‘가옥’이 들어간 문화유산을 찾아보세요.' },
  'moran-market': { answerIndex: 1, contains: '4일과 9일', question: '모란민속5일장의 장날을 알 수 있는 근거는 무엇일까요?', hint: '지명의 유래와 주소는 장날을 알려주지 않아요. 날짜 끝자리를 찾아보세요.' },
  'yuldong-park': { answerIndex: 0, contains: '자연호수', question: '율동공원이 어떤 자연환경을 살려 만들어졌는지 알려주는 근거를 골라보세요.', hint: '기념탑이나 주소 대신, 호수와 주변 자연을 설명한 문장을 찾아보세요.' },
  'bongguksa': { answerIndex: 0, contains: '1028년', question: '봉국사를 처음 세운 때를 알려주는 기록을 골라보세요.', hint: '대광명전의 건축 양식이나 주소가 아니라, 창건 연도가 적힌 문장을 살펴보세요.' },
};

export function getDetectiveQuest(place: Place): DetectiveQuest | null {
  const seed = QUEST_SEEDS[place.id];
  if (!seed || place.officialQuotes.length < 3 || !place.officialQuotes[seed.answerIndex]?.text.includes(seed.contains)) return null;
  if (place.officialQuotes.some((quote) => !safeSource(quote.sourceUrl))) return null;
  return {
    id: `evidence-${place.id}-v1`, placeId: place.id, question: seed.question, hint: seed.hint, answerIndex: seed.answerIndex,
    options: [2, 0, 1].map((index) => ({ index, ...place.officialQuotes[index] })),
  };
}

function validCompletion(value: unknown): DetectiveCompletion | null {
  const raw = record(value);
  const place = typeof raw.placeId === 'string' ? getPlace(raw.placeId) : null;
  const quest = place ? getDetectiveQuest(place) : null;
  const quote = place && quest ? place.officialQuotes[quest.answerIndex] : null;
  return place && quest && quote && raw.questId === quest.id && raw.quoteText === quote.text && raw.sourceUrl === quote.sourceUrl && validTime(raw.completedAt)
    ? { questId: quest.id, placeId: place.id, quoteText: quote.text, sourceUrl: quote.sourceUrl, completedAt: raw.completedAt } : null;
}

function decodeRecords<T>(raw: string | null, limit: number, validate: (value: unknown) => T | null, maxCount: number): LocalRecords<T> {
  if (!raw) return { records: [], error: null };
  try {
    if (raw.length > limit) throw new Error('size');
    const value = record(JSON.parse(raw));
    if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > maxCount) throw new Error('shape');
    const records = value.records.map(validate).filter((item): item is T => item !== null);
    return { records, error: records.length === value.records.length ? null : '저장된 자료 일부를 읽지 못해 제외했어요.' };
  } catch { return { records: [], error: '저장된 자료를 읽지 못했어요. 새 자료를 저장하기 전에 이 브라우저의 저장 상태를 확인해 주세요.' }; }
}

export function decodeDetectiveProgress(raw: string | null): LocalRecords<DetectiveCompletion> {
  const decoded = decodeRecords(raw, 30_000, validCompletion, 20);
  return { ...decoded, records: decoded.records.filter((item, index, items) => items.findIndex((other) => other.questId === item.questId) === index) };
}

export function answerDetectiveQuest(progress: DetectiveCompletion[], placeId: string, index: number, now: string) {
  const place = getPlace(placeId), quest = place ? getDetectiveQuest(place) : null;
  const clean = progress.map(validCompletion).filter((item): item is DetectiveCompletion => item !== null);
  if (!place || !quest || !validTime(now)) return { correct: false, progress: clean, message: '이 장소의 확인 가능한 문제를 먼저 선택해 주세요.' };
  if (index !== quest.answerIndex) return { correct: false, progress: clean, message: quest.hint };
  const quote = place.officialQuotes[index];
  const completion = { questId: quest.id, placeId: place.id, quoteText: quote.text, sourceUrl: quote.sourceUrl, completedAt: now };
  return {
    correct: true,
    progress: clean.some((item) => item.questId === quest.id) ? clean : [...clean, completion],
    message: '근거를 찾았어요! 확인한 문장과 출처를 탐험 보고서에 기록했어요.',
  };
}

export function detectiveReport(progress: DetectiveCompletion[]): string {
  const records = decodeDetectiveProgress(JSON.stringify({ version: 1, records: progress })).records;
  return ['타미 탐정단 · 나의 탐험 보고서', `출처를 확인한 이야기 조각: ${records.length}개`, '이 보고서는 이 기기에서 직접 고르고 정답을 확인한 공식 기록을 모았습니다.', '', ...records.flatMap((item, index) => [
    `${index + 1}. ${getPlace(item.placeId)!.name}`, item.quoteText, `출처: ${item.sourceUrl}`, `탐험 기록 시각: ${item.completedAt}`, '',
  ])].join('\n');
}

export function photoDateEvidence(place: Place) {
  if (!place.photo) return null;
  const dateLabel = place.photo.capturedAt?.trim() || '촬영일 미상';
  const prefix = dateLabel.slice(0, 10);
  const parsed = Date.parse(prefix);
  const hasCaptureDate = /^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(dateLabel) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === prefix;
  return { photo: place.photo, dateLabel, hasCaptureDate };
}

function validPhoto(value: unknown): MemoryPhoto | null {
  const raw = record(value);
  if (typeof raw.dataUrl !== 'string' || raw.dataUrl.length > MAX_MEMORY_PHOTO_CHARS || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.dataUrl)) return null;
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height) || Number(raw.width) < 1 || Number(raw.height) < 1 || Number(raw.width) > 1024 || Number(raw.height) > 1024) return null;
  return { dataUrl: raw.dataUrl, width: Number(raw.width), height: Number(raw.height) };
}

export function createMemoryDraft(input: {
  id: string; placeId: string; text: string; consented: boolean; rightsConfirmed: boolean; photo: MemoryPhoto | null;
}, now: string): CityMemory {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.id) || !getPlace(input.placeId) || !validTime(now)) throw new Error('장소와 저장 정보를 확인해 주세요.');
  const text = input.text.trim();
  if (!text || text.length > MAX_MEMORY_TEXT) throw new Error(`기억을 1~${MAX_MEMORY_TEXT}자로 적어 주세요.`);
  const photo = input.photo ? validPhoto(input.photo) : null;
  if (input.photo && (!photo || input.rightsConfirmed !== true)) throw new Error('사진의 사용 권리와 파일 정보를 확인해 주세요.');
  return { id: input.id, placeId: input.placeId, text, createdAt: now, consented: input.consented === true,
    rightsConfirmed: input.rightsConfirmed === true, photo, reviewedAt: null, status: 'draft' };
}

export function reviewMemory(memory: CityMemory, now: string): CityMemory {
  if (memory.status !== 'draft' || !memory.consented || !memory.rightsConfirmed || !validTime(now) || Date.parse(now) < Date.parse(memory.createdAt)) throw new Error('이야기 활용 동의와 글·사진의 사용 권리를 먼저 확인해 주세요.');
  return { ...memory, reviewedAt: now, status: 'reviewed' };
}

export function withdrawMemory(memory: CityMemory): CityMemory {
  return { ...memory, consented: false, rightsConfirmed: false, reviewedAt: null, status: 'withdrawn', photo: null };
}

export const deleteMemory = (memories: CityMemory[], id: string) => memories.filter((memory) => memory.id !== id);

export function canUseMemory(memory: CityMemory): boolean {
  return memory.status === 'reviewed' && memory.consented === true && memory.rightsConfirmed === true && validTime(memory.reviewedAt) && Date.parse(memory.reviewedAt) >= Date.parse(memory.createdAt);
}

export function memoryStoryNote(memory: CityMemory): string {
  const place = getPlace(memory.placeId);
  if (!canUseMemory(memory) || !place) throw new Error('동의와 이 기기의 검토를 마친 기억만 사용할 수 있어요.');
  return `[개인 기억 · 공식 근거 아님] ${place.name}: ${memory.text}`;
}

function validMemory(value: unknown): CityMemory | null {
  const raw = record(value);
  try {
    if (typeof raw.id !== 'string' || typeof raw.placeId !== 'string' || typeof raw.text !== 'string' || !validTime(raw.createdAt)
      || typeof raw.consented !== 'boolean' || typeof raw.rightsConfirmed !== 'boolean' || !['draft', 'reviewed', 'withdrawn'].includes(String(raw.status))) return null;
    const photo = raw.photo === null ? null : validPhoto(raw.photo);
    if (raw.photo !== null && !photo) return null;
    const memory = createMemoryDraft({ id: raw.id, placeId: raw.placeId, text: raw.text, consented: raw.consented, rightsConfirmed: raw.rightsConfirmed, photo }, raw.createdAt);
    if (raw.status === 'withdrawn') return withdrawMemory(memory);
    if (raw.status === 'reviewed') return validTime(raw.reviewedAt) ? reviewMemory(memory, raw.reviewedAt) : null;
    return raw.reviewedAt === null ? memory : null;
  } catch { return null; }
}

export function decodeMemories(raw: string | null): LocalRecords<CityMemory> {
  const decoded = decodeRecords(raw, MAX_MEMORY_STORAGE_CHARS, validMemory, MAX_MEMORIES);
  return { ...decoded, records: decoded.records.filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index) };
}

function loadRecords<T>(storage: LocalStorageAccess | null, key: string, decode: (raw: string | null) => LocalRecords<T>): LocalRecords<T> {
  try {
    if (!storage) throw new Error('unavailable');
    return decode(storage.getItem(key));
  } catch { return { records: [], error: '이 브라우저의 저장 공간에 접근할 수 없어요. 저장 설정을 확인해 주세요.' }; }
}

export const loadMemories = (storage: LocalStorageAccess | null) => loadRecords(storage, MEMORY_STORAGE_KEY, decodeMemories);
export const loadDetectiveProgress = (storage: LocalStorageAccess | null) => loadRecords(storage, DETECTIVE_STORAGE_KEY, decodeDetectiveProgress);

function saveRecords<T>(storage: LocalStorageAccess | null, key: string, records: T[], maxChars: number, decode: (raw: string) => LocalRecords<T>): LocalSaveResult {
  try {
    if (!storage) throw new Error('unavailable');
    const raw = JSON.stringify({ version: 1, records });
    if (raw.length > maxChars) return { ok: false, error: '이 체험의 저장 한도를 넘었어요. 보관한 사진이나 기억을 줄인 뒤 다시 저장해 주세요.' };
    if (decode(raw).error) return { ok: false, error: '저장할 자료의 형식을 확인하지 못했어요.' };
    storage.setItem(key, raw);
    return { ok: true, error: null };
  } catch { return { ok: false, error: '저장하지 못했어요. 브라우저 저장 공간이나 저장 허용 설정을 확인해 주세요.' }; }
}

export const saveMemories = (storage: LocalStorageAccess | null, memories: CityMemory[]) => saveRecords(storage, MEMORY_STORAGE_KEY, memories, MAX_MEMORY_STORAGE_CHARS, decodeMemories);
export const saveDetectiveProgress = (storage: LocalStorageAccess | null, progress: DetectiveCompletion[]) => saveRecords(storage, DETECTIVE_STORAGE_KEY, progress, 30_000, decodeDetectiveProgress);

export function validateMemoryPhotoFile(file: { size: number; type: string }, header: Uint8Array): string | null {
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > 2 * 1024 * 1024) return '사진은 2MB 이하의 파일을 선택해 주세요.';
  let matches = false;
  if (file.type === 'image/jpeg') matches = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (file.type === 'image/png') matches = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => header[i] === value);
  if (file.type === 'image/webp') matches = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  return matches ? null : '파일 내용을 확인할 수 없어요. JPEG·PNG·WebP 사진을 선택해 주세요.';
}

export function fitMemoryPhoto(width: number, height: number, maximum = 1024) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 24_000_000) throw new Error('사진 크기를 확인할 수 없거나 너무 커요. 2,400만 화소 이하의 사진을 선택해 주세요.');
  const scale = Math.min(1, maximum / width, maximum / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decode and re-encode locally; files and EXIF metadata are never uploaded by this module. */
export async function prepareMemoryPhoto(file: File): Promise<MemoryPhoto> {
  const error = validateMemoryPhotoFile(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (error) throw new Error(error);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 사진을 준비할 수 없어요.');
    for (const maximum of [1024, 768, 512]) {
      const size = fitMemoryPhoto(image.naturalWidth, image.naturalHeight, maximum);
      canvas.width = size.width; canvas.height = size.height;
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height);
      context.drawImage(image, 0, 0, size.width, size.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length <= MAX_MEMORY_PHOTO_CHARS) return { dataUrl, ...size };
    }
    throw new Error('사진을 보관 용량에 맞추지 못했어요. 더 작은 사진을 선택해 주세요.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('사진')) throw error;
    throw new Error('사진을 열 수 없어요. 정상적으로 열리는 JPEG·PNG·WebP 파일을 선택해 주세요.');
  } finally { URL.revokeObjectURL(url); }
}
