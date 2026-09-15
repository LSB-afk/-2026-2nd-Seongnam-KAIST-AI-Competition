'use client';

import { useId, useRef, useState } from 'react';
import NextImage from 'next/image';
import { PlacePhoto } from '@/components/place-explorer';
import { getPlace, type Place } from '@/lib/places';
import type { ImageAsset } from '@/lib/types';
import { officialStoryUrls, storyBriefFromDraft, type CityStoryBrief, type CityStoryDraft, type StoryCameraView, type StoryStop } from '@/lib/city-story';
import './city-story.css';

export type CityStoryPanelProps = {
  draft: CityStoryDraft;
  onChange: (draft: CityStoryDraft) => void;
  selectedPlace: Place | null;
  onFocusStop: (stop: StoryStop) => void;
  onCaptureCamera: () => StoryCameraView | null;
  onCompose: (brief: CityStoryBrief, audience: string) => void;
  busy?: boolean;
};

export function CityStoryPanel({ draft, onChange, selectedPlace, onFocusStop, onCaptureCamera, onCompose, busy = false }: CityStoryPanelProps) {
  const id = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const [expandedStop, setExpandedStop] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const alreadyAdded = !!selectedPlace && draft.stops.some(stop => stop.placeId === selectedPlace.id);
  const full = draft.stops.length >= 3;
  const canCompose = draft.stops.length >= 2 && draft.stops.length <= 3 && !!draft.title.trim() && !!draft.audience.trim() && draft.stops.every(stop => !!getPlace(stop.placeId));
  const composeHint = draft.stops.length < 2 ? `제작하려면 장소 ${2 - draft.stops.length}곳을 더 담아 주세요.` : !draft.title.trim() ? '이야기 제목을 적어 주세요.' : !draft.audience.trim() ? '이야기를 들려줄 대상을 적어 주세요.' : !canCompose ? '등록된 장소 2~3곳으로 구성을 확인해 주세요.' : '담은 모든 장소가 사실 카드에 포함돼요.';

  function updateStop(stopId: string, patch: Partial<Omit<StoryStop, 'id' | 'placeId'>>) {
    if (busy) return;
    setError('');
    onChange({ ...draft, stops: draft.stops.map(stop => stop.id === stopId ? { ...stop, ...patch } : stop) });
  }
  function focusStopButton(stopId?: string) {
    requestAnimationFrame(() => {
      const target = stopId ? document.getElementById(`${id}-focus-${stopId}`) : titleInput.current;
      target?.focus({ preventScroll: true });
    });
  }
  function addPlace() {
    if (!selectedPlace || alreadyAdded || full || busy) return;
    const stop: StoryStop = { id: selectedPlace.id, placeId: selectedPlace.id, photoChoice: selectedPlace.photo ? 'place' : 'none', officialUrls: officialStoryUrls(selectedPlace) };
    onChange({ ...draft, stops: [...draft.stops, stop] });
    setExpandedStop(stop.id);
    setNotice(`${selectedPlace.name}을 이야기에 담았어요.`);
    setError('');
    focusStopButton(stop.id);
  }
  function moveStop(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (busy || nextIndex < 0 || nextIndex >= draft.stops.length) return;
    const stops = [...draft.stops];
    [stops[index], stops[nextIndex]] = [stops[nextIndex], stops[index]];
    onChange({ ...draft, stops });
    setNotice(`${getPlace(stops[nextIndex].placeId)?.name ?? '장소'}을 ${nextIndex + 1}번째로 옮겼어요.`);
    focusStopButton(stops[nextIndex].id);
  }
  function removeStop(index: number) {
    if (busy) return;
    const removed = draft.stops[index];
    const stops = draft.stops.filter((_, position) => position !== index);
    onChange({ ...draft, stops });
    if (expandedStop === removed.id) setExpandedStop(null);
    setNotice(`${getPlace(removed.placeId)?.name ?? '장소'}을 이야기에서 뺐어요.`);
    setError('');
    focusStopButton(stops[Math.min(index, stops.length - 1)]?.id);
  }
  function captureCamera(stop: StoryStop) {
    if (busy) return;
    const camera = onCaptureCamera();
    if (!camera) {
      setNotice('지금은 지도 구도를 저장할 수 없어요. 3D 화면이 준비된 뒤 다시 눌러 주세요.');
      return;
    }
    updateStop(stop.id, { camera });
    setNotice(`${getPlace(stop.placeId)?.name ?? '장소'}의 재생 구도로 현재 화면을 저장했어요.`);
  }
  function compose() {
    if (busy || !canCompose) return;
    let brief: CityStoryBrief;
    try { brief = storyBriefFromDraft(draft); }
    catch {
      setError('제목과 서로 다른 장소 2~3곳, 장소별 공식 자료를 확인해 주세요.');
      return;
    }
    setError('');
    onCompose(brief, draft.audience.trim());
  }

  return <section className="city-story-panel" aria-labelledby={`${id}-heading`} data-tami-avoid="">
    <header className="city-story-heading"><div><span className="city-story-eyebrow">장소를 엮어 한 편의 이야기로</span><h2 id={`${id}-heading`}>내 도시 이야기</h2></div><span className="city-story-count">{draft.stops.length} / 3곳</span></header>
    <p className="city-story-intro">마음에 남은 장소 2~3곳을 담아 보세요. 사실 이야기 세 장과 마지막 상상 한 장으로 이어집니다.</p>
    <form onSubmit={event => { event.preventDefault(); compose(); }} aria-busy={busy}>
      <div className="city-story-fields">
        <label htmlFor={`${id}-title`}>이야기 제목<input ref={titleInput} id={`${id}-title`} aria-label="도시 이야기 제목" required maxLength={80} value={draft.title} disabled={busy} onChange={event => { setError(''); onChange({ ...draft, title: event.target.value }); }} placeholder="이 장소들을 함께 기억하고 싶은 이유" /></label>
        <label htmlFor={`${id}-audience`}>누구에게 들려줄까요?<input id={`${id}-audience`} aria-label="도시 이야기 대상" required maxLength={40} value={draft.audience} disabled={busy} onChange={event => onChange({ ...draft, audience: event.target.value })} placeholder="예: 청소년, 성남을 처음 찾는 여행자" /></label>
      </div>
      <div className="city-story-add">
        <div><span>지금 선택한 장소</span><strong>{selectedPlace?.name ?? '지도에서 명소를 골라 주세요'}</strong></div>
        <button type="button" className="city-story-secondary" aria-label={selectedPlace ? `${selectedPlace.name} 이야기에 담기` : '선택한 장소 이야기에 담기'} disabled={busy || !selectedPlace || alreadyAdded || full} onClick={addPlace}>{alreadyAdded ? '담은 장소' : full ? '3곳을 담았어요' : '이야기에 담기'}<span aria-hidden="true">{alreadyAdded || full ? '' : '+'}</span></button>
      </div>
      {draft.stops.length === 0 && <div className="city-story-empty"><strong>첫 장소부터 시작해요</strong><p>‘둘러보기’에서 명소를 선택한 뒤 이곳에 담아 주세요. 순서와 내용은 나중에 바꿀 수 있어요.</p></div>}
      <ol className="city-story-stops" aria-label="이야기 장소 순서">
        {draft.stops.map((stop, index) => {
          const place = getPlace(stop.placeId);
          const name = place?.name ?? '등록되지 않은 장소';
          const urls = place ? officialStoryUrls(place) : [];
          const selectedUrls = stop.officialUrls ?? urls;
          const expanded = expandedStop === stop.id;
          return <li className="city-story-stop" key={stop.id} data-stop-id={stop.id}>
            <div className="city-story-stop-heading"><span className="city-story-stop-number" aria-label={`${index + 1}번째 장소`}>{String(index + 1).padStart(2, '0')}</span><button type="button" id={`${id}-focus-${stop.id}`} className="city-story-place-button" aria-label={`${name} 이야기 장소 보기`} disabled={!place} onClick={() => onFocusStop(stop)}><strong>{name}</strong><span>{place ? `${place.district} · ${place.type} · 지도에서 보기` : '이야기에서 빼고 다른 명소를 담아 주세요.'}</span></button></div>
            <div className="city-story-stop-actions"><button type="button" aria-label={`${name} 순서 앞으로`} disabled={busy || index === 0} onClick={() => moveStop(index, -1)}>↑ <span>앞으로</span></button><button type="button" aria-label={`${name} 순서 뒤로`} disabled={busy || index === draft.stops.length - 1} onClick={() => moveStop(index, 1)}>↓ <span>뒤로</span></button><button type="button" className="city-story-remove" aria-label={`${name} 이야기에서 삭제`} disabled={busy} onClick={() => removeStop(index)}>빼기</button></div>
            {place && <>
              <button type="button" className="city-story-expand" aria-label={`${name} 이야기 설정 ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} aria-controls={`${id}-settings-${stop.id}`} onClick={() => setExpandedStop(expanded ? null : stop.id)}><span>메모 · 사진 · 자료 · 구도</span><span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
              <div className="city-story-stop-settings" id={`${id}-settings-${stop.id}`} hidden={!expanded}>
                <label className="city-story-note-label" htmlFor={`${id}-note-${stop.id}`}>이 장소에서 들려주고 싶은 이야기<textarea id={`${id}-note-${stop.id}`} aria-label={`${name} 이야기 메모`} aria-describedby={`${id}-note-help-${stop.id}`} rows={3} maxLength={500} value={stop.note ?? ''} disabled={busy} onChange={event => updateStop(stop.id, { note: event.target.value })} placeholder="기억, 질문, 함께 연결하고 싶은 주제를 적어 주세요." /></label>
                <p className="city-story-hint" id={`${id}-note-help-${stop.id}`}>메모는 작성 의도이며 공식 근거가 아니에요. <span>{(stop.note ?? '').length} / 500</span></p>
                <fieldset className="city-story-photo-choice" disabled={busy}><legend>사진</legend><label className="city-story-check"><input type="checkbox" aria-label={`${name} 등록 사진 사용`} checked={!!place.photo && stop.photoChoice === 'place'} disabled={!place.photo} onChange={event => updateStop(stop.id, { photoChoice: event.target.checked ? 'place' : 'none' })} /><span>등록된 실제 사진 사용</span></label>
                  {place.photo ? <><div className="city-story-photo"><PlacePhoto key={place.id} place={place} sizes="280px" retryable /></div><p className="city-story-photo-credit">{place.photo.author} · <a href={place.photo.licenseUrl} target="_blank" rel="noreferrer">{place.photo.license}</a><br />{place.photo.capturedAt ?? '촬영일 미상'} · <a href={place.photo.sourceUrl} target="_blank" rel="noreferrer">사진 원문 ↗</a></p>{stop.photoChoice === 'none' && <p className="city-story-hint">이 사진을 사용하지 않는 구성으로 제작해요.</p>}</> : <p className="city-story-hint">등록된 사진이 없어요. 다른 장소의 사진으로 대신하지 않아요.</p>}
                </fieldset>
                <fieldset className="city-story-sources" disabled={busy}><legend>함께 읽을 공식 자료</legend>
                  {urls.map((url, sourceIndex) => {
                    const quote = place.officialQuotes.find(item => item.sourceUrl === url)?.text;
                    const checked = selectedUrls.includes(url);
                    return <div className="city-story-source" key={url}><label className="city-story-check"><input type="checkbox" aria-label={`${name} 공식 자료 ${sourceIndex + 1} 사용`} checked={checked} disabled={checked && selectedUrls.length === 1} onChange={event => updateStop(stop.id, { officialUrls: event.target.checked ? [...selectedUrls, url] : selectedUrls.filter(item => item !== url) })} /><span><strong>{sourceIndex === 0 ? '공식 장소 안내' : `공식 자료 ${sourceIndex + 1}`}</strong>{quote && <small>{quote}</small>}</span></label><a href={url} target="_blank" rel="noreferrer" aria-label={`${name} 공식 자료 ${sourceIndex + 1} 원문`}>원문 ↗</a></div>;
                  })}
                  <p className="city-story-hint">장소마다 공식 자료를 1개 이상 선택해요. 등록 자료 확인일: {place.verifiedAt}</p>
                </fieldset>
                <div className="city-story-camera"><div><strong>이야기를 보여 줄 구도</strong><span>{stop.camera ? '저장한 지도 구도가 있어요.' : '아직 저장한 구도가 없어요.'}</span></div><button type="button" className="city-story-secondary" aria-label={`${name} 현재 지도 구도 저장`} disabled={busy} onClick={() => captureCamera(stop)}>{stop.camera ? '현재 구도로 바꾸기' : '현재 구도 저장'}</button>{stop.camera && <button type="button" className="city-story-text-button" aria-label={`${name} 저장 구도 삭제`} disabled={busy} onClick={() => { updateStop(stop.id, { camera: undefined }); setNotice(`${name}의 저장 구도를 지웠어요.`); }}>저장 구도 지우기</button>}<p className="city-story-hint">지금 지도에 보이는 화면을 이 장소의 재생 구도로 저장해요.</p></div>
              </div>
            </>}
          </li>;
        })}
      </ol>
      {notice && <p className="city-story-notice" role="status">{notice}</p>}
      {error && <p className="city-story-error" role="alert">{error}</p>}
      <div className="city-story-compose"><p>{composeHint}</p><button type="submit" className="city-story-primary" disabled={busy || !canCompose}>{busy ? '이야기를 준비하고 있어요' : '이 구성으로 카드뉴스 만들기'}<span aria-hidden="true">↗</span></button><p className="city-story-hint">연결선과 장소 순서는 이야기의 흐름이며 도보 경로가 아니에요.</p></div>
    </form>
  </section>;
}

export type StoryPlaybackCard = { id: string; title: string; body: string; imagination: boolean; placeId?: string; image?: Pick<ImageAsset, 'src' | 'kind'> & Partial<Pick<ImageAsset, 'author' | 'license' | 'sourceUrl'>> & { crop?: { x: number; y: number; zoom: number } } };

function StoryPlaybackImage({ image, title }: { image: NonNullable<StoryPlaybackCard['image']>; title: string }) {
  const [failed, setFailed] = useState(false);
  const crop = image.crop ?? { x: .5, y: .5, zoom: 1 };
  let sourceUrl: string | undefined;
  try {
    const source = new URL(image.sourceUrl ?? '');
    if (source.protocol === 'http:' || source.protocol === 'https:') sourceUrl = source.href;
  } catch { /* A missing or invalid source remains plain credit text. */ }
  const kindLabel = image.kind === 'ai' ? 'AI 생성 이미지' : image.kind === 'upload' ? '업로드 이미지' : '실제 장소 사진';
  return <figure className="city-story-playback-image">
    <div className="city-story-image-frame">{failed ? <p className="city-story-image-unavailable">이미지를 불러오지 못했어요.</p> : <NextImage src={image.src} alt={`${title} · ${kindLabel}`} fill sizes="(max-width: 700px) 280px, 300px" unoptimized onError={() => setFailed(true)} style={{ objectFit: 'cover', objectPosition: `${crop.x * 100}% ${crop.y * 100}%`, transform: `scale(${crop.zoom})`, transformOrigin: `${crop.x * 100}% ${crop.y * 100}%` }} />}</div>
    <figcaption><span className="city-story-image-kind" data-ai={image.kind === 'ai'}>{kindLabel}</span><details><summary>이미지 출처</summary><p>{image.author || '제작자 정보 없음'} · {image.license || '이용 조건 정보 없음'}{sourceUrl && <> · <a href={sourceUrl} target="_blank" rel="noreferrer">출처 보기 ↗</a></>}</p>{image.kind === 'ai' && <p>AI로 만든 장면이며 실제 장소를 보여 주는 사진이 아니에요.</p>}</details></figcaption>
  </figure>;
}
export type StoryPlaybackPanelProps = {
  title: string;
  cards: StoryPlaybackCard[];
  index: number;
  playing: boolean;
  onSelect: (index: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  shared?: boolean;
};

export function StoryPlaybackPanel({ title, cards, index, playing, onSelect, onTogglePlay, onClose, shared = false }: StoryPlaybackPanelProps) {
  const id = useId();
  const count = Math.min(4, cards.length);
  const activeIndex = Number.isInteger(index) ? Math.max(0, Math.min(index, Math.max(0, count - 1))) : 0;
  const card = cards[activeIndex];
  const place = card?.placeId ? getPlace(card.placeId) : undefined;
  return <section className="city-story-playback" aria-labelledby={`${id}-heading`} data-tami-avoid="" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="city-story-playback-heading"><div><span className="city-story-eyebrow">{shared ? '공유된 도시 이야기' : '도시 이야기 재생'}</span><h2 id={`${id}-heading`}>{title || '도시 이야기'}</h2></div><button type="button" className="city-story-close" aria-label="이야기 재생 닫기" onClick={onClose}>×</button></header>
    <nav className="city-story-card-steps" aria-label="이야기 카드 선택">{Array.from({ length: 4 }, (_, position) => {
      const item = cards[position];
      return <button type="button" key={item?.id ?? position} aria-label={`${position + 1}번 이야기 카드${item ? `: ${item.title}` : ' 준비되지 않음'}`} aria-current={item && position === activeIndex ? 'step' : undefined} disabled={!item} onClick={() => onSelect(position)}><strong>{String(position + 1).padStart(2, '0')}</strong><span>{item?.imagination ? '상상' : position === 3 && !item ? '상상' : '사실'}</span></button>;
    })}</nav>
    {card ? <article className="city-story-playing-card" data-imagination={card.imagination} aria-live="polite" aria-atomic="true"><div className="city-story-card-meta"><span className="city-story-card-kind">{card.imagination ? 'AI 상상' : '사실 이야기'}</span><span>{activeIndex + 1} / 4{place ? ` · ${place.name}` : ''}</span></div><h3>{card.title}</h3>{card.image?.src && <StoryPlaybackImage key={`${card.id}:${card.image.src}`} image={card.image} title={card.title} />}<div className="city-story-playback-body"><p>{card.body}</p></div>{card.imagination && <p className="city-story-imagination-note">실제 기록과 구분해 읽는 상상 장면이에요.</p>}</article> : <div className="city-story-empty"><strong>아직 재생할 카드가 없어요</strong><p>카드뉴스가 준비되면 이곳에서 이야기와 지도를 함께 볼 수 있어요.</p></div>}
    <div className="city-story-playback-controls"><button type="button" aria-label="이전 이야기 카드" disabled={!count || activeIndex === 0} onClick={() => onSelect(activeIndex - 1)}>← 이전</button><button type="button" className="city-story-primary" aria-label={playing ? '이야기 일시정지' : '이야기 자동 재생'} disabled={!count} onClick={onTogglePlay}>{playing ? '일시정지' : '자동 재생'}</button><button type="button" aria-label="다음 이야기 카드" disabled={!count || activeIndex >= count - 1} onClick={() => onSelect(activeIndex + 1)}>다음 →</button></div>
    <p className="city-story-hint">지도를 직접 움직이면 자동 재생이 멈춰요.</p>
  </section>;
}
