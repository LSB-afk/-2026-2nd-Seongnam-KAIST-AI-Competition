import { notFound } from 'next/navigation';
import SharedCityStoryViewer from '@/components/shared-city-story-viewer';
import { getSharedCityStoryStore, sharedStoryIdSchema } from '@/lib/shared-city-story';

export const dynamic = 'force-dynamic';
export default async function StoryPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  // An unknown link gets the visible not-found page instead of an empty 3D viewer.
  if(!sharedStoryIdSchema.safeParse(id).success||!getSharedCityStoryStore().get(id))notFound();
  return <SharedCityStoryViewer id={id} />;
}
