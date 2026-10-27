// Which units a claim check run checks, and how they are split into conversations. A unit is due
// while it has no result for its current text, so a run after a partial one checks only what is
// left. A country's due units are packed into sessions of at most CLAIM_SOURCES_PER_SESSION cited
// sources each, because every cited page stays in the conversation's context; overviews and
// stories that share sources go together, because a source shared by two sessions is read twice.
import type { CountryFile } from '../../src/content/schema';
import { CLAIM_SOURCES_PER_SESSION } from '../config';
import { readClaims } from './store';
import { allScopes, scopesLabel, scopeUnits, type ClaimScope, type ClaimUnit } from './units';

/** Units of one overview or story that a session checks. */
export type ClaimPart = { scope: ClaimScope; units: ClaimUnit[] };

/** One claim check conversation: some units of one country. */
export type ClaimsJob = {
  file: CountryFile;
  /** The units by overview or story, in file order; the scopes give the task its context. */
  parts: ClaimPart[];
  /** Stable key: the recording directory and the batch custom ID. */
  tag: string;
  /** For people: "NGA", "NGA/oil", "NGA, part 2 of 4". */
  label: string;
};

export const jobUnits = (job: ClaimsJob): ClaimUnit[] => job.parts.flatMap((part) => part.units);

export const jobScopes = (job: ClaimsJob): ClaimScope[] => job.parts.map((part) => part.scope);

export type JobSelection = {
  /** Only these overviews and stories; without it, the overview and every story. */
  scopes?: ClaimScope[];
  /** Only the overview and stories that are still drafts. */
  draftsOnly?: boolean;
  /** Check every selected unit, even one with a result for its current text. */
  recheck?: boolean;
  /** Most cited sources in one session (default CLAIM_SOURCES_PER_SESSION). */
  maxSources?: number;
};

const sourceIds = (units: ClaimUnit[]) =>
  new Set(units.flatMap((unit) => unit.sources.map((source) => source.id)));

/**
 * Pack items into groups that cite at most `max` sources each, so a source shared by several
 * items is read by as few sessions as possible. Greedy: a group starts from the item citing the
 * most sources and keeps taking the item that adds the fewest new sources (then the one sharing
 * the most) while it fits; an item that adds none always fits, and an item citing more than `max`
 * on its own starts a group of its own. Items keep their order within a group and groups are in
 * the order of their first item, so the same input always gives the same groups.
 */
export function packBySources<T>(
  items: T[],
  sourcesOf: (item: T) => Set<string>,
  max: number,
): T[][] {
  const left = items.map((item, index) => ({ item, index, sources: sourcesOf(item) }));
  const groups: (typeof left)[] = [];
  while (left.length) {
    const seed = left.reduce((best, entry) =>
      entry.sources.size > best.sources.size ? entry : best,
    );
    left.splice(left.indexOf(seed), 1);
    const group = [seed];
    const cited = new Set(seed.sources);
    for (;;) {
      let pick: (typeof left)[number] | undefined;
      let pickAdded = Infinity;
      let pickShared = -1;
      for (const entry of left) {
        const added = [...entry.sources].filter((id) => !cited.has(id)).length;
        if (added && cited.size + added > max) continue;
        const shared = entry.sources.size - added;
        if (added < pickAdded || (added === pickAdded && shared > pickShared)) {
          [pick, pickAdded, pickShared] = [entry, added, shared];
        }
      }
      if (!pick) break;
      left.splice(left.indexOf(pick), 1);
      group.push(pick);
      pick.sources.forEach((id) => cited.add(id));
    }
    groups.push(group.sort((a, b) => a.index - b.index));
  }
  return groups
    .sort((a, b) => a[0].index - b[0].index)
    .map((group) => group.map((entry) => entry.item));
}

/**
 * Split parts into sessions of at most `max` cited sources. A part that cites more on its own is
 * first split into pieces of its units; pieces of one part that land in the same session are one
 * part again, with the units in file order.
 */
