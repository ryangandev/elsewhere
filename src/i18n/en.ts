/**
 * English interface strings, grouped by screen area and keyed by stable message IDs.
 * Components refer to `messages.<area>.<id>`, never to the English text, so a second language
 * is a second catalog of the same shape. Placeholders look like `{name}` and are filled by `format`.
 */
export const en = {
  topbar: {
    skip: 'Skip to stories',
    home: 'Elsewhere home',
    tagline: 'A little curiosity. A wider world.',
    trails: 'Trails',
    trailsLabel: 'Explore trails',
    atlas: 'Your atlas',
    atlasLabel: 'Open your atlas',
    search: 'Ask a question',
    searchLabel: 'Ask a question or find a country',
    shortcutApple: '⌘ K',
    shortcutOther: 'Ctrl K',
  },
  home: {
    eyebrow: 'A QUESTION-FIRST ATLAS',
    titleStart: 'Start with',
    titleEmphasis: 'a question.',
    intro: 'See the answer on the map. Follow it somewhere new.',
    suggestions: 'OR BEGIN WITH ONE OF THESE',
    moreLabel: 'More ways in',
    resume: 'Continue',
    trails: 'Follow a trail across the world',
  },
  notFound: {
    eyebrow: 'NOT ON THE MAP',
    title: 'We couldn’t find that place.',
    description:
      'The address may be mistyped, or that story is not in this edition yet. Ask the atlas instead.',
    back: 'Back to the globe',
  },
  map: {
    loading: 'Bringing the world closer',
  },
  breadcrumb: {
    label: 'Current place',
    world: 'World',
  },
  caption: {
    closerLook: 'A CLOSER LOOK',
    geographyMakesTheStory: 'GEOGRAPHY MAKES THE STORY',
    everyPlace: 'EVERY PLACE IS CONNECTED',
    backToConnection: 'Back to the connection',
    coordinates: '{lat}° {latHemisphere}, {lng}° {lngHemisphere}',
  },
  controls: {
    label: 'Globe controls',
    reset: 'Reset map view',
    resetHint: 'Return to this view',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
  },
  footer: {
    ready: 'ONE PLANET. MANY PERSPECTIVES.',
    error: 'THE STORIES ARE STILL HERE.',
    loading: 'BRINGING THE WORLD CLOSER...',
    drag: 'Drag to explore',
    scroll: 'Scroll to zoom',
    followQuestion: 'Follow a question',
    about: 'About this atlas',
  },
  notice: {
    linkCopied: 'Link copied. A little curiosity, ready to share.',
    removed: 'Removed from your atlas.',
    savedForSession: 'Saved for this session.',
    saved: 'Saved to your atlas.',
  },
  about: {
    title: 'Curiosity is enough.',
    description:
      'You don’t need a study plan to understand the world. Just a place that catches your eye.',
    purpose:
      'Elsewhere is an atlas for the questions that come before the deep dive. Where is it? Why does it matter? How did it get this way?',
    howItWorks: 'Start with a minute. Follow a connection. The map is always home.',
    coverageTitle: 'A whole map. Ten edited profiles.',
    coverage:
      'All 258 country and territory units have sourced geographic basics and static learning guides. Ten edited profiles, thirty questions, and three trails offer a deeper starting point.',
    method:
      'Questions search the stories already in this edition. There is no AI-generated advice or live news. Population figures are a dated 2024 reference.',
    privacy:
      'Your atlas and recent explorations stay in this browser. No account is needed, and these choices are not sent to a server.',
    credits:
      'Boundaries: Natural Earth. Globe imagery: NASA Blue Marble. Sources and further reading accompany the stories. Boundaries are generalized for exploration and do not express a political position. Map routes are illustrative.',
  },
  dialog: {
    close: 'Close',
  },
  share: {
    title: 'A little curiosity, shared.',
    description: 'Copy this link to return to this exact country, question, or trail.',
    inputLabel: 'Share link',
    done: 'Done',
  },
  search: {
    title: 'Ask the atlas',
    description: 'Ask a question or name a country. Results come from the reviewed stories.',
    heading: 'ASK THE ATLAS',
    close: 'Close search',
    placeholder: 'What are you curious about?',
    inputLabel: 'Ask a question or name a country',
    resultsLabel: 'Questions and places',
    groupQuestions: 'QUESTIONS',
    groupCountries: 'COUNTRIES',
    groupMap: 'ON THE MAP',
    groupHere: 'MORE ABOUT {country}',
    groupSuggested: 'BEGIN WITH ONE OF THESE',
    groupClosest: 'CLOSEST QUESTIONS',
    groupNamed: 'PLACES IN YOUR QUESTION',
    countryStory: 'Overview and questions',
    basicOverview: 'Map basics',
    loading: 'Opening the atlas…',
    unavailable: 'The atlas could not be loaded. Check your connection and try again.',
    unansweredTitle: 'The atlas has not answered that yet.',
    noMatchTitle: 'Nothing in the atlas matches that yet.',
    unansweredClosest:
      'Every answer here is drawn from sources and reviewed, so the atlas grows one question at a time. These come closest.',
    unansweredNothingClose:
      'Every answer here is drawn from sources and reviewed, so the atlas grows one question at a time.',
    keys: '↑ ↓ to move · ↵ to open',
    footer: '{questions} answered questions · {places} places on the map',
  },
  trails: {
    titleStart: 'One question.',
    titleEmphasis: 'A wider world.',
    description:
      'Short trails through connected ideas. Start anywhere. Leave whenever curiosity takes you elsewhere.',
    follow: 'Follow this trail',
    stops: 'stops',
  },
  library: {
    title: 'Your little atlas.',
    description: 'A few places to come back to.',
    storageUnavailable: 'Browser storage is unavailable; kept for this session only.',
    storedLocally: 'Saved on this browser, just for you.',
    saved: 'Saved',
    recent: 'Recent',
    emptySavedTitle: 'Keep a little curiosity for later.',
    emptySaved:
      'Tap the bookmark on a country or question. It will be waiting here when you return.',
    emptyRecentTitle: 'Your next discovery starts here.',
    emptyRecent: 'The places and questions you explore will appear here.',
    startWith: 'Start with {name}',
    onTheMap: 'On the map',
    remove: 'Remove {name} from saved',
  },
  panel: {
    label: '{name} explorer',
    modeQuestion: 'A LITTLE DEEPER',
    modeStory: 'THE SHORT STORY',
    modeMap: 'ON THE MAP',
    expand: 'Expand story',
    makeRoom: 'Make more room for the map',
    save: 'Save this story',
    unsave: 'Unsave this story',
    saved: 'Saved',
    saveForLater: 'Save for later',
    share: 'Share this view',
    copyLink: 'Copy a link',
    close: 'Close country',
    continueReading: 'Continue reading ↑',
    somethingElse: 'Something else on your mind?',
  },
  connections: {
    label: 'Explore the geography',
    title: 'SEE THE CONNECTION',
    illustrativeRoute: 'Illustrative route',
    instruction: 'Tap a place to find it on the globe.',
    locate: 'Locate {place} in the geographic context of this story.',
    explore: 'Explore',
    showWhole: 'Show the whole connection',
  },
  trail: {
    leave: 'Leave this trail',
    stops: 'Trail stops',
  },
  story: {
    overview: 'overview',
    shortExploration: 'A SHORT EXPLORATION',
    nextOnTrail: 'NEXT ON YOUR TRAIL',
    lastStop: 'THE LAST STOP',
    trailSummary: '{count} places. One shared thread.',
    trailClosing: 'The world is full of other ways in.',
    backToGlobe: 'Back to the globe',
    nextQuestions: 'WHERE THIS LEADS',
    deeper: 'Deeper in {country}',
    elsewhere: 'Elsewhere · {country}',
  },
  country: {
    overview: '60 SECOND OVERVIEW',
    factAsOf: '{label} · {asOf}',
    startWith: 'START WITH A QUESTION',
    moreQuestions: 'More questions about {country}',
    whyItMatters: 'Why {country} matters',
  },
  basic: {
    badge: 'BASIC OVERVIEW',
    summary:
      '{name} is a country or territory unit in the bundled map, located in {region}. The Natural Earth reference below provides a starting point for geographic exploration.',
    region: 'REGION',
    anchor: 'MAP ANCHOR',
    population: 'Population estimate',
    populationNote:
      'Historical Natural Earth reference, not live statistics; territorial definitions may vary.',
    notYetEdited:
      'A deeper editorial story is not yet available. This overview offers sourced geographic basics; it does not infer capitals, languages, culture or current political status.',
    keepLearning: 'KEEP LEARNING · STATIC GUIDES',
    guideWhereTitle: 'Where is {name}?',
    guideWhere:
      'Locate {name} in {region}. Rotate and zoom to compare coastlines, islands and nearby shapes. The map anchor is a location reference, not a capital.',
    guideVerifyTitle: 'What should I verify next?',
    guideVerify:
      'Compare official statistics, local government and museum sources. Record publication years and distinguish countries, territories and cartographic units.',
    sourcesSummary: 'Sources & coverage',
    sourcesNote:
      'The map contains 258 country and territory identities, not 258 sovereign states. Names and boundaries are for exploration and do not endorse territorial claims. Population retains its source year. These are static references and guides, without live updates or AI answers.',
    nearby: 'STORIES NEAR HERE',
    sourceLink: 'Natural Earth · Admin 0',
  },
  sources: {
    questionSummary: 'Sources & further reading',
    countrySummary: 'Sources',
    caveat:
      'Figures carry the year they describe. Map paths illustrate relationships, not exact routes.',
    cited: 'Sources: ',
  },
  provenance: {
    aiAssisted: 'AI-assisted',
    byHand: 'Edited by hand',
    reviewed: 'reviewed {date}',
    draft: 'draft, not yet reviewed',
  },
};
