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
    search: 'Where next?',
    searchLabel: 'Search countries and questions',
  },
  home: {
    eyebrow: 'YOUR WORLD, A LITTLE CLOSER',
    titleStart: 'Every place',
    titleMiddle: 'has a',
    titleEmphasis: 'story.',
    introFirst: 'Follow a little curiosity.',
    introSecond: 'See where it takes you.',
    begin: 'SOMEWHERE TO BEGIN',
    surprise: 'Take me somewhere',
    followThread: 'Or follow a thread across the world',
    resume: 'CONTINUE YOUR WANDER',
  },
  notFound: {
    eyebrow: 'NOT ON THE MAP',
    title: 'We couldn’t find that place.',
    description: 'The address may be mistyped, or that story is not in this edition yet.',
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
    frameRate: 'Show frame rate checker',
    frameRateHint: 'Check globe frame rate',
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
      'Vector boundaries: Natural Earth. Terrain shading: NASA Earth Observatory / GEBCO. Sources and further reading accompany the stories. Boundaries are generalized for exploration and do not express a political position. Map routes are illustrative.',
  },
  share: {
    title: 'A little curiosity, shared.',
    description: 'Copy this link to return to this exact country, question, or trail.',
    inputLabel: 'Share link',
    done: 'Done',
  },
  search: {
    title: 'Where does your curiosity lead?',
    description: 'Search countries, places, and questions in our editorial stories.',
    heading: 'FOLLOW A QUESTION',
    close: 'Close search',
    placeholder: 'A country, a topic, a question…',
    inputLabel: 'Search the atlas',
    groupQuestions: 'QUESTIONS TO EXPLORE',
    groupCountries: 'COUNTRY STORIES',
    groupMap: 'LOCATE ON THE GLOBE',
    stayCurious: 'STAY CURIOUS ABOUT {country}',
    tenPlaces: 'TEN PLACES. MANY WAYS IN.',
    emptyTitle: 'A question for another day.',
    empty:
      'We don’t have a story matching that yet. Try a country name or a topic like shipping, language, or forests.',
    browse: 'Browse the atlas',
    keys: '↑ ↓ to explore · ↵ to go',
    footer: 'Editorial search · {count} map locations',
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
    startWithSingapore: 'Start with Singapore',
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
    questions: 'questions',
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
    leadsToAnother: 'ONE QUESTION LEADS TO ANOTHER',
    moreQuestions: 'More questions about',
  },
  country: {
    overview: '60 SECOND OVERVIEW',
    population: 'POPULATION · 2024',
    capital: 'CAPITAL',
    whyItMatters: 'Why it matters',
    followCuriosity: 'Follow your curiosity',
    goDeeper: 'GO A LITTLE DEEPER',
    connectedPlaces: 'CONNECTED PLACES',
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
    guideLifeTitle: 'How might geography shape everyday life?',
    guideLife:
      'Use the map to form questions about transport and connections. A shape alone cannot establish economic, cultural or political facts.',
    guideVerifyTitle: 'What should I verify next?',
    guideVerify:
      'Compare official statistics, local government and museum sources. Record publication years and distinguish countries, territories and cartographic units.',
    sourcesSummary: 'Sources & coverage',
    sourcesNote:
      'The map contains 258 country and territory identities, not 258 sovereign states. Names and boundaries are for exploration and do not endorse territorial claims. Population retains its source year. These are static references and guides, without live updates or AI answers.',
    nearby: 'STORIES NEAR HERE',
  },
  sources: {
    questionSummary: 'Sources & further reading',
    countrySummary: 'The essentials & sources',
    language: 'Language',
    currency: 'Currency',
    countryLevel: 'Country-level background sources for this editorial exploration.',
    caveat:
      'Population figures use a rounded 2024 reference. Map paths illustrate relationships, not exact routes.',
  },
};