export function splitParts(parts: ClaimPart[], max: number): ClaimPart[][] {
  const bound = Math.max(1, Math.floor(max));
  const pieces = parts.flatMap((part) =>
    sourceIds(part.units).size <= bound
      ? [part]
      : packBySources(part.units, (unit) => sourceIds([unit]), bound).map((units) => ({
          scope: part.scope,
          units,
        })),
  );
  return packBySources(pieces, (piece) => sourceIds(piece.units), bound).map((group) => {
    const merged: ClaimPart[] = [];
    for (const piece of group) {
      const last = merged.at(-1);
      if (last && sameScope(last.scope, piece.scope)) {
        const order = parts.find((part) => sameScope(part.scope, piece.scope))!.units;
        last.units = order.filter(
          (unit) => last.units.includes(unit) || piece.units.includes(unit),
        );
      } else {
        merged.push({ ...piece });
      }
    }
    return merged;
  });
}

const sameScope = (a: ClaimScope, b: ClaimScope) =>
  (a.kind === 'overview' ? '' : a.storyId) === (b.kind === 'overview' ? '' : b.storyId);

/** A check named after what it covers: the country, or the one story it checks. */
function name(file: CountryFile, parts: ClaimPart[]) {
  const label = scopesLabel(
    file.country.id,
    parts.map((part) => part.scope),
  );
  return { label, tag: `claims-${label.replace('/', '-')}` };
}

/** Name the sessions of a split: one keeps the name, several are numbered parts or splits of it. */
function numbered(
  file: CountryFile,
  groups: ClaimPart[][],
  base: { tag: string; label: string },
  word: 'part' | 'split',
): ClaimsJob[] {
  if (groups.length === 1) return [{ file, parts: groups[0], ...base }];
  return groups.map((parts, index) => ({
    file,
    parts,
    tag: `${base.tag}-${word}${index + 1}`,
    label: `${base.label}, ${word} ${index + 1} of ${groups.length}`,
  }));
}

/** One session for every unit of these overviews and stories, however many sources they cite. */
export function jobFor(file: CountryFile, scopes: ClaimScope[]): ClaimsJob {
  const parts = scopes.map((scope) => ({ scope, units: scopeUnits(file, scope) }));
  return { file, parts, ...name(file, parts) };
}

/** The sessions a file needs: its due units, split by the sources they cite. */
export function claimsJobs(
  file: CountryFile,
  selection: JobSelection,
  claimsDir: string,
): ClaimsJob[] {
  const claims = readClaims(claimsDir, file.country);
  const parts = (selection.scopes ?? allScopes(file))
    .filter((scope) => {
      if (!selection.draftsOnly) return true;
      const provenance =
        scope.kind === 'overview'
          ? file.country.provenance
          : file.stories.find((story) => story.id === scope.storyId)?.provenance;
      return provenance?.status === 'draft';
    })
    .map((scope) => ({
      scope,
      units: scopeUnits(file, scope).filter(
        (unit) => selection.recheck || !claims.checks[unit.key],
      ),
    }))
    .filter((part) => part.units.length);
  if (!parts.length) return [];
  const groups = splitParts(parts, selection.maxSources ?? CLAIM_SOURCES_PER_SESSION);
  return numbered(file, groups, name(file, parts), 'part');
}

/**
 * Smaller sessions for the units a session left unchecked when its conversation outgrew the
 * context window: their sources split in two (rounded up), so each new session reads about half
 * as much. Empty when they cannot be split further: one unit, one source, or units that cannot
 * be separated within the smaller bound.
 */
export function splitJob(job: ClaimsJob, units: ClaimUnit[]): ClaimsJob[] {
  const parts = job.parts
    .map((part) => ({
      scope: part.scope,
      units: part.units.filter((unit) => units.includes(unit)),
    }))
    .filter((part) => part.units.length);
  const sources = sourceIds(units).size;
  if (units.length < 2 || sources < 2) return [];
  const groups = splitParts(parts, Math.ceil(sources / 2));
  return groups.length < 2 ? [] : numbered(job.file, groups, job, 'split');
}
