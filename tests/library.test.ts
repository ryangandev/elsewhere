import assert from 'node:assert/strict';
import { test } from 'vitest';
import { listMapCountries } from '@/content';
import {
  parseLibrary,
  RECENT_LIMIT,
  recordVisit,
  toggleSaved,
  type Library,
} from '@/domain/library';

const empty: Library = { saved: [], recent: [] };
const directory = listMapCountries();

test('malformed, duplicate, and overlong local libraries are safe to restore', () => {
  assert.deepEqual(parseLibrary('not json'), empty);
  assert.deepEqual(parseLibrary('null'), empty);
  const restore = parseLibrary(
    JSON.stringify({
      saved: [
        null,
        {},
        { countryId: 'bad' },
        { countryId: 'SGP', topicId: 'shipping' },
        { countryId: 'SGP', storyId: 'shipping' },
      ],
      recent: directory.map((country) => ({ countryId: country.id })),
    }),
  );
  assert.deepEqual(restore.saved, [{ countryId: 'SGP', storyId: 'shipping' }]);
  assert.equal(restore.recent.length, RECENT_LIMIT);
});

test('saving toggles a destination regardless of the trail it was reached from', () => {
  const saved = toggleSaved(empty, {
    countryId: 'SGP',
    storyId: 'shipping',
    trailId: 'water-connects',
  });
  assert.equal(saved.saved.length, 1);
  assert.deepEqual(toggleSaved(saved, { countryId: 'SGP', storyId: 'shipping' }).saved, []);
});

test('visits move to the front without duplicates and are capped', () => {
  let library = empty;
  for (const item of directory) library = recordVisit(library, { countryId: item.id });
  assert.equal(library.recent.length, RECENT_LIMIT);
  library = recordVisit(library, { countryId: directory[0].id });
  library = recordVisit(library, { countryId: directory[1].id });
  library = recordVisit(library, { countryId: directory[0].id });
  assert.deepEqual(
    library.recent.slice(0, 2).map((item) => item.countryId),
    [directory[0].id, directory[1].id],
  );
  assert.equal(new Set(library.recent.map((item) => item.countryId)).size, library.recent.length);
});
