'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { PLACES, type Place } from '@/lib/places';
import { defaultExplore, filterPlaces, normaliseExplore, PLACE_THEMES, type ExploreState } from '@/lib/workspace-state';
import TourismMap from './tourism-map';

export function PlacePhoto({ place, className = '', priority = false, retryable = false, sizes: requestedSizes }: { place: Place; className?: string; priority?: boolean; retryable?: boolean; sizes?: string }) {
  const [failed,setFailed]=useState(false);
  const [retry,setRetry]=useState(0);
  const sizes=requestedSizes ?? (place.photo&&place.photo.width/place.photo.height>3?'(max-width:600px) 1200px, 1600px':'(max-width:600px) 100vw, 750px');
  return <div className={`place-photo ${className}`}>
    {place.photo&&!failed?<Image key={retry} src={`${place.photo.src}${retry?`?retry=${retry}`:''}`} alt={`${place.name} 실제 사진`} fill sizes={sizes} priority={priority} onError={()=>setFailed(true)} />:<div className="photo-unavailable"><span>{failed?'사진을 불러오지 못했어요':'등록된 사진 없음'}</span><small>{place.name}</small>{failed&&retryable&&<button type="button" className="text-button" onClick={()=>{setFailed(false);setRetry(v=>v+1);}}>사진 다시 불러오기</button>}</div>}
  </div>;
}

