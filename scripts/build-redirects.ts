// Writes the prototype query URL redirects into vercel.json: `npm run redirects:build`.
// Only the `redirects` key is generated; the rest of vercel.json is edited by hand.
// It runs with NODE_ENV=production, so it sees reviewed content only, as the build does.
// tests/deployment.test.ts fails when the committed redirects are out of date.
// See src/domain/legacy-redirects.ts and docs/architecture.md#platform.
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { buildLegacyRedirects } from '../src/domain/legacy-redirects';

const FILE = 'vercel.json';

const config = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
config.redirects = buildLegacyRedirects();

const options = { ...(await resolveConfig(FILE)), filepath: FILE };
writeFileSync(FILE, await format(JSON.stringify(config), options));
console.log(`${FILE}: ${(config.redirects as unknown[]).length} redirects`);
