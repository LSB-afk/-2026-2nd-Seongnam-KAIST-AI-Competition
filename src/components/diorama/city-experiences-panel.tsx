'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PlacePhoto } from '@/components/place-explorer';
import { getPlace, type Place } from '@/lib/places';
import { CITY_HISTORY_RECORDS } from '@/lib/city-history';
import urbanIndex from '@/lib/diorama/seongnam-urban-index.json';
import {
  DETECTIVE_STORAGE_KEY, MEMORY_STORAGE_KEY, MAX_MEMORY_TEXT,
  getDetectiveQuest, answerDetectiveQuest, detectiveReport, photoDateEvidence,
  createMemoryDraft, reviewMemory, withdrawMemory, deleteMemory, canUseMemory, memoryStoryNote,
  loadMemories, saveMemories, loadDetectiveProgress, saveDetectiveProgress, prepareMemoryPhoto,
  type CityMemory, type MemoryPhoto, type DetectiveCompletion, type LocalStorageAccess, type LocalRecords, type LocalSaveResult,
} from '@/lib/city-experiences';
import './city-experiences.css';

function browserStorage(): LocalStorageAccess | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function useLocalRecords<T>(key: string, load: (storage: LocalStorageAccess | null) => LocalRecords<T>, save: (storage: LocalStorageAccess | null, records: T[]) => LocalSaveResult) {
  const [records, setRecords] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (!alive) return;
      const restored = load(browserStorage());
      setRecords(restored.records); setError(restored.error); setReady(true);
    };
    queueMicrotask(refresh);
    const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
    window.addEventListener('storage', changed);
    return () => { alive = false; window.removeEventListener('storage', changed); };
  }, [key, load]);
  const update = (change: (current: T[]) => T[], privacyAction = false) => {
    const storage = browserStorage();
    const fresh = load(storage);
    const next = change(fresh.error ? records : fresh.records);
    const result = save(storage, next);
    if (result.ok || privacyAction) setRecords(next);
    setError(result.error && privacyAction ? `${result.error} 화면에서는 사용을 중단했지만, 저장된 자료의 삭제·철회가 유지됐는지 다시 확인해 주세요.` : result.error);
    return result.ok;
  };
  return { records, ready, error, update, setError };
}

function EmptyPlace({ action }: { action: string }) {
  return <p className="city-experience-empty">지도에서 장소를 선택하면 {action}</p>;
}

function DatedPhoto({ place }: { place: Place }) {
  const evidence = photoDateEvidence(place);
  if (!evidence) return <p className="city-experience-empty">이 장소의 사용 가능한 실제 사진이 아직 없어요.</p>;
  const { photo, dateLabel } = evidence;
  return <figure className="city-experience-photo">
    <PlacePhoto place={place} key={place.id} retryable sizes="(max-width: 700px) 90vw, 360px" />
    <figcaption><strong>{photo.caption || `${place.name} 실제 사진`}</strong><span>촬영 정보: {dateLabel}</span>
      <span>{photo.author} · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></span>
      <a href={photo.sourceUrl} target="_blank" rel="noreferrer">사진 원문 보기 ↗</a>
    </figcaption>
  </figure>;
}

export function TimeLensPanel({ place, onImagine }: { place: Place | null; onImagine: (prompt: string) => void }) {
  return <section className="city-experience" aria-label="시간 렌즈">
    <div className="city-experience-heading"><span className="city-experience-kicker">같은 장소, 다른 시간</span><h3>시간 렌즈</h3></div>
    {place ? <TimeLens key={place.id} place={place} onImagine={onImagine} /> : <EmptyPlace action="날짜가 있는 기록과 상상을 나란히 살펴볼 수 있어요." />}
  </section>;
}

