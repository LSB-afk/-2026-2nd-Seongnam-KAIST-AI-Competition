'use client';

import { useState } from 'react';
import type { Run } from '@/lib/types';
import { storyQrSvg } from '@/lib/story-qr';
import './diorama/city-story-shell.css';

export function CityStoryShare({run,onPreview}:{run:Run;onPreview:()=>void}) {
  const [pending,setPending]=useState(false);
  const [url,setUrl]=useState('');
  const [notice,setNotice]=useState('');
  const [qr,setQr]=useState('');
  async function share() {
    setPending(true);setNotice('');
    try {
      const response=await fetch('/api/stories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:run.id,version:run.version})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'공유본을 만들지 못했습니다.');
      const link=new URL(`/stories/${data.id}`,location.origin);
      setUrl(link.href);
      try {setQr(storyQrSvg(link.href));}catch{setQr('');setNotice('링크가 길어 QR을 만들지 못했어요. 링크를 복사해 공유하세요.');}
    }catch(error){setNotice(error instanceof Error?error.message:'공유본을 만들지 못했습니다.');}
    finally{setPending(false);}
  }
  return <section className="city-story-share" aria-label="3D 이야기와 공유">
    <button type="button" className="secondary-button" onClick={onPreview}>카드와 3D 장면 함께 보기 ↗</button>
    {run.status==='approved'?<button type="button" className="primary-button" disabled={pending} onClick={()=>void share()}>{pending?'공유본을 만드는 중…':url?'승인된 공유본 다시 확인':'공유 링크·QR 만들기'}</button>:<p>최종 승인 후 읽기 전용 이야기 링크와 QR을 만들 수 있어요.</p>}
    {url&&<><label>공유 이야기 주소<input readOnly aria-label="공유 이야기 주소" value={url} onFocus={event=>event.currentTarget.select()} /></label>
      <button type="button" className="secondary-button" onClick={()=>void navigator.clipboard.writeText(url).then(()=>setNotice('공유 링크를 복사했어요.')).catch(()=>setNotice('자동 복사가 되지 않았어요. 주소를 선택해 복사하세요.'))}>링크 복사</button>
      <a href={url} target="_blank" rel="noreferrer">읽기 전용 공유본 열기 ↗</a>
      {qr&&<><div className="city-story-share-qr" role="img" aria-label="3D 이야기 공유 QR 코드" dangerouslySetInnerHTML={{__html:qr}} /><button type="button" className="secondary-button" onClick={()=>{const objectUrl=URL.createObjectURL(new Blob([qr],{type:'image/svg+xml'}));const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download='성남-이야기-QR.svg';anchor.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}}>QR 이미지 저장 ↓</button></>}
      <p>공유본은 승인된 v{run.version}의 카드·출처·지도 구도를 보관해요. 초안 메모와 담당자 이름은 포함하지 않아요.</p>
      {['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)&&<p>현재 주소는 이 컴퓨터의 로컬 서버예요. 휴대폰 등 다른 기기에서 열려면 공개 서버 주소가 필요해요.</p>}
    </>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
