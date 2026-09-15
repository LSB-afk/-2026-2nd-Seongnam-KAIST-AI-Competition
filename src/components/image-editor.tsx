"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { getPlace } from "@/lib/places";
import type { Card, ImageAsset, Run } from "@/lib/types";

type ImageConfig = { configured: boolean; reason?: string; model?: string };
export function CardPhoto({ card, retryable = false }: { card: Card; retryable?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const image = card.image;
  if (!image) return <div className="card-photo-empty">글로 만나는 장소 · 사진 없이 만든 카드</div>;
  if (failed) return <div className="card-photo-empty" role={retryable ? "status" : undefined}>
    <p>사진을 불러오지 못했습니다.</p>
    {retryable && <button type="button" className="secondary-button" onClick={() => { setAttempt(value => value + 1); setFailed(false); }}>사진 다시 불러오기</button>}
  </div>;
  return <div className="card-photo-frame"><Image key={attempt} src={image.src} alt={`${image.kind === "ai" ? "AI 생성 이미지" : "실제 사진"}: ${card.title}`} fill unoptimized sizes="500px" onError={() => setFailed(true)} style={{ objectFit: "cover", objectPosition: `${image.crop.x * 100}% ${image.crop.y * 100}%`, transform: `scale(${image.crop.zoom})`, transformOrigin: `${image.crop.x * 100}% ${image.crop.y * 100}%` }} /><span className="image-kind">{image.kind === "ai" ? (card.imagination || image.prompt?.imagination) ? "AI 생성 이미지 · 상상 이미지" : "AI 생성 이미지 · 실제 사진 아님" : card.imagination ? "상상 장면 · 사진은 실제 모습" : "실제 장소 사진"}</span></div>;
}

async function request<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "사진 변경을 처리하지 못했습니다.");
  return result;
}