export default function PlaceExplorer({visible,onCreate,state,onStateChange,savedIds,onToggleSaved,savedOnly=false}:{visible:boolean;onCreate:(place:Place)=>void;state:ExploreState;onStateChange:(next:ExploreState,push?:boolean)=>void;savedIds:string[];onToggleSaved:(id:string)=>void;savedOnly?:boolean}) {
  const [compact,setCompact]=useState(false);
  const [screenMode,setScreenMode]=useState<'pending'|'desktop'|'mobile'>('pending');
  const panel=useRef<HTMLElement>(null);
  const returnFocus=useRef<HTMLElement|null>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const results=useRef<HTMLDivElement>(null);
  const toolbar=useRef<HTMLDivElement>(null);
  const filtered=filterPlaces(state,savedOnly?savedIds:undefined);
  const selected=filtered.find(p=>p.id===state.selectedId)||null;
  const selectedId=selected?.id;
  const activeTheme=PLACE_THEMES.find(theme=>theme.id===state.theme);
  const themeConflict=!!activeTheme&&state.category!=='전체 유형'&&!activeTheme.types.includes(state.category);
  useEffect(()=>{
    const media=window.matchMedia('(max-width:1250px)'),mobile=window.matchMedia('(max-width:600px)');
    const update=()=>{setCompact(media.matches);setScreenMode(mobile.matches?'mobile':'desktop');};
    const frame=requestAnimationFrame(update);media.addEventListener('change',update);mobile.addEventListener('change',update);
    return()=>{cancelAnimationFrame(frame);media.removeEventListener('change',update);mobile.removeEventListener('change',update);};
  },[]);
  useEffect(()=>{
    if(!visible||!compact||!selectedId)return;
    const frame=requestAnimationFrame(()=>closeButton.current?.focus());
    return()=>cancelAnimationFrame(frame);
  },[visible,compact,selectedId]);
  useEffect(()=>{panel.current?.scrollTo({top:0});},[selectedId]);
  useEffect(()=>{
    const dialog=panel.current;
    if(!compact||!selectedId||!dialog)return;
    // Tami is portaled into this dialog from another React tree, so its key events reach the dialog only through the DOM.
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=='Tab')return;
      // Hidden Tami controls and closed details keep their layout boxes, so visibility decides what Tab can reach.
      const visible=(el:HTMLElement)=>typeof el.checkVisibility==='function'?el.checkVisibility({checkVisibilityCSS:true,visibilityProperty:true}):el.getClientRects().length>0;
      const nodes=[...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex]')].filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&visible(el));
      if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    dialog.addEventListener('keydown',trap);
    return()=>dialog.removeEventListener('keydown',trap);
  },[compact,selectedId]);
  function change(patch:Partial<ExploreState>,push=false){onStateChange(normaliseExplore({...state,...patch}),push);}
  function showMobileView(mobileView:ExploreState["mobileView"]){change({mobileView});requestAnimationFrame(()=>toolbar.current?.scrollIntoView({block:"start",behavior:"instant"}));}
  function choose(place:Place){returnFocus.current=document.activeElement as HTMLElement;change({selectedId:place.id,mapView:{lat:place.lat,lng:place.lng,zoom:15}},true);}
  function close(){change({selectedId:null},true);requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus();else results.current?.focus();});}
  function toggle(id:string){onToggleSaved(id);if(savedOnly&&state.selectedId===id&&savedIds.includes(id))change({selectedId:null});}
  return <section className="explorer-page" hidden={!visible} aria-label={savedOnly?'저장한 장소':'관광지 탐색'}>
    <div className="page-heading"><div><h1>{savedOnly?'다시 만나고 싶은 장소.':'성남의 어떤 장면을 만날까요?'}</h1><p>{savedOnly?'이 브라우저에 저장한 장소를 모았어요. 마음에 드는 곳으로 이야기를 이어가세요.':`공식 자료로 확인한 성남 관광지 ${PLACES.length}곳을 지도와 목록에서 찾아보세요.`}</p></div><span className="region-tag">경기도 성남시</span></div>
    <div className="explorer-filters">
      <label className="search-field"><span className="sr-only">관광지 검색</span><span aria-hidden="true">⌕</span><input maxLength={100} placeholder={savedOnly?`저장한 장소 ${savedIds.length}곳에서 검색`:`등록 관광지 ${PLACES.length}곳에서 검색`} value={state.query} onChange={event=>change({query:event.target.value,mapView:undefined})}/></label>
      <label><span className="sr-only">지역 필터</span><select value={state.district} onChange={event=>change({district:event.target.value,selectedId:null,mapView:undefined})}><option>전체 지역</option><option>수정구</option><option>중원구</option><option>분당구</option></select></label>
      <label><span className="sr-only">유형 필터</span><select value={state.category} onChange={event=>change({category:event.target.value,selectedId:null,mapView:undefined})}><option>전체 유형</option>{[...new Set(PLACES.map(p=>p.type))].map(type=><option key={type}>{type}</option>)}</select></label>
    </div>
    <div className="explorer-themes" role="group" aria-label="관광 주제"><button type="button" aria-pressed={state.theme==='all'} onClick={()=>change({theme:'all',selectedId:null,mapView:undefined})}>모든 주제</button>{PLACE_THEMES.map(theme=><button key={theme.id} type="button" aria-pressed={state.theme===theme.id} onClick={()=>change({theme:theme.id,category:'전체 유형',selectedId:null,mapView:undefined})}>{theme.label}</button>)}</div>
    <div ref={toolbar} className="explorer-toolbar"><p>{savedOnly?'저장 장소':'등록 장소'} <strong>{filtered.length}</strong>곳</p><div className="mobile-map-toggle"><button type="button" aria-pressed={state.mobileView==='list'} onClick={()=>showMobileView('list')}>목록</button><button type="button" aria-pressed={state.mobileView==='map'} onClick={()=>showMobileView('map')}>지도</button></div><button className="text-button" type="button" onClick={()=>onStateChange(defaultExplore())}>검색 조건 초기화</button></div>
    <div className={`explorer-layout ${selected?'has-detail':''} mobile-${state.mobileView}`}>
      <div ref={results} className="place-results" aria-label="관광지 검색 결과" data-tour="place-results" tabIndex={-1}>
        {filtered.length?filtered.map(place=><article key={place.id} className={`place-result-wrap${selected?.id===place.id?' selected':''}`}><button type="button" className={`place-result ${selected?.id===place.id?'selected':''}`} aria-pressed={selected?.id===place.id} onClick={()=>choose(place)}><PlacePhoto place={place}/><div><span className="place-category">{place.district} · {place.type}</span><h2>{place.name}</h2><p>{place.description}</p><span className="place-address">{place.address}</span></div></button><button className="save-place-button" type="button" aria-label={`${place.name} ${savedIds.includes(place.id)?'저장 해제':'저장'}`} aria-pressed={savedIds.includes(place.id)} onClick={()=>toggle(place.id)}>{savedIds.includes(place.id)?'♥ 저장됨':'♡ 저장'}</button></article>):<div className="explorer-empty"><h2>{savedOnly&&!savedIds.length?'저장한 장소가 아직 없어요.':'조건에 맞는 장소가 없어요.'}</h2><p>{savedOnly&&!savedIds.length?'성남 둘러보기에서 마음에 드는 장소의 저장 버튼을 눌러 주세요.':themeConflict?'선택한 주제와 유형에 함께 해당하는 장소가 없어요.':'다른 검색어나 지역으로 찾아보세요.'}</p>{themeConflict&&!(savedOnly&&!savedIds.length)&&<><button className="secondary-button" type="button" onClick={()=>change({theme:'all',selectedId:null,mapView:undefined})}>{activeTheme.label} 주제 해제</button><button className="secondary-button" type="button" onClick={()=>change({category:'전체 유형',selectedId:null,mapView:undefined})}>{state.category} 유형 해제</button></>}<button className="secondary-button" type="button" onClick={()=>onStateChange(defaultExplore())}>검색 조건 초기화</button></div>}
      </div>
      <div className="map-frame">{visible&&(screenMode==='desktop'||screenMode==='mobile'&&state.mobileView==='map')&&<TourismMap places={filtered} selectedId={selected?.id||null} focusId={selected?.id||null} onSelect={choose} viewport={state.mapView} onViewportChange={view=>change({mapView:view})} visible={visible}/>}</div>
      {selected&&<>
        {compact&&<button type="button" className="detail-backdrop" aria-label="장소 상세 닫기" tabIndex={-1} onClick={close}/>}
        <aside ref={panel} className="place-detail" data-tour="place-detail" role={compact?'dialog':'region'} aria-modal={compact||undefined} aria-label={`${selected.name} 상세 정보`} onKeyDown={event=>{
          if(event.key==='Escape'){event.preventDefault();close();}
        }}>
          <button ref={closeButton} type="button" className="detail-close" aria-label="장소 상세 닫기" onClick={close}>×</button>
          <PlacePhoto place={selected} key={selected.id} retryable/>
          <div className="detail-content"><span className="place-category">{selected.district} · {selected.type}</span><h2>{selected.name}</h2><button className="text-button detail-save" type="button" aria-pressed={savedIds.includes(selected.id)} onClick={()=>toggle(selected.id)}>{savedIds.includes(selected.id)?'♥ 저장한 장소에서 해제':'♡ 이 장소 저장'}</button><p className="detail-description">{selected.description}</p>
            <dl><dt>주소</dt><dd>{selected.address}</dd><dt>운영시간</dt><dd>{selected.operatingHours||'공식 안내 확인 필요'}</dd><dt>휴무</dt><dd>{selected.closedDays||'공식 안내 확인 필요'}</dd><dt>입장료</dt><dd>{selected.admission||'공식 안내 확인 필요'}</dd></dl>
            {selected.verificationNote&&<p className="field-note">{selected.verificationNote}</p>}
            <a className="official-link" data-tour="official-source" href={selected.sourceUrl} target="_blank" rel="noreferrer">공식 장소 안내 ↗</a>
            <a className="directions-link" href={`https://map.naver.com/p/search/${encodeURIComponent(`${selected.name} ${selected.address}`)}`} target="_blank" rel="noreferrer">네이버 지도에서 길찾기 ↗</a>
            <small className="verified-at">자료 확인 {selected.verifiedAt}</small>
            <details className="photo-credit"><summary>사진 출처와 이용 조건</summary>{selected.photo?<p>{selected.photo.author} · <a href={selected.photo.licenseUrl} target="_blank" rel="noreferrer">{selected.photo.license}</a><br/><a href={selected.photo.sourceUrl} target="_blank" rel="noreferrer">사진 원문 보기</a></p>:<p>현재 제공되는 사진이 없습니다.</p>}</details>
            <button className="primary-button" type="button" data-tour="create-from-place" onClick={()=>onCreate(selected)}>이 장소로 카드뉴스 만들기 <span aria-hidden="true">＋</span></button>
          </div>
        </aside>
      </>}
    </div>
  </section>;
}
