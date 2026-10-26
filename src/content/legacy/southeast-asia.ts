import type { Country } from './data';

const location = { name: 'Government of Malaysia · Geography', url: 'https://www.malaysia.gov.my/en/government/kenali-malaysia/lokasi' };
const history = { name: 'Government of Malaysia · History', url: 'https://www.malaysia.gov.my/en/government/learn-about-malaysia/malaysian-history' };
const electronics = { name: 'MIDA · Electrical & electronics industry', url: 'https://www.mida.gov.my/publications/malaysias-ee-industry/' };
const islands = { name: 'World Bank · Indonesia and its environment', url: 'https://www.worldbank.org/en/country/indonesia/brief/world-bank-and-environment-in-indonesia' };
const language = { name: 'Indonesia Ministry of Tourism · Language', url: 'https://www.indonesia.travel/gb/en/general-information/bahasa' };
const independence = { name: 'Indonesia Ministry of Tourism · History', url: 'https://www.indonesia.travel/gb/en/general-information/history' };

export const southeastAsia: Country[] = [
  {
    id: 'MYS', name: 'Malaysia', native: 'Malaysia · 马来西亚', flag: '🇲🇾', region: 'Southeast Asia',
    lat: 4, lng: 109, altitude: .85, kicker: 'Two shores. Many identities. Shared connections.',
    summary: 'A federation spanning a peninsula and northern Borneo. Malaysia connects busy sea lanes, electronics factories, and culturally varied communities. The sea between its two regions is central to understanding the country.',
    population: '34.1 million', capital: 'Kuala Lumpur', language: 'Malay (official)', currency: 'Malaysian ringgit',
    matters: [
      { title: 'Inside everyday electronics', text: 'Its manufacturing networks help make the components and devices used far beyond Southeast Asia.' },
      { title: 'One country, distinct regions', text: 'The peninsula, Sabah, and Sarawak bring different histories and communities into a shared federation.' },
    ],
    geography: 'Peninsular Malaysia sits between Thailand and Singapore. Across the South China Sea, Sabah and Sarawak occupy northern Borneo, sharing the island with Indonesia and Brunei.',
    neighbors: [{ name: 'Peninsular Malaysia', lat: 4, lng: 102, kind: 'place' }, { name: 'Borneo', lat: 1, lng: 114, kind: 'place' }, { name: 'Singapore', lat: 1.35, lng: 103.82, kind: 'country' }, { name: 'South China Sea', lat: 9, lng: 110, kind: 'water' }],
    topics: [
      {
        id: 'two-shores', title: 'Why is Malaysia in two separate parts?', category: 'Geography & history',
        intro: 'A national border can tell a story that a coastline cannot.',
        sections: [
          { title: 'A peninsula and an island', text: 'The western region occupies the southern Malay Peninsula. Sabah and Sarawak lie on Borneo, across the South China Sea. Moving between these regions means crossing water, even while staying in the same country.' },
          { title: 'A federation formed through history', text: 'Malaysia was formed in 1963 by Malaya, Sabah, Sarawak, and Singapore. Singapore became independent in 1965. The remaining federation joins places with distinct local histories, rather than one continuous landmass.' },
        ],
        takeaway: 'Malaysia makes more sense as a federation of regions than as a single shape on a map.',
        mapNote: 'Cross the South China Sea from the peninsula to northern Borneo.',
        places: [{ name: 'Peninsular Malaysia', lat: 4, lng: 102, kind: 'place' }, { name: 'Sarawak', lat: 2.5, lng: 113, kind: 'place' }, { name: 'Sabah', lat: 5.5, lng: 117, kind: 'place' }],
        route: [[4,102],[5,107],[4,112],[5.5,117]], sources: [location, history],
      },
      {
        id: 'electronics', title: 'How did Malaysia get inside your electronics?', category: 'Industry',
        intro: 'A product’s brand tells you surprisingly little about where it was made.',
        sections: [
          { title: 'Start with components', text: 'Malaysia’s electronics industry took root in the 1970s. International manufacturers and local firms built production networks that now range from semiconductor devices to industrial electronics.' },
          { title: 'Specialize, then connect', text: 'A chip passes through several stages before it reaches a device. Manufacturing, assembly, packaging, and testing depend on different skills. Malaysia’s role shows why industrial strength can be hidden inside a product carrying another country’s brand.' },
        ],
        takeaway: 'To understand a global industry, follow the work between countries as well as the finished product.',
        mapNote: 'The peninsula faces the sea lanes connecting East Asian production networks.',
        places: [{ name: 'Peninsular Malaysia', lat: 4, lng: 102, kind: 'place' }, { name: 'South China Sea', lat: 12, lng: 113, kind: 'water' }], sources: [electronics],
      },
      {
        id: 'federation', title: 'What holds a diverse federation together?', category: 'People & identity',
        intro: 'A common national name does not mean a single regional experience.',
        sections: [
          { title: 'Many communities share the country', text: 'Malay, Chinese, Indian, and many Indigenous communities contribute to Malaysian life. Sabah and Sarawak add histories and identities that cannot be understood only through the peninsula.' },
          { title: 'Look beyond a national average', text: 'The federal structure joins these regions within one state. Language, religion, local history, and economic opportunity still vary. Understanding those differences is a better starting point than expecting one typical Malaysian experience.' },
        ],
        takeaway: 'A federation is a way to share a country while retaining meaningful differences within it.',
        mapNote: 'The peninsula and northern Borneo are distinct parts of the same federation.', sources: [location, history],
      },
    ],
    sources: [{ name: 'DOSM · Population estimates, 2024', url: 'https://www.dosm.gov.my/portal-main/release-content/current-population-estimates-2024' }, location, history, electronics],
  },
  {
    id: 'IDN', name: 'Indonesia', native: 'Indonesia · 印度尼西亚', flag: '🇮🇩', region: 'Southeast Asia',
    lat: -3, lng: 118, altitude: 1.15, kicker: 'An ocean of islands. A shared national idea.',
    summary: 'A vast archipelago between the Indian and Pacific oceans. Indonesia brings many languages, landscapes, and communities into one republic. Its scale and extraordinary biodiversity make it much more than a collection of holiday islands.',
    population: '283 million', capital: 'Jakarta (2024)', language: 'Indonesian (official)', currency: 'Indonesian rupiah',
    matters: [
      { title: 'A regional center of gravity', text: 'Southeast Asia’s largest economy has a large domestic market and an important voice in regional cooperation.' },
      { title: 'Living systems across land and sea', text: 'Tropical forests, reefs, and coastal ecosystems make its environmental choices consequential well beyond its islands.' },
    ],
    geography: 'Sumatra lies beside the Malacca Strait. Java stretches to its southeast, while Kalimantan occupies much of Borneo. Other islands extend eastward toward New Guinea and the Pacific.',
    neighbors: [{ name: 'Sumatra', lat: -1, lng: 101, kind: 'place' }, { name: 'Java', lat: -7.5, lng: 110, kind: 'place' }, { name: 'Borneo', lat: 1, lng: 114, kind: 'place' }, { name: 'Indian Ocean', lat: -14, lng: 105, kind: 'water' }],
    topics: [
      {
        id: 'islands', title: 'How do thousands of islands become one country?', category: 'Geography & identity',
        intro: 'The water between the islands is part of the story, not an empty gap.',
        sections: [
          { title: 'Connections across water', text: 'Travel and trade have long linked different islands. Today, an archipelago still depends on connections between its parts. Distances and sea crossings shape the practical work of moving people and goods.' },
          { title: 'A shared political project', text: 'Independence was proclaimed in 1945 after Dutch colonial rule and Japanese wartime occupation. A national language and shared institutions helped build a republic across communities with very different local histories.' },
        ],
        takeaway: 'Indonesia is a national project spanning islands, not an island with a single identity.',
        mapNote: 'Follow the island chain from Sumatra through Java toward the east.',
        places: [{ name: 'Sumatra', lat: -1, lng: 101, kind: 'place' }, { name: 'Java', lat: -7.5, lng: 110, kind: 'place' }, { name: 'Sulawesi', lat: -2, lng: 121, kind: 'place' }],
        route: [[-1,101],[-6,106],[-7.5,110],[-6,117],[-2,121]], sources: [islands, independence],
      },
      {
        id: 'language', title: 'Why does one shared language matter so much?', category: 'People & language',
        intro: 'Indonesian creates a meeting place across many local languages.',
        sections: [
          { title: 'A language for a common future', text: 'The 1928 Youth Pledge made a shared language part of the independence movement’s national vision. Indonesian later became the official language of the republic.' },
          { title: 'Unity without sameness', text: 'Indonesian is used across the country, while regional languages remain part of everyday life. Speaking to the nation and speaking within a local community need not mean using the same language.' },
        ],
        takeaway: 'A shared language can connect communities without describing everything about them.',
        mapNote: 'One national language connects communities spread across the archipelago.', sources: [language, independence],
      },
      {
        id: 'nature', title: 'Why is its natural world so varied?', category: 'Nature & geography',
        intro: 'An island chain can hold many different living worlds.',
        sections: [
          { title: 'Between two biological regions', text: 'Indonesia spans the Indomalayan and Australasian biogeographic regions. Its forests, coasts, and seas support extraordinary biodiversity, including species found nowhere else.' },
          { title: 'Nature and everyday life', text: 'These ecosystems support livelihoods as well as wildlife. Land use, pollution, and pressure on coastal environments affect people who depend on them. The country also sits in a region of active tectonics, where natural hazards shape life.' },
        ],
        takeaway: 'The same country can contain several ecological worlds, each with its own pressures.',
        mapNote: 'Look east from Borneo and Sulawesi toward New Guinea.',
        places: [{ name: 'Borneo', lat: 1, lng: 114, kind: 'place' }, { name: 'Sulawesi', lat: -2, lng: 121, kind: 'place' }, { name: 'New Guinea', lat: -5, lng: 141, kind: 'place' }], sources: [islands],
      },
    ],
    sources: [
      { name: 'World Bank · Population, 2024', url: 'https://datacatalogfiles.worldbank.org/ddh-published/0038126/DR0046429/POP.pdf' },
      { name: 'World Bank · Indonesia overview', url: 'https://www.worldbank.org/en/country/indonesia/overview' },
      islands, language, independence,
    ],
  },
];
