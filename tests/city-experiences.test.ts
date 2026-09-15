import { describe, expect, it } from 'vitest';
import { getPlace } from '@/lib/places';
import {
  DETECTIVE_STORAGE_KEY, MEMORY_STORAGE_KEY, MAX_MEMORY_STORAGE_CHARS,
  getDetectiveQuest, answerDetectiveQuest, decodeDetectiveProgress, detectiveReport,
  photoDateEvidence, createMemoryDraft, reviewMemory, withdrawMemory, deleteMemory,
  canUseMemory, memoryStoryNote, decodeMemories, loadMemories, saveMemories,
  saveDetectiveProgress, validateMemoryPhotoFile, fitMemoryPhoto,
  type MemoryPhoto, type LocalStorageAccess,
} from '@/lib/city-experiences';

function storage(seed: Record<string, string> = {}): LocalStorageAccess {
  const values = new Map(Object.entries(seed));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}
const date = '2026-09-15T10:00:00.000Z';
const later = '2026-09-15T10:01:00.000Z';
const photo: MemoryPhoto = { dataUrl: 'data:image/jpeg;base64,/9j/AA==', width: 800, height: 600 };
const draft = (options: Partial<Parameters<typeof createMemoryDraft>[0]> = {}) => createMemoryDraft({
  id: 'memory-test-0001', placeId: 'central-park', text: '할머니와 호숫가를 걸었던 날을 기억해요.',
  consented: false, rightsConfirmed: false, photo: null, ...options,
}, date);

describe('city time evidence', () => {
  it('keeps historical capture dates and does not promote upload metadata to a capture date', () => {
    expect(photoDateEvidence(getPlace('pangyo-museum')!)?.dateLabel).toBe('2014-11-13');
    expect(photoDateEvidence(getPlace('pangyo-museum')!)?.hasCaptureDate).toBe(true);
    const unknown = photoDateEvidence(getPlace('yuldong-park')!);
    expect(unknown?.dateLabel).toContain('촬영일 미상');
    expect(unknown?.hasCaptureDate).toBe(false);
    expect(photoDateEvidence({ ...getPlace('central-park')!, photo: null })).toBeNull();
  });
});

describe('local detective evidence', () => {
  it.each(['pangyo-museum', 'central-park', 'moran-market'])('offers precise evidence choices from %s official records', (id) => {
    const place = getPlace(id)!;
    const quest = getDetectiveQuest(place)!;
    expect(quest).not.toBeNull();
    expect(quest.options.length).toBeGreaterThanOrEqual(3);
    for (const option of quest.options) expect(place.officialQuotes).toContainEqual({ text: option.text, sourceUrl: option.sourceUrl });
    const solved = answerDetectiveQuest([], place.id, quest.answerIndex, date);
    expect(solved.correct).toBe(true);
    expect(solved.progress).toHaveLength(1);
    expect(place.officialQuotes).toContainEqual({ text: solved.progress[0].quoteText, sourceUrl: solved.progress[0].sourceUrl });
  });

  it('returns a useful hint for wrong evidence without recording completion', () => {
    const quest = getDetectiveQuest(getPlace('central-park')!)!;
    const wrong = quest.options.find((option) => option.index !== quest.answerIndex)!;
    const result = answerDetectiveQuest([], quest.placeId, wrong.index, date);
    expect(result.correct).toBe(false);
    expect(result.message.length).toBeGreaterThan(12);
    expect(result.progress).toEqual([]);
    expect(detectiveReport(result.progress)).not.toContain('한산이씨 수내동가옥');
  });

  it('deduplicates correct answers and rejects forged or cross-place stored evidence', () => {
    const quest = getDetectiveQuest(getPlace('moran-market')!)!;
    const solved = answerDetectiveQuest([], quest.placeId, quest.answerIndex, date).progress;
    const again = answerDetectiveQuest(solved, quest.placeId, quest.answerIndex, later).progress;
    expect(again).toHaveLength(1);
    const forged = { ...solved[0], sourceUrl: getPlace('central-park')!.sourceUrl };
    const decoded = decodeDetectiveProgress(JSON.stringify({ version: 1, records: [forged] }));
    expect(decoded.records).toEqual([]);
    expect(decoded.error).toBeTruthy();
    expect(decodeDetectiveProgress('{broken').records).toEqual([]);
    const report = detectiveReport(solved);
    expect(report).toContain(solved[0].quoteText);
    expect(report).toContain(solved[0].sourceUrl);
    expect(report).toContain('모란민속5일장');
  });

  it('persists completion separately from private memories and handles denied storage', () => {
    const store = storage({ [MEMORY_STORAGE_KEY]: 'private notes' });
    const quest = getDetectiveQuest(getPlace('pangyo-museum')!)!;
    const progress = answerDetectiveQuest([], quest.placeId, quest.answerIndex, date).progress;
    expect(saveDetectiveProgress(store, progress).ok).toBe(true);
    expect(decodeDetectiveProgress(store.getItem(DETECTIVE_STORAGE_KEY)).records).toEqual(progress);
    expect(store.getItem(MEMORY_STORAGE_KEY)).toBe('private notes');
    const denied = { ...store, setItem: () => { throw new Error('denied'); } };
    expect(saveDetectiveProgress(denied, progress).ok).toBe(false);
  });
});

