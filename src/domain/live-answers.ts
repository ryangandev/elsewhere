// Stage 2 seam: answering a question the reviewed question bank does not cover.
// Stage 1 ships static, reviewed content only (docs/product.md#stages), so nothing implements
// this yet: an unanswered question gets an honest fallback instead (the `unanswered` outcome of
// `askAtlas` in ./ask.ts, rendered by src/ui/search/UnansweredResults.tsx). A provider plugs in
// there and returns the same view model a reviewed answer renders with, so the reading panel
// and the globe need no changes when one is added.
import type { StoryPageView } from './view-models';

export type LiveAnswerProvider = {
  /** A sourced answer with its map scene, or null when the question cannot be answered. */
  answer(question: string, options: { signal: AbortSignal }): Promise<StoryPageView | null>;
};
