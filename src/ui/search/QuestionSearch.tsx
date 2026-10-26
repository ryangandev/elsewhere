'use client';

import { Compass } from 'lucide-react';
import { useMemo, useState, type FocusEvent, type KeyboardEvent, type Ref } from 'react';
import { askAtlas, topResult, type AskOutcome } from '@/domain/ask';
import type { AtlasLookup } from '@/domain/atlas-index';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useAtlasIndex } from '../atlas/use-indexes';
import { Command, CommandInput, CommandList } from '../primitives/command';
import { IdleResults } from './IdleResults';
import { ResultGroups } from './ResultGroups';
import { UnansweredResults } from './UnansweredResults';
import { useViewportRoom } from './use-viewport-room';
import './search.css';

type Props = {
  /**
   * home: the page's primary input; results open below it while it has focus and a query.
   * dialog: the header search (Cmd/Ctrl K); results always show, with a few starting points
   * before anything is typed.
   */
  variant: 'home' | 'dialog';
  inputRef?: Ref<HTMLInputElement>;
};

const IDLE: AskOutcome = { kind: 'idle' };

// Keys cmdk moves the highlight with, including its vim bindings.
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End']);
const isMove = (event: KeyboardEvent<HTMLInputElement>) =>
  MOVE_KEYS.has(event.key) || (event.ctrlKey && ['n', 'p', 'j', 'k'].includes(event.key));

/**
 * The question input and its results, shared by the home page and the search dialog so both
 * rank, group and render results the same way. Results appear as the reader types; arrow keys
 * move through them and Enter opens the highlighted one, which starts at the top result.
 * An unanswered query has no top result: nothing is highlighted and Enter does nothing until the
 * reader moves to a row, so a near miss is never opened in place of an answer.
 */
export function QuestionSearch({ variant, inputRef }: Props) {
  const { destination } = useAtlas();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const typed = query.trim().length > 0;
  // The index loads once the reader shows an interest, not with the page.
  const index = useAtlasIndex(variant === 'dialog' || focused || typed);
  const text = messages.search;

  const outcome = useMemo(
    () => (index.data ? askAtlas(index.data.index, query, destination?.countryId) : IDLE),
    [index.data, query, destination?.countryId],
  );
  // On the home page, results open below the input only when there is something to show.
  const open =
    variant === 'dialog' || (focused && typed && (outcome.kind !== 'idle' || !index.data));
  // The home input moves with the page layout, so its results measure the room they have.
  const root = useViewportRoom<HTMLDivElement>(variant === 'home' && open);

  // The highlighted row starts at the top result for each query and follows the keyboard or
  // pointer after that.
  const [selection, setSelection] = useState({ query: '', value: '' });
  const top = topResult(outcome)?.key ?? '';
  const selected = selection.query === query && selection.value ? selection.value : top;
  // cmdk always highlights a row, so whether the reader chose one is tracked here.
  const [movedFor, setMovedFor] = useState<string | null>(null);
  const unpicked = outcome.kind === 'unanswered' && movedFor !== query;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isMove(event)) {
      setMovedFor(query);
      // The first move reveals the row cmdk already holds, the top one, rather than skipping it.
      if (unpicked && event.key !== 'End') event.preventDefault();
    }
    if (event.key === 'Enter' && unpicked) event.preventDefault();
    if (event.key !== 'Escape' || variant !== 'home') return;
    event.preventDefault();
    if (typed) setQuery('');
    else event.currentTarget.blur();
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  return (
    <Command
      ref={root}
      shouldFilter={false}
      label={text.inputLabel}
      value={selected}
      onValueChange={(value) => setSelection({ query, value })}
      className={`question-search question-search-${variant}`}
      data-open={open || undefined}
      data-unpicked={unpicked || undefined}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        onKeyDown={onKeyDown}
        placeholder={text.placeholder}
        enterKeyHint="go"
      />
      {open && (
        <CommandList
          className="question-results"
          label={text.resultsLabel}
          // Keep focus in the input while a result is clicked.
          onMouseDown={(event) => event.preventDefault()}
          onPointerMove={() => setMovedFor(query)}
        >
          {index.data ? (
            <Results lookup={index.data} outcome={outcome} variant={variant} />
          ) : (
            <div className="search-status" role="status">
              <Compass size={22} />
              <p>{index.failed ? text.unavailable : text.loading}</p>
            </div>
          )}
        </CommandList>
      )}
      {variant === 'dialog' && (
        <div className="search-foot">
          <span>{text.keys}</span>
          {index.data && (
            <span>
              {format(text.footer, {
                questions: index.data.index.stories.length,
                places: index.data.index.countries.length,
              })}
            </span>
          )}
        </div>
      )}
    </Command>
  );
}

function Results({
  lookup,
  outcome,
  variant,
}: {
  lookup: AtlasLookup;
  outcome: AskOutcome;
  variant: Props['variant'];
}) {
  switch (outcome.kind) {
    case 'results':
      return <ResultGroups groups={outcome.groups} />;
    case 'unanswered':
      return <UnansweredResults outcome={outcome} />;
    case 'idle':
      return variant === 'dialog' ? <IdleResults lookup={lookup} /> : null;
  }
}