describe('private memories and local review', () => {
  it('requires separate consent, rights confirmation and explicit review before reuse', () => {
    const privateDraft = draft();
    expect(canUseMemory(privateDraft)).toBe(false);
    expect(() => reviewMemory(privateDraft, later)).toThrow();
    const consentOnly = draft({ consented: true });
    expect(() => reviewMemory(consentOnly, later)).toThrow();
    const ready = draft({ consented: true, rightsConfirmed: true, photo });
    expect(canUseMemory(ready)).toBe(false);
    const reviewed = reviewMemory(ready, later);
    expect(canUseMemory(reviewed)).toBe(true);
    expect(memoryStoryNote(reviewed)).toContain('개인 기억');
    expect(memoryStoryNote(reviewed)).toContain(ready.text);
    expect(memoryStoryNote(reviewed)).not.toContain('data:image');
    expect(memoryStoryNote(reviewed).length).toBeLessThanOrEqual(500);
  });

  it('withdraws reuse eligibility and removes the photo, then allows complete deletion', () => {
    const reviewed = reviewMemory(draft({ consented: true, rightsConfirmed: true, photo }), later);
    const withdrawn = withdrawMemory(reviewed);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.consented).toBe(false);
    expect(withdrawn.reviewedAt).toBeNull();
    expect(withdrawn.photo).toBeNull();
    expect(canUseMemory(withdrawn)).toBe(false);
    expect(() => memoryStoryNote(withdrawn)).toThrow();
    expect(() => reviewMemory(withdrawn, later)).toThrow();
    expect(deleteMemory([withdrawn], withdrawn.id)).toEqual([]);
  });

  it('keeps private text and photos only inside its bounded local storage record', () => {
    const store = storage();
    const record = draft({ rightsConfirmed: true, photo });
    expect(saveMemories(store, [record]).ok).toBe(true);
    expect(loadMemories(store).records).toEqual([record]);
    expect(store.getItem(DETECTIVE_STORAGE_KEY)).toBeNull();
    const withdrawn = withdrawMemory(record);
    expect(saveMemories(store, [withdrawn]).ok).toBe(true);
    expect(store.getItem(MEMORY_STORAGE_KEY)).not.toContain('data:image');
  });

  it('rejects unsupported input and corrupted local records without trusting a reviewed flag', () => {
    expect(() => draft({ text: ' ' })).toThrow();
    expect(() => draft({ text: '가'.repeat(401) })).toThrow();
    expect(() => draft({ placeId: 'not-a-real-place' })).toThrow();
    expect(() => draft({ photo })).toThrow();
    const forged = { ...draft(), status: 'reviewed', reviewedAt: later };
    const decoded = decodeMemories(JSON.stringify({ version: 1, records: [forged] }));
    expect(decoded.records.every((memory) => !canUseMemory(memory))).toBe(true);
    expect(decoded.error).toBeTruthy();
    expect(decodeMemories('{not-json').records).toEqual([]);
    expect(decodeMemories(JSON.stringify({ version: 7, records: [draft()] })).records).toEqual([]);
    const badPhoto = { ...draft({ rightsConfirmed: true }), photo: { ...photo, dataUrl: 'data:image/svg+xml,<svg />' } };
    expect(decodeMemories(JSON.stringify({ version: 1, records: [badPhoto] })).records).toEqual([]);
  });

  it('reports storage failures and budget overflow while preserving the previous saved state', () => {
    const store = storage();
    const original = draft();
    saveMemories(store, [original]);
    const old = store.getItem(MEMORY_STORAGE_KEY);
    const full = { ...store, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(saveMemories(full, [draft({ id: 'memory-test-0002' })]).ok).toBe(false);
    expect(store.getItem(MEMORY_STORAGE_KEY)).toBe(old);
    const largePhoto = { ...photo, dataUrl: `data:image/jpeg;base64,${'A'.repeat(160000)}` };
    const records = Array.from({ length: 8 }, (_, i) => draft({ id: `memory-budget-000${i}`, rightsConfirmed: true, photo: largePhoto }));
    expect(JSON.stringify(records).length).toBeGreaterThan(MAX_MEMORY_STORAGE_CHARS);
    expect(saveMemories(store, records).ok).toBe(false);
    expect(store.getItem(MEMORY_STORAGE_KEY)).toBe(old);
    const unreadable = { ...store, getItem: () => { throw new Error('unavailable'); } };
    expect(loadMemories(unreadable).error).toBeTruthy();
  });
});

describe('local photo boundaries', () => {
  it('accepts bounded JPEG/PNG/WebP signatures and rejects spoofed types or oversize files', () => {
    expect(validateMemoryPhotoFile({ type: 'image/jpeg', size: 100 }, new Uint8Array([255, 216, 255, 0]))).toBeNull();
    expect(validateMemoryPhotoFile({ type: 'image/png', size: 100 }, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBeNull();
    expect(validateMemoryPhotoFile({ type: 'image/webp', size: 100 }, new TextEncoder().encode('RIFF0000WEBP'))).toBeNull();
    expect(validateMemoryPhotoFile({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 }, new Uint8Array([255, 216, 255]))).toBeTruthy();
    expect(validateMemoryPhotoFile({ type: 'image/jpeg', size: 100 }, new TextEncoder().encode('<svg>'))).toBeTruthy();
    expect(validateMemoryPhotoFile({ type: 'image/svg+xml', size: 100 }, new TextEncoder().encode('<svg>'))).toBeTruthy();
    expect(validateMemoryPhotoFile({ type: 'image/png', size: 0 }, new Uint8Array())).toBeTruthy();
  });

  it('preserves aspect ratio without upscaling and limits both photo dimensions', () => {
    expect(fitMemoryPhoto(4000, 2000)).toEqual({ width: 1024, height: 512 });
    expect(fitMemoryPhoto(600, 900)).toEqual({ width: 600, height: 900 });
    expect(fitMemoryPhoto(1000, 4000)).toEqual({ width: 256, height: 1024 });
    expect(() => fitMemoryPhoto(0, 10)).toThrow();
    expect(() => fitMemoryPhoto(Infinity, 10)).toThrow();
  });
});
