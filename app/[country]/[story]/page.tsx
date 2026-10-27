import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { describePage, matchStoryRoute, storyStaticParams } from '@/domain/page-views';
import { pageMetadata } from '@/domain/site';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { DestinationPanel } from '@/ui/panel/DestinationPanel';

type Props = { params: Promise<{ country: string; story: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return storyStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, story } = await params;
  const view = matchStoryRoute(country, story);
  if (!view) return {};
  return pageMetadata({ ...describePage(view), type: 'article' });
}

export default async function StoryPage({ params }: Props) {
  const { country, story } = await params;
  const view = matchStoryRoute(country, story);
  if (!view) notFound();
  return (
    <>
      <ShellBridge page={view.shell} />
      <DestinationPanel view={view} />
    </>
  );
}
