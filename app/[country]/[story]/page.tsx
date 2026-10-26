import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { describePage, matchStoryRoute, storyStaticParams } from '@/domain/page-views';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { DestinationPanel } from '@/ui/panel/DestinationPanel';
import { PathRedirect } from '@/ui/shell/PathRedirect';

type Props = { params: Promise<{ country: string; story: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return storyStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country, story } = await params;
  const match = matchStoryRoute(country, story);
  if (!match) return {};
  if (match.kind === 'redirect')
    return { robots: { index: false }, alternates: { canonical: match.href } };
  const summary = describePage(match.view);
  return {
    title: summary.title,
    description: summary.description,
    openGraph: { title: summary.title, description: summary.description, type: 'article' },
  };
}

export default async function StoryPage({ params }: Props) {
  const { country, story } = await params;
  const match = matchStoryRoute(country, story);
  if (!match) notFound();
  if (match.kind === 'redirect') return <PathRedirect href={match.href} />;
  return (
    <>
      <ShellBridge page={match.view.shell} />
      <DestinationPanel view={match.view} />
    </>
  );
}
