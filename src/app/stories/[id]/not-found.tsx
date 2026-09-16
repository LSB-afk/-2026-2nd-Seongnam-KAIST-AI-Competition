import Link from 'next/link';
import '@/components/diorama/city-story-shell.css';

export default function StoryNotFound() {
  return <main aria-label="공유 도시 이야기">
    <section className="city-shared-finished city-shared-missing">
      <h1>공유된 이야기를 찾을 수 없어요</h1>
      <p>링크 주소가 잘못되었거나 일부가 빠졌을 수 있어요. 공유한 사람에게 링크를 다시 받아 열어 주세요.</p>
      <Link prefetch={false} href="/">성남 타임스토리 홈으로</Link>
    </section>
  </main>;
}
