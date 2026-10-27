import type { Metadata } from 'next';
import { buildHomeView } from '@/domain/page-views';
import { pageMetadata, SITE_DESCRIPTION } from '@/domain/site';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { HomeView } from '@/ui/home/HomeView';

export const metadata: Metadata = pageMetadata({ path: '/', description: SITE_DESCRIPTION });

export default function HomePage() {
  return (
    <>
      <ShellBridge page={null} />
      <HomeView view={buildHomeView()} />
    </>
  );
}
