import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AtlasShell } from '@/ui/shell/AtlasShell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Elsewhere | A wider world', template: '%s | Elsewhere' },
  description:
    'Start with a question. See the answer on the map. Follow it somewhere new. A question-first atlas on an interactive 3D globe.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AtlasShell>{children}</AtlasShell>
      </body>
    </html>
  );
}
