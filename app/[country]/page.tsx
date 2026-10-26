import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { describeDestination } from '@/domain/describe';
import { destinationFromPath } from '@/domain/paths';
import { countryStaticParams } from '@/domain/static-params';
import { DestinationPanel } from '@/ui/panel/DestinationPanel';

type Props = { params: Promise<{ country: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return countryStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  const destination = destinationFromPath(`/${country}`);
  const summary = destination && describeDestination(destination);
  if (!summary) return {};
  return {
    title: summary.title,
    description: summary.description,
    openGraph: { title: summary.title, description: summary.description },
  };
}

export default async function CountryPage({ params }: Props) {
  const { country } = await params;
  const destination = destinationFromPath(`/${country}`);
  if (!destination) notFound();
  return <DestinationPanel countryId={destination.countryId} />;
}
