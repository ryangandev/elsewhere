'use client';

import { Link2 } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/dialog';

/** Fallback for browsers that refuse clipboard access: show the link to copy by hand. */
export function ShareDialog() {
  const { shareUrl, closeShare } = useAtlas();
  const text = messages.share;

  return (
    <Dialog open={shareUrl !== ''} onOpenChange={(open) => !open && closeShare()}>
      <DialogContent className="share-dialog">
        <Link2 size={24} />
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
        <input
          aria-label={text.inputLabel}
          readOnly
          value={shareUrl}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button onClick={closeShare}>{text.done}</button>
      </DialogContent>
    </Dialog>
  );
}
