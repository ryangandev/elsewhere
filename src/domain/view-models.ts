// What pages hand to client components: small, serializable, already-resolved data.
// Pages build these on the server from content (src/domain/page-views.ts); client components
// render them and never load content themselves. See docs/architecture.md#server-and-client-boundary.
import type { MapScene } from '@/globe/scene';
import type { Destination } from './destination';

/** A link to a country overview or one question, ready to render as a card. */
export type StoryLinkView = {
  /** destinationKey of the target, for React keys and "you are here" checks. */
  key: string;
  href: string;
  /** Emoji flag; empty for map identities without an ISO code. */
  flag: string;
  countryName: string;
  /** Set when the link leads to a question. */
  category?: string;
  /** The question, or the country's one-line hook. */
  title: string;
  /** Why to follow it: a next-question reason or a trail connection. */
  caption?: string;
};

/** A next question at the end of an answer, with how it relates to the question just read. */
export type NextQuestionView = StoryLinkView & {
  /** deeper: the same place, one step further; elsewhere: a connected question in another country. */
  relation: 'deeper' | 'elsewhere';
};

export type SourceView = { id: string; title: string; publisher: string; url: string };

export type ProvenanceView = {
  /** True when a model drafted the content; false for content written by hand. */
  aiAssisted: boolean;
  status: 'draft' | 'reviewed';
  /** YYYY-MM-DD. */
  reviewedAt?: string;
};

/** A labelled map place the reader can focus on. */
export type PlaceView = {
  id: string;
  name: string;
  note?: string;
  /** The country page for a place that is a country. */
  country?: { name: string; href: string };
};

/** What the reading panel says about the map scene. */
export type MapView = {
  /** One sentence telling the reader what to look at. */
  note: string;
  places: PlaceView[];
  hasRoute: boolean;
};

export type CitedText = { title: string; text: string; sources: SourceView[] };

export type QuickFactView = { label: string; value: string; asOf?: string };

export type TrailView = {
  id: string;
  title: string;
  label: string;
  description: string;
  /** Each stop links to its question on this trail; `caption` is the stop's connection. */
  stops: StoryLinkView[];
};

/** What the persistent shell needs to know about the current page. */
export type ShellDestination = {
  key: string;
  countryId: string;
  countryName: string;
  countryHref: string;
  storyId?: string;
  href: string;
};

/** Published by each page to the shell: where the reader is and what the globe shows. */
export type ShellPage = { destination: ShellDestination; scene: MapScene };

type PageBase = {
  shell: ShellPage;
  /** The heading: a question or a country name. */
  title: string;
  flag: string;
  country: {
    id: string;
    name: string;
    href: string;
    region: string;
    /** Label anchor, for the map caption. */
    lat: number;
    lng: number;
  };
};

/** An edited country overview. */
export type CountryPageView = PageBase & {
  kind: 'country';
  nativeName?: string;
  kicker: string;
  summary: string;
  quickFacts: QuickFactView[];
  whyItMatters: { title: string; text: string }[];
  map: MapView;
  /** The questions the overview leads with, right after the summary. */
  starters: StoryLinkView[];
  /** The country's other questions, offered without leading with them. */
  moreQuestions: StoryLinkView[];
  sources: SourceView[];
  provenance: ProvenanceView;
};

/** One answered question. */
export type StoryPageView = PageBase & {
  kind: 'story';
  storyId: string;
  category: string;
  summary: string;
  map: MapView;
  sections: CitedText[];
  takeaway: string;
  /** At most three, same place first: at least one deeper and one elsewhere. */
  next: NextQuestionView[];
  /** Trails this question is a stop on; the `?trail=` parameter picks one in the browser. */
  trails: TrailView[];
  sources: SourceView[];
  provenance: ProvenanceView;
};

/** A map identity without editorial content: basics from Natural Earth. */
export type MapCountryPageView = PageBase & {
  kind: 'map';
  population: { value: number; year: number } | null;
  /** The closest edited countries. */
  nearby: StoryLinkView[];
};

export type PageView = CountryPageView | StoryPageView | MapCountryPageView;

export type HomeView = {
  /** The few starting questions shown next to the question input (content/<locale>/home.json). */
  suggestions: StoryLinkView[];
};

/** The destination a page shows, without trail context. */
export function pageDestination(view: PageView): Destination {
  return view.kind === 'story'
    ? { countryId: view.country.id, storyId: view.storyId }
    : { countryId: view.country.id };
}
