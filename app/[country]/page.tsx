import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { countryStaticParams, describePage, matchCountryRoute } from '@/domain/page-views';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { DestinationPanel } from '@/ui/panel/DestinationPanel';
import { PathRedirect } from '@/ui/shell/PathRedirect';

type Props = { params: Promise<{ country: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return countryStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const match = matchCountryRoute((await params).country);
  if (!match) return {};
  if (match.kind === 'redirect')
    return { robots: { index: false }, alternates: { canonical: match.href } };
  const summary = describePage(match.view);
  return {
    title: summary.title,
    description: summary.description,
    openGraph: { title: summary.title, description: summary.description },
  };
}

export default async function CountryPage({ params }: Props) {
  const match = matchCountryRoute((await params).country);
  if (!match) notFound();
  if (match.kind === 'redirect') return <PathRedirect href={match.href} />;
  return (
    <>
      <ShellBridge page={match.view.shell} />
      <DestinationPanel view={match.view} />
    </>
  );
}
