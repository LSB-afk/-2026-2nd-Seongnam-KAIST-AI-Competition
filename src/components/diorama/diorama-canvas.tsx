'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DioramaSelection } from '@/lib/diorama/data';
import type { DioramaRenderer, RenderCallbacks, RenderOptions } from '@/lib/diorama/renderer';
import type { StoryCameraView } from '@/lib/city-story';
import './city-markers.css';

export type DioramaCanvasHandle = { zoom: (factor: number) => void; reset: () => void; viewFromAbove: () => void; focusCoordinate: (coordinates: readonly [number, number]) => void; getCameraSnapshot: () => StoryCameraView | null };
type Props = { selection: DioramaSelection; options: RenderOptions; callbacks: RenderCallbacks; retry: number };

const DioramaCanvas = forwardRef<DioramaCanvasHandle, Props>(function DioramaCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<DioramaRenderer | null>(null);
  const reportFailure = useRef<((message: string) => void) | null>(null);
  const current = useRef(props);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  useImperativeHandle(ref, () => ({ zoom: factor => renderer.current?.zoom(factor), reset: () => renderer.current?.reset(), viewFromAbove: () => renderer.current?.viewFromAbove(), focusCoordinate: coordinates => renderer.current?.focusCoordinate(coordinates), getCameraSnapshot: () => renderer.current?.getCameraSnapshot() ?? null }), []);
  useEffect(() => { current.current = props; });
  useEffect(() => {
    let alive = true;
    let failed = false;
    let ownedRenderer: DioramaRenderer | null = null;
    const container = host.current;
    if (!container) return;
    const release = () => {
      if (renderer.current === ownedRenderer) renderer.current = null;
      ownedRenderer?.dispose(); ownedRenderer = null;
    };
    const fail = (message: string) => {
      if (!alive || failed) return;
      failed = true;
      release();
      setError(message); setStatus('error'); current.current.callbacks.onError(message);
    };
    reportFailure.current = fail;
    queueMicrotask(() => { if (alive && !failed) { setError(''); setStatus('loading'); } });
    void import('@/lib/diorama/renderer').then(({ createDioramaRenderer }) => {
      if (!alive) return;
      const callbacks: RenderCallbacks = {
        onReady: (stopId, id) => { if (alive && !failed) { setStatus('ready'); current.current.callbacks.onReady(stopId, id); } },
        onArrived: (stopId, id) => { if (alive && !failed) current.current.callbacks.onArrived(stopId, id); },
        onManual: () => { if (alive && !failed) current.current.callbacks.onManual(); },
        onHidden: () => { if (alive && !failed) current.current.callbacks.onHidden?.(); },
        onHotspot: id => { if (alive && !failed) current.current.callbacks.onHotspot(id); },
        onSelect: selection => { if (alive && !failed) current.current.callbacks.onSelect?.(selection); },
        onUrbanSelect: id => { if (alive && !failed) current.current.callbacks.onUrbanSelect?.(id); },
        onFood: id => { if (alive && !failed) current.current.callbacks.onFood?.(id); },
        onError: fail,
      };
      const created = createDioramaRenderer(container, callbacks);
      if (!alive || failed) { created.dispose(); return; }
      ownedRenderer = created; renderer.current = created;
      created.apply(current.current.selection, current.current.options);
    }).catch(() => fail('이 기기에서 입체 화면을 불러오지 못했어요. 실제 사진과 장소 정보는 계속 볼 수 있어요.'));
    return () => {
      alive = false; release();
      if (reportFailure.current === fail) reportFailure.current = null;
    };
  }, [props.retry]);
  useEffect(() => {
    if (!renderer.current) return;
    try { renderer.current.apply(props.selection, props.options); }
    catch {
      reportFailure.current?.('입체 모형을 불러오지 못했어요. 실제 사진과 장소 정보를 확인해 주세요.');
    }
  }, [props.selection, props.options]);
  return <div className="diorama-canvas" data-testid="diorama-stage" data-status={status} data-navigation-mode={props.options.navigationMode ?? 'pan'} role="group" aria-label="성남 3D 지도" aria-describedby="diorama-navigation-help">
    <div ref={host} className="diorama-webgl" />
    {status === 'loading' && <div className="diorama-loading" role="status"><span className="diorama-loading-cube" aria-hidden="true" /><strong>성남의 작은 풍경을 준비해요</strong><span>잠시 후 지도를 끌어서 둘러볼 수 있어요.</span></div>}
    {status === 'error' && <div className="diorama-render-error" role="status"><strong>사진으로 먼저 만나볼까요?</strong><p>{error}</p></div>}
  </div>;
});

export default DioramaCanvas;
