import type { Country, Place, Topic } from '@/content/legacy/data';
import mapIndex from '@/content/legacy/country-index.json';
import type { CountryLabelData } from '@/globe/controller';
import type { MapScene, ScenePlace } from '@/globe/scene';
import { directory, type MapCountry } from './catalog';

// Transitional: builds globe scenes and labels from the prototype data.
// Replaced by `resolveScene` from src/content once the UI reads the new content tree.

export const countryLabels: CountryLabelData[] = mapIndex.map((item) => ({
  id: item.id,
  name: directory.find((country) => country.id === item.id)?.name ?? item.name,
  lat: item.lat,
  lng: item.lng,
  area: item.area,
  rank: item.rank,
}));

/** Places shown around the current destination, excluding the destination itself. */
export function contextPlaces(
  country: MapCountry | null,
  profile: Country | null,
  topic: Topic | null,
): Place[] {
  return (topic?.places ?? profile?.neighbors ?? []).filter(
    (place) => place.name !== country?.name,
  );
}

const toScenePlace = (place: Place): ScenePlace => ({
  id: place.name,
  name: place.name,
  lat: place.lat,
  lng: place.lng,
  kind: place.kind ?? 'place',
});

export function legacyScene(
  country: MapCountry | null,
  profile: Country | null,
  topic: Topic | null,
  focus: Place | null,
): MapScene {
  const places = contextPlaces(country, profile, topic).map(toScenePlace);
  if (focus && !places.some((place) => place.id === focus.name)) places.push(toScenePlace(focus));
  const camera =
    topic?.view ??
    (country && profile
      ? { lat: country.lat, lng: country.lng, altitude: profile.altitude }
      : undefined);
  const route = topic?.route?.map(([lat, lng]): [number, number] => [lat, lng]);
  return {
    camera,
    focusCountryId: country?.id,
    highlights: [],
    places,
    routes: topic && route ? [{ id: topic.id, kind: 'sea', points: route }] : [],
    focusPlaceId: focus?.name,
  };
}