export default function ImageEditor({ run, card, config, locked, onRun, onBusy }: { run: Run; card: Card; config?: ImageConfig; locked: boolean; onRun: (run: Run) => void; onBusy: (value: boolean) => void }) {
  const [crop, setCrop] = useState(card.image?.crop || { x: 0.5, y: 0.5, zoom: 1 });
  const [subject, setSubject] = useState("");
  const [rights, setRights] = useState(false);
  const [author, setAuthor] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const imageRunning = run.imageJob?.status === "running";
  const hasPlacePhoto = !!getPlace(run.brief.placeId ?? run.brief.place)?.photo;
  const preview: Card = card.image ? { ...card, image: { ...card.image, crop } } : card;
  async function edit(body: object, cancel = false) {
    setPending(true); onBusy(true); setError("");
    try { onRun(await request<Run>(`/api/runs/${run.id}/${cancel ? "image-cancel" : "image"}`, cancel ? { version: run.version } : { version: run.version, cardId: card.id, ...body })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "사진 편집에 실패했습니다."); }
    finally { setPending(false); onBusy(false); }
  }
  async function upload(selected?: File) {
    if (!selected || !rights) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size > 8 * 1024 * 1024) { setError("8MB 이하의 JPG, PNG, WebP 사진을 선택해 주세요."); return; }
    setPending(true); onBusy(true); setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("사진 파일을 읽지 못했습니다.")); reader.readAsDataURL(selected); });
      const asset = await request<ImageAsset>("/api/images", { data, mime: selected.type, placeId: run.brief.placeId || card.image?.placeId, author: author.trim() || "사용자 제공", license: "사용자가 이용 권한을 확인한 사진" });
      onRun(await request<Run>(`/api/runs/${run.id}/image`, { version: run.version, cardId: card.id, operation: "replace", assetId: asset.id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "사진을 업로드하지 못했습니다."); }
    finally { setPending(false); onBusy(false); if (file.current) file.current.value = ""; }
  }
  return <section className="image-editor" aria-label="카드 사진 편집">
    <p className="field-note">이 카드의 사진만 변경합니다. 문구는 유지되며 저장 후 다시 검수해야 합니다.</p>
    {error && <div className="image-error" role="alert">{error}</div>}
    {imageRunning && <div className="image-job" role="status"><strong>AI 이미지 제작 중</strong><p>장소와 카드의 내용을 바탕으로 이미지를 만들고 있습니다.</p><button type="button" className="secondary-button" disabled={pending} onClick={() => void edit({}, true)}>이미지 생성 취소</button></div>}
    {run.imageJob?.status === "failed" && <div className="image-error" role="status">이미지 생성에 실패했습니다. {run.imageJob.error} 아래에서 다시 생성할 수 있습니다.</div>}
    {run.imageJob?.status === "cancelled" && <p className="field-note">이미지 생성이 취소되었습니다. 기존 사진은 유지됩니다.</p>}
    <div className="crop-preview"><CardPhoto key={preview.image?.src} card={preview} retryable /></div>
    <fieldset disabled={locked || pending || imageRunning}>
      <h3>사진 구도 조정</h3>
      <label>가로 초점 <output>{Math.round(crop.x * 100)}%</output><input aria-label="사진 가로 초점" type="range" min={0} max={1} step={0.01} value={crop.x} onChange={(event) => setCrop({ ...crop, x: Number(event.target.value) })} /></label>
      <label>세로 초점 <output>{Math.round(crop.y * 100)}%</output><input aria-label="사진 세로 초점" type="range" min={0} max={1} step={0.01} value={crop.y} onChange={(event) => setCrop({ ...crop, y: Number(event.target.value) })} /></label>
      <label>사진 확대 <output>{crop.zoom.toFixed(2)}배</output><input aria-label="사진 확대 비율" type="range" min={1} max={3} step={0.05} value={crop.zoom} onChange={(event) => setCrop({ ...crop, zoom: Number(event.target.value) })} /></label>
      <button className="secondary-button" type="button" disabled={!card.image} onClick={() => void edit({ operation: "crop", crop })}>사진 구도 저장</button>
      <details className="image-options"><summary>사진 바꾸기</summary><button className="secondary-button" type="button" disabled={!hasPlacePhoto} onClick={() => void edit({ operation: "replace", usePlacePhoto: true })}>장소의 기본 사진 사용</button>{!hasPlacePhoto && <p className="field-note">이 장소에는 등록된 기본 사진이 없습니다. 사용 권한이 있는 내 사진을 추가할 수 있어요.</p>}<label>사진 촬영자<input value={author} maxLength={100} placeholder="촬영자 또는 제공자" onChange={(event) => setAuthor(event.target.value)} /></label><label className="rights-check"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} /><span>이 사진의 사용·수정 권한을 확인했습니다.</span></label><input ref={file} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="직접 사진 업로드" disabled={!rights || locked || pending} onChange={(event) => void upload(event.target.files?.[0])} /><button className="secondary-button" type="button" disabled={!rights} onClick={() => file.current?.click()}>내 사진 업로드</button><p className="field-note">JPG, PNG, WebP · 최대 8MB</p></details>
      <details className="image-options"><summary>AI 이미지로 새롭게 표현하기</summary><p className="field-note">장소·주제·구도·색감을 함께 반영합니다. 생성된 이미지는 실제 사진과 구분해 표시합니다.</p><label>이미지에 담을 장면<textarea value={subject} maxLength={500} rows={3} placeholder={card.imagination ? "시민이 함께 즐기는 미래 문화공간" : `${run.brief.place}의 특징이 드러나는 장면`} onChange={(event) => setSubject(event.target.value)} /></label><button className="primary-button" type="button" disabled={!config?.configured} onClick={() => void edit({ operation: "generate", subject: subject.trim() || undefined })}>이 카드 이미지 생성</button>{!config?.configured && <p className="field-note">AI 이미지 연결 설정 후 사용할 수 있습니다.</p>}{config?.reason && <details className="script-detail"><summary>연결 설정 안내</summary><p>{config.reason}</p></details>}</details>
    </fieldset>
    {card.image && <details className="image-options"><summary>현재 이미지 출처</summary><p>{card.image.author} · {card.image.license}</p><p>{card.image.width} × {card.image.height}px</p>{(card.image.width < 1080 || card.image.height < 430) && <p className="image-resolution-note">원본 사진의 해상도가 출력 크기보다 작아 확대 시 선명도가 낮아질 수 있습니다.</p>}{card.image.sourceUrl && <a href={card.image.sourceUrl} target="_blank" rel="noreferrer">출처 보기 ↗</a>}</details>}
  </section>;
}