function TimeLens({ place, onImagine }: { place: Place; onImagine: (prompt: string) => void }) {
  const [tab, setTab] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [message, setMessage] = useState('');
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const records = CITY_HISTORY_RECORDS.filter((item) => item.placeId === place.id).sort((a, b) => a.date.localeCompare(b.date));
  const evidence = photoDateEvidence(place);
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'ArrowRight' ? (tab + 1) % 3 : event.key === 'ArrowLeft' ? (tab + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
    if (next === null) return;
    event.preventDefault(); setTab(next); tabs.current[next]?.focus();
  };
  const imagine = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) { setMessage('만약 이 장소가 어떻게 바뀐다면 좋을지 적어 주세요.'); return; }
    // The studio goal appends its own sentence ending after this prompt.
    onImagine(`${place.name}의 미래를 상상해 주세요. ${text}\n현재의 사실과 구분된 AI 상상으로 표현해 주세요`);
    setMessage('상상 아이디어를 제작 화면으로 전달했어요.');
  };
  return <>
    <p className="city-experience-place">{place.name}</p>
    <div className="city-experience-tabs" role="tablist" aria-label="시간 렌즈 시점">
      {['그때', '지금', '만약'].map((label, index) => <button key={label} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onKeyDown={keyDown} onClick={() => setTab(index)}>{label}</button>)}
    </div>
    <div className="city-experience-tab-content" role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
      {tab === 0 && <>
        <p className="city-experience-note">날짜와 출처를 확인한 기록이에요. 실제 과거·현재 사진 쌍이 있는 비교 화면은 아니에요.</p>
        {records.length > 0 && <ol className="city-history-timeline">{records.map((item) => <li key={item.id}>
          <span className="city-history-date">{item.dateLabel} · <time dateTime={item.date}>{item.date}</time></span>
          <h4>{item.title}</h4><p>{item.summary}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.publisher} 기록 ↗</a>
        </li>)}</ol>}
        {evidence?.hasCaptureDate && <DatedPhoto place={place} />}
        {!records.length && !evidence?.hasCaptureDate && <p className="city-experience-empty">날짜가 확인된 과거 기록이 아직 없어요. ‘지금’에서 공식 안내와 사진의 촬영 정보를 확인할 수 있어요.</p>}
      </>}
      {tab === 1 && <>
        <div className="city-experience-record"><span className="city-experience-kicker">이 화면의 장소·지도 자료</span><p>{place.description}</p>
          <p className="city-experience-note">장소 정보 확인일: {place.verifiedAt}<br />공개 지도 원자료 기준: {urbanIndex.metadata.inputs.pois.osmBaseTimestamp.slice(0, 10)} · 실시간 현황 아님</p>
          <div className="city-experience-links"><a href={place.sourceUrl} target="_blank" rel="noreferrer">공식 장소 안내 ↗</a><a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=18/${place.lat}/${place.lng}`} target="_blank" rel="noreferrer">공개 지도 위치 ↗</a></div>
        </div>
        <p className="city-experience-note">아래 사진은 기록된 촬영 시점의 모습이에요. 오늘 촬영한 사진이나 실시간 화면이 아니에요.</p>
        <DatedPhoto place={place} />
      </>}
      {tab === 2 && <form className="city-experience-form" onSubmit={imagine}>
        <span className="city-experience-badge">AI 상상</span><p>이 장소의 다음 장면을 상상해 보세요. 아이디어를 기존 카드 제작 화면으로 가져갑니다.</p>
        <label htmlFor={`${id}-imagine`}>만약, 이 장소가…</label><textarea id={`${id}-imagine`} value={prompt} maxLength={400} rows={4} placeholder="예: 밤에도 누구나 별을 관찰하는 작은 쉼터가 된다면?" onChange={(event) => { setPrompt(event.target.value); setMessage(''); }} />
        <button className="city-experience-button primary" type="submit" disabled={!prompt.trim()}>이 상상으로 카드 만들기</button>
        <p className="city-experience-note">상상 결과는 공식 기록이나 실제 미래 계획으로 소개하지 않아요.</p>
        <p className="city-experience-status" role="status">{message}</p>
      </form>}
    </div>
  </>;
}

export function DetectivePanel({ place }: { place: Place | null }) {
  const local = useLocalRecords(DETECTIVE_STORAGE_KEY, loadDetectiveProgress, saveDetectiveProgress);
  const [downloadMessage, setDownloadMessage] = useState('');
  const download = () => {
    const url = URL.createObjectURL(new Blob([detectiveReport(local.records)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '타미-탐정단-탐험-보고서.txt'; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadMessage('확인한 근거가 담긴 텍스트 보고서를 내려받았어요.');
  };
  return <section className="city-experience detective-experience" aria-label="타미 탐정단">
    <div className="city-experience-heading"><span className="city-experience-kicker">공식 기록 속 단서 찾기</span><h3>타미 탐정단</h3><p>질문에 답하는 문장을 골라 이야기 조각을 모아 보세요.</p></div>
    {!place ? <EmptyPlace action="타미와 함께 공식 기록의 단서를 찾을 수 있어요." /> : <DetectiveQuestion key={place.id} place={place} progress={local.records} ready={local.ready} save={(next) => local.update((current) => [...current, ...next.filter((item) => !current.some((saved) => saved.questId === item.questId))])} />}
    {local.error && <p className="city-experience-error" role="alert">{local.error}</p>}
    <div className="city-experience-report"><strong>확인한 이야기 조각 {local.records.length}개</strong><span>정답과 출처를 확인한 조각만 이 기기에 기록해요.</span>
      {local.records.length > 0 && <ul>{local.records.map((item) => <li key={item.questId}><span>{getPlace(item.placeId)?.name}</span><a href={item.sourceUrl} target="_blank" rel="noreferrer">확인한 출처 ↗</a></li>)}</ul>}
      <button type="button" className="city-experience-button" disabled={!local.records.length} onClick={download}>내 탐험 보고서 내려받기</button>
      <p className="city-experience-status" role="status">{downloadMessage}</p>
    </div>
  </section>;
}

function DetectiveQuestion({ place, progress, ready, save }: { place: Place; progress: DetectiveCompletion[]; ready: boolean; save: (next: DetectiveCompletion[]) => boolean }) {
  const quest = getDetectiveQuest(place);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const id = useId();
  const completion = quest ? progress.find((item) => item.questId === quest.id) : null;
  if (!quest) return <div className="city-experience-empty"><p>{place.name}의 검증된 탐정 문제는 아직 준비 중이에요.</p><p>판교박물관·중앙공원·모란시장·율동공원·봉국사에서 단서를 찾을 수 있어요.</p></div>;
  const answer = (event: FormEvent) => {
    event.preventDefault();
    if (selected === null) return;
    const result = answerDetectiveQuest(progress, place.id, selected, new Date().toISOString());
    const saved = !result.correct || save(result.progress);
    setFeedback(saved ? result.message : '정답을 찾았어요. 아직 기기에 저장하지 못했으니 저장 상태를 확인하고 다시 눌러 주세요.');
  };
  return <div className="city-detective-question">
    <p className="city-experience-place">{place.name}</p>
    {completion ? <div className="city-experience-success" role="status"><strong>이 장소의 근거를 찾았어요</strong><blockquote>{completion.quoteText}</blockquote><a href={completion.sourceUrl} target="_blank" rel="noreferrer">정답을 뒷받침하는 공식 기록 ↗</a></div> : <form onSubmit={answer}>
      <fieldset disabled={!ready}><legend>{quest.question}</legend>
        {quest.options.map((option) => <label className="city-evidence-option" key={option.index}><input type="radio" name={`${id}-evidence`} value={option.index} checked={selected === option.index} onChange={() => { setSelected(option.index); setFeedback(''); }} /><span>{option.text}</span></label>)}
      </fieldset>
      <a className="city-experience-source" href={place.officialQuotes[quest.answerIndex].sourceUrl} target="_blank" rel="noreferrer">공식 기록을 먼저 읽어보기 ↗</a>
      <button type="submit" className="city-experience-button primary" disabled={!ready || selected === null}>선택한 근거 확인하기</button>
    </form>}
    <p className="city-experience-status" role="status">{feedback}</p>
  </div>;
}

export function MemoryPanel({ place, onUseMemory }: { place: Place | null; onUseMemory: (note: string) => void }) {
  const local = useLocalRecords(MEMORY_STORAGE_KEY, loadMemories, saveMemories);
  const [message, setMessage] = useState('');
  const visible = place ? local.records.filter((memory) => memory.placeId === place.id) : local.records;
  const review = (id: string) => {
    try {
      const ok = local.update((current) => current.map((memory) => memory.id === id ? reviewMemory(memory, new Date().toISOString()) : memory));
      setMessage(ok ? '이 기기에서 검토를 마쳤어요. 이제 이야기 메모로 사용할 수 있어요.' : '검토 결과가 저장되지 않았어요.');
    } catch (error) { local.setError(error instanceof Error ? error.message : '기억의 동의 상태를 확인해 주세요.'); }
  };
  const permissions = (id: string, field: 'consented' | 'rightsConfirmed', value: boolean) => {
    local.update((current) => current.map((memory) => memory.id === id && memory.status === 'draft'
      ? { ...memory, [field]: value, photo: field === 'rightsConfirmed' && !value ? null : memory.photo } : memory), !value);
  };
  const reuseMemory = (id: string) => {
    const fresh = loadMemories(browserStorage());
    const memory = fresh.records.find((item) => item.id === id);
    if (fresh.error || !memory || memory.placeId !== place?.id || !canUseMemory(memory)) {
      local.setError('이 기억의 동의와 검토 상태를 다시 확인해 주세요. 철회한 기억은 사용할 수 없어요.'); return;
    }
    onUseMemory(memoryStoryNote(memory)); setMessage('개인 기억임을 표시해 이야기 메모로 전달했어요. 사진은 전달하지 않았어요.');
  };
  return <section className="city-experience memory-experience" aria-label="시민 기억 지도">
    <div className="city-experience-heading"><span className="city-experience-kicker">나만의 성남 기록</span><h3>시민 기억 지도</h3><p>이 장소에서 보낸 하루를 내 기억 보관함에 남겨 보세요.</p></div>
    <p className="city-experience-privacy">이 보관함과 검토는 이 브라우저에만 저장돼요. 공개 커뮤니티에 게시하지 않으며, 개인 기억은 공식 기록이 아니에요.</p>
    {place ? <MemoryComposer key={place.id} place={place} ready={local.ready} onSave={(memory) => {
      const ok = local.update((current) => [...current, memory]);
      if (ok) setMessage('기억을 비공개 초안으로 보관했어요. 내용을 읽고 별도로 검토를 완료해 주세요.');
      return ok;
    }} /> : <EmptyPlace action="그곳에 얽힌 개인 기억을 적을 수 있어요." />}
    {local.error && <p className="city-experience-error" role="alert">{local.error}</p>}
    <p className="city-experience-status" role="status">{message}</p>
    <div className="city-memory-list"><h4>{place ? `${place.name}에 남긴 기억` : '이 기기의 기억'} · {visible.length}개</h4>
      {!local.ready && <p className="city-experience-note">이 기기의 기억을 불러오고 있어요.</p>}
      {local.ready && !visible.length && <p className="city-experience-empty">아직 보관한 기억이 없어요.</p>}
      {visible.map((memory) => <article className="city-memory-card" key={memory.id}>
        <div className="city-memory-card-heading"><strong>{getPlace(memory.placeId)?.name}</strong><span className="city-experience-badge">{memory.status === 'reviewed' ? '이 기기에서 검토 완료' : memory.status === 'withdrawn' ? '활용 철회됨' : '비공개 초안'}</span></div>
        <p className="city-memory-text">{memory.text}</p>
        {memory.photo && <Image className="city-memory-photo" src={memory.photo.dataUrl} width={memory.photo.width} height={memory.photo.height} alt={`${getPlace(memory.placeId)?.name}에 남긴 개인 기억 사진`} unoptimized />}
        <p className="city-experience-note">개인 경험 · 작성 {memory.createdAt.slice(0, 10)}</p>
        {memory.status === 'draft' && <div className="city-memory-review">
          <p>이 글·사진에 타인의 연락처나 민감한 내용이 없는지 직접 읽고 확인해 주세요.</p>
          <label className="city-experience-check"><input type="checkbox" checked={memory.rightsConfirmed} onChange={(event) => permissions(memory.id, 'rightsConfirmed', event.target.checked)} /><span>이 글·사진을 사용할 권리가 있고 타인의 개인정보를 넣지 않았어요.</span></label>
          <label className="city-experience-check"><input type="checkbox" checked={memory.consented} onChange={(event) => permissions(memory.id, 'consented', event.target.checked)} /><span>검토한 글을 내가 선택할 때 이야기 메모로 활용하는 데 동의해요.</span></label>
          <button type="button" className="city-experience-button" disabled={!memory.consented || !memory.rightsConfirmed} onClick={() => review(memory.id)}>이 기기에서 검토 완료</button>
        </div>}
        <div className="city-memory-actions">
          <button type="button" className="city-experience-button primary" disabled={!canUseMemory(memory) || place?.id !== memory.placeId} onClick={() => reuseMemory(memory.id)}>이야기 메모로 사용</button>
          {memory.status !== 'withdrawn' && <button type="button" className="city-experience-button" onClick={() => {
            const ok = local.update((current) => current.map((item) => item.id === memory.id ? withdrawMemory(item) : item), true);
            setMessage(ok ? '활용 동의를 철회하고 보관 사진을 지웠어요. 글은 비공개로 남아 있어요.' : '이 화면에서 기억의 활용을 중단했어요. 저장 오류 안내를 확인해 주세요.');
          }}>활용 철회</button>}
          <button type="button" className="city-experience-button danger" onClick={() => {
            const ok = local.update((current) => deleteMemory(current, memory.id), true);
            setMessage(ok ? '이 기기에서 기억과 사진을 삭제했어요.' : '이 화면에서 기억을 지웠어요. 저장 오류 안내를 확인해 주세요.');
          }}>기억 삭제</button>
        </div>
        {memory.status === 'withdrawn' && <p className="city-experience-note">사진과 활용 자격을 지웠어요. 이 글을 다시 사용하려면 새 기억으로 작성하고 동의·검토를 다시 해 주세요.</p>}
      </article>)}
    </div>
    <p className="city-experience-note">‘이야기 메모로 사용’을 선택하면 글만 제작 메모로 전달해요. 이미 전달한 메모는 이야기 화면에서도 따로 지워 주세요. 브라우저의 사이트 데이터를 지우면 이 보관함도 사라져요.</p>
  </section>;
}

function MemoryComposer({ place, ready, onSave }: { place: Place; ready: boolean; onSave: (memory: CityMemory) => boolean }) {
  const [text, setText] = useState('');
  const [consented, setConsented] = useState(false);
  const [rights, setRights] = useState(false);
  const [photo, setPhoto] = useState<MemoryPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const id = useId();
  useEffect(() => () => { request.current++; }, []);
  const clearPhoto = () => { request.current++; setPhoto(null); setPreparing(false); if (fileInput.current) fileInput.current.value = ''; };
  const choosePhoto = async (file: File | undefined) => {
    const generation = ++request.current;
    setPhoto(null); setError('');
    if (!file) { setPreparing(false); return; }
    setPreparing(true);
    try {
      const next = await prepareMemoryPhoto(file);
      if (generation === request.current) setPhoto(next);
    } catch (error) {
      if (generation === request.current) { setError(error instanceof Error ? error.message : '사진을 준비하지 못했어요.'); if (fileInput.current) fileInput.current.value = ''; }
    } finally { if (generation === request.current) setPreparing(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const memory = createMemoryDraft({ id: crypto.randomUUID(), placeId: place.id, text, consented, rightsConfirmed: rights, photo }, new Date().toISOString());
      if (onSave(memory)) { setText(''); setConsented(false); setRights(false); clearPhoto(); setError(''); }
    } catch (error) { setError(error instanceof Error ? error.message : '기억을 저장하지 못했어요.'); }
  };
  return <form className="city-experience-form city-memory-composer" onSubmit={submit}>
    <label htmlFor={`${id}-memory`}>{place.name}에서의 내 기억</label>
    <textarea id={`${id}-memory`} value={text} rows={4} maxLength={MAX_MEMORY_TEXT} placeholder="누구와 어떤 하루를 보냈나요? 개인 연락처는 적지 말아 주세요." onChange={(event) => setText(event.target.value)} />
    <span className="city-experience-counter">{text.length}/{MAX_MEMORY_TEXT}자</span>
    <label className="city-experience-check"><input type="checkbox" checked={rights} onChange={(event) => { setRights(event.target.checked); if (!event.target.checked) clearPhoto(); }} /><span>이 글·사진을 사용할 권리가 있고 타인의 개인정보를 넣지 않았어요.</span></label>
    <label className="city-experience-check"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>검토한 글을 내가 선택할 때 이야기 메모로 활용하는 데 동의해요.</span></label>
    <label htmlFor={`${id}-photo`}>함께 보관할 사진 <span className="city-experience-note">(선택)</span></label>
    <input ref={fileInput} id={`${id}-photo`} type="file" accept="image/jpeg,image/png,image/webp" disabled={!rights || !ready} aria-describedby={`${id}-photo-help`} onChange={(event) => { void choosePhoto(event.target.files?.[0]); }} />
    <p id={`${id}-photo-help`} className="city-experience-note">사용 권리를 확인한 JPEG·PNG·WebP, 최대 2MB. 기기 안에서 크기를 줄여 보관하며 사진 위치 정보는 보관하지 않아요.</p>
    {preparing && <p role="status">이 기기에서 사진을 준비하고 있어요.</p>}
    {photo && <div className="city-memory-photo-preview"><Image src={photo.dataUrl} width={photo.width} height={photo.height} alt="보관할 개인 사진 미리보기" unoptimized /><button type="button" className="city-experience-button" onClick={clearPhoto}>첨부 사진 제거</button></div>}
    {error && <p className="city-experience-error" role="alert">{error}</p>}
    <button type="submit" className="city-experience-button primary" disabled={!ready || !text.trim() || preparing}>비공개 초안으로 보관</button>
    <p className="city-experience-note">저장만으로 검토가 완료되거나 이야기에 사용되지는 않아요.</p>
  </form>;
}
