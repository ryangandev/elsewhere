import { buildHomeView } from '@/domain/page-views';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { HomeView } from '@/ui/home/HomeView';
import { LegacyUrlRedirect } from '@/ui/shell/LegacyUrlRedirect';

export default function HomePage() {
  return (
    <>
      <ShellBridge page={null} />
      <HomeView view={buildHomeView()} />
      <LegacyUrlRedirect />
    </>
  );
}
