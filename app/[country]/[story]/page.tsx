import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { describeDestination } from '@/domain/describe';
import { destinationFromPath } from '@/domain/paths';
import { storyStaticParams } from '@/domain/static-params';
import { DestinationPanel } from '@/ui/panel/DestinationPanel';

type Props = { params: Promise<{ country: string; story: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return storyStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, story } = await params;
  const destination = destinationFromPath(`/${country}/${story}`);
  const summary = destination && describeDestination(destination);
  if (!summary) return {};
  return {
    title: summary.title,
    description: summary.description,
    openGraph: { title: summary.title, description: summary.description, type: 'article' },
  };
}

export default async function StoryPage({ params }: Props) {
  const { country, story } = await params;
  const destination = destinationFromPath(`/${country}/${story}`);
  if (!destination?.topicId) notFound();
  return <DestinationPanel countryId={destination.countryId} topicId={destination.topicId} />;
}
