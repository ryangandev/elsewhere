'use client';

import { X } from 'lucide-react';
import { useRef } from 'react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/dialog';
import { QuestionSearch } from '../search/QuestionSearch';

/** The header search (Cmd/Ctrl K): the same question input and results as the home page. */
export function SearchDialog() {
  const { dialog, openDialog } = useAtlas();
  const inputRef = useRef<HTMLInputElement>(null);
  const open = dialog === 'search';
  const text = messages.search;

  return (
    <Dialog open={open} onOpenChange={(next) => openDialog(next ? 'search' : null)}>
      <DialogContent
        className="atlas-search"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{text.title}</DialogTitle>
        <DialogDescription className="sr-only">{text.description}</DialogDescription>
        <div className="search-heading">
          <span>{text.heading}</span>
          <button aria-label={text.close} onClick={() => openDialog(null)}>
            <X size={17} />
          </button>
        </div>
        {open && <QuestionSearch variant="dialog" inputRef={inputRef} />}
      </DialogContent>
    </Dialog>
  );
}
