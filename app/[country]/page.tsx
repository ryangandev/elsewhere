import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { countryStaticParams, describePage, matchCountryRoute } from '@/domain/page-views';
import { pageMetadata } from '@/domain/site';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { DestinationPanel } from '@/ui/panel/DestinationPanel';

type Props = { params: Promise<{ country: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return countryStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = matchCountryRoute((await params).country);
  if (!view) return {};
  return pageMetadata(describePage(view));
}

export default async function CountryPage({ params }: Props) {
  const view = matchCountryRoute((await params).country);
  if (!view) notFound();
  return (
    <>
      <ShellBridge page={view.shell} />
      <DestinationPanel view={view} />
    </>
  );
}
