'use client';

import { Globe2 } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet';
import './dialogs.css';

export function AboutSheet() {
  const { dialog, openDialog } = useAtlas();
  const text = messages.about;

  return (
    <Sheet open={dialog === 'about'} onOpenChange={(open) => openDialog(open ? 'about' : null)}>
      <SheetContent className="about-sheet atlas-drawer">
        <Globe2 size={35} />
        <SheetTitle>{text.title}</SheetTitle>
        <SheetDescription>{text.description}</SheetDescription>
        <p>{text.purpose}</p>
        <p>{text.howItWorks}</p>
        <div className="about-rule" />
        <h3>{text.coverageTitle}</h3>
        <p>{text.coverage}</p>
        <p>{text.method}</p>
        <p>{text.privacy}</p>
        <p className="credits">{text.credits}</p>
      </SheetContent>
    </Sheet>
  );
}
