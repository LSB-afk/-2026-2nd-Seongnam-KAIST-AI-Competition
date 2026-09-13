'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorkspace, decodeWorkspace, WORKSPACE_STORAGE_KEY, workspaceFromSearch, workspaceSearch, type DraftState, type WorkspaceState } from '@/lib/workspace-state';

export function useWorkspace(defaultDraft: DraftState) {
  const [state,setState]=useState(()=>createWorkspace(defaultDraft));
  const current=useRef(state);
  const fallback=useRef(defaultDraft);
  const [ready,setReady]=useState(false);
  const [storageError,setStorageError]=useState('');
  const save=useCallback((value:WorkspaceState)=>{
    try { localStorage.setItem(WORKSPACE_STORAGE_KEY,JSON.stringify(value));setStorageError(''); }
    catch { setStorageError('이 브라우저에 입력과 저장 장소를 보관하지 못했습니다. 현재 화면에서 작업은 계속할 수 있습니다.'); }
  },[]);
  const update=useCallback((change:Partial<WorkspaceState>|((previous:WorkspaceState)=>WorkspaceState),historyMode:'push'|'replace'='replace')=>{
    const next=typeof change==='function'?change(current.current):{...current.current,...change};
    current.current=next;setState(next);save(next);
    const target=`${location.pathname}${workspaceSearch(next)}`;
    if(`${location.pathname}${location.search}`!==target) {
      if(historyMode==='push') window.history.pushState(window.history.state,'',target);
      else window.history.replaceState(window.history.state,'',target);
    }
  },[save]);
  useEffect(()=>{
    let alive=true;
    const frame=requestAnimationFrame(()=>{
      if(!alive)return;
      let saved:string|null=null;
      try {saved=localStorage.getItem(WORKSPACE_STORAGE_KEY);}catch{setStorageError('브라우저 저장소를 읽지 못했습니다. 현재 화면에서 작업은 계속할 수 있습니다.');}
      const next=workspaceFromSearch(decodeWorkspace(saved,fallback.current),location.search,true);
      current.current=next;setState(next);setReady(true);
      window.history.replaceState(window.history.state,'',`${location.pathname}${workspaceSearch(next)}`);
    });
    const pop=()=>{const next=workspaceFromSearch(current.current,location.search);current.current=next;setState(next);save(next);};
    window.addEventListener('popstate',pop);
    return()=>{alive=false;cancelAnimationFrame(frame);window.removeEventListener('popstate',pop);};
  },[save]);
  const getSnapshot=useCallback(()=>current.current,[]);
  return {state,ready,update,storageError,getSnapshot};
}
