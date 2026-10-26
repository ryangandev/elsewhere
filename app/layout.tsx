import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AtlasShell } from '@/ui/shell/AtlasShell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Elsewhere | A wider world', template: '%s | Elsewhere' },
  description:
    'Follow your curiosity around an interactive 3D globe. Ten country stories, thirty questions, and trails that connect them.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
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
