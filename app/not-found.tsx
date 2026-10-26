import type { Metadata } from 'next';
import { NotFoundView } from '@/ui/shell/NotFoundView';

export const metadata: Metadata = { title: 'Not on the map' };

export default function NotFound() {
  return <NotFoundView />;
}
