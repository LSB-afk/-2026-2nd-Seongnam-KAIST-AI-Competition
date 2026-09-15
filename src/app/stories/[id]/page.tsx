import { notFound } from 'next/navigation';
import SharedCityStoryViewer from '@/components/shared-city-story-viewer';

export const dynamic = 'force-dynamic';
export default async function StoryPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound();
  return <SharedCityStoryViewer id={id} />;
}
