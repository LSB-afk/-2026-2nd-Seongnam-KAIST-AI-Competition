import type { Run } from "@/lib/types";

export default function ReadingTransform({ run, busy, liveConfigured, unsaved, onTransform }: {
  run: Run; busy: boolean; liveConfigured: boolean; unsaved: boolean; onTransform: () => void;
}) {
  if (!run.cards.length) return null;
  const protectedCount = run.cards.filter(card => run.protectedCardIds?.includes(card.id)).length;
  const allProtected = protectedCount === run.cards.length;
  const unavailable = run.mode === "live" && !liveConfigured;
  if (run.brief.readingStyle === "easy") return <div className="reading-transform"><h3>쉬운 설명을 적용한 카드뉴스</h3><p>짧은 문장과 풀어 쓴 용어로 구성했습니다. 문장별 근거와 현재 버전의 검수 결과를 확인해 주세요.{protectedCount > 0 && ` 직접 편집한 ${protectedCount}장은 기존 문구를 유지합니다.`}</p></div>;
  return <details className="reading-transform"><summary>이 카드뉴스를 쉬운 설명으로 바꾸기</summary><p>날짜·장소·사실관계는 유지하고 설명을 풀어 씁니다. 새 버전을 만들고 다시 검수하므로 기존 승인은 해제됩니다.</p>
    {run.mode === "fixture" ? <p>데모에서는 준비된 문구와 용어만 바꿉니다. 자유롭게 편집한 문장을 이해해 다시 쓰는 기능은 아닙니다.</p> : <p>실제 AI를 사용하며, 이 작업의 남은 호출·시간·비용 한도 안에서 처리합니다.</p>}
    {protectedCount > 0 && <p>직접 편집한 {protectedCount}장은 보호하고 나머지 카드만 바꿉니다. 사진과 구도는 유지합니다.</p>}
    {unsaved && <p>저장하지 않은 편집 문구는 변환에 포함되지 않습니다. 초안은 보관되며 새 버전에서 직접 불러올 수 있습니다.</p>}
    {unavailable && <p>실제 AI 연결 설정을 확인한 뒤 변환할 수 있습니다.</p>}
    <button type="button" className="secondary-button" disabled={busy || allProtected || unavailable} onClick={onTransform}>{allProtected ? "모든 카드가 직접 편집되어 보호 중입니다" : busy ? "작업이 끝나면 변환할 수 있어요" : "쉬운 설명으로 바꾸고 재검수"}</button>
  </details>;
}
