import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteOrigin } from '@/domain/site';
import { AtlasShell } from '@/ui/shell/AtlasShell';
import './globals.css';

// Pages add their canonical path and link preview (pageMetadata in src/domain/site.ts).
export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
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
