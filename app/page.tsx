import { buildHomeView } from '@/domain/page-views';
import { ShellBridge } from '@/ui/atlas/ShellBridge';
import { Discovery } from '@/ui/shell/Discovery';
import { LegacyUrlRedirect } from '@/ui/shell/LegacyUrlRedirect';

export default function HomePage() {
  return (
    <>
      <ShellBridge page={null} />
      <Discovery view={buildHomeView()} />
      <LegacyUrlRedirect />
    </>
  );
}
