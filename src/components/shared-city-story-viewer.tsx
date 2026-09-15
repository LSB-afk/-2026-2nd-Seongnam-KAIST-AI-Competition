'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { DioramaSelection } from '@/lib/diorama/data';
import './diorama/city-story-shell.css';

const DioramaPage=dynamic(()=>import('./diorama/diorama-page'),{ssr:false,loading:()=> <p role="status">공유된 도시 이야기를 준비하고 있어요.</p>});
const noAction=()=>{};
export default function SharedCityStoryViewer({id}:{id:string}) {
  const [selection,setSelection]=useState<DioramaSelection>({placeId:'seongnam',hotspotId:null});
  const [closed,setClosed]=useState(false);
  return <main aria-label="공유 도시 이야기">
    <Link prefetch={false} className="city-shared-home" href="/" aria-label="타임스토리 홈">⌂</Link>
    {closed?<section className="city-shared-finished"><h1>이야기를 함께 둘러봤어요.</h1><button type="button" onClick={()=>setClosed(false)}>이야기 다시 보기</button><Link prefetch={false} href="/">나도 도시 이야기 만들기 ↗</Link></section>:<DioramaPage readOnly selection={selection} onSelectionChange={next=>{setSelection(next);const url=new URL(location.href);url.searchParams.set('scene',next.placeId);window.history.replaceState(window.history.state,'',url);}} savedIds={[]} onToggleSaved={noAction} onCreate={noAction} onCreateStory={noAction} onImagine={noAction} onCloseStory={()=>setClosed(true)} storyId={id} busy={false} />}
  </main>;
}
