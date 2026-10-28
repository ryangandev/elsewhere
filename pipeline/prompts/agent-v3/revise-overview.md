# Task: revise {{sentBack}} of {{countryName}}

An editor sent back {{sentBack}} of {{countryName}}.
The overview here means the country part of the file: the kicker, the overview (summary, geography and why it matters), the quick facts, the starter questions and the map scene.
Redraft each part sent back so it addresses every note, write the complete revised parts and the sources they cite to {{draftFile}}, and run the submit command.
Keep each story's ID. Research again where the notes ask for it; the same sourcing rules apply, and you may cite only pages you read with the fetch command in this session.
That includes the pages a part already cites: pages read for an earlier draft do not count, so fetch each one again before you keep it.
When the session starts, {{draftFile}} holds the parts as drafted and the sources they cite, in the submission's shape, so a small fix is an edit of that file.
Today is {{today}}.

The pipeline sets the country ID, URL slug, focus country, the provenance and each source's access date, and keeps every story that is not sent back as it is; you supply everything else in the schema.
When the submission passes, the revised parts replace the old ones together and the editor's requests are cleared.
A source ID names one document in the file: where a story you are not revising declares the same ID, keep its URL or give your source another ID. If that URL is wrong, say so in your report, so the editor can send that story back too. Parts revised together share one list of sources, so they may move a shared ID to a corrected URL together.

## Commands

Run these from the repository root, and put each URL in quotes.

- `npm run content:agent -- fetch {{countryId}} "<url>"` reads a page and prints a part of it with a header that says how long it is. On a page that opens with navigation, it starts at the page's main text and says where that is; `--offset 0` prints the very start. Add `--offset <n>` to print the part that starts at character n, or `--find "<words>"` to list where the words appear, 5 places per term (repeat `--find` to search several terms in one call, and add `--matches <n>` for more places per term). Add `--links` to list the page's links (anchor text and absolute URL, in page order, in parts like the text, where `--offset <n>` skips the first n links) so you can find a document or a primary source and fetch it. Later reads of the same URL come from the stored copy. If it warns that the page is probably not the page you asked for, it cannot be cited. If it warns that the text could not be extracted, the page cannot be read either: choose another source or another copy of the document. When a page redirects to a file such as a PDF, cite the file's URL that it prints. This is the only way to read a page: never use curl, wget or any other tool that makes HTTP requests, and never put personal information (names, email addresses, domains) in a request.
- `npm run content:agent -- places {{countryId}} --query "<name>"` searches the gazetteer by name. Repeat `--query` to search several names in one call. Add `--country <map ID>` to search within a country (repeat it for places in any of several), or `--near <place ID>` to sort by distance from a place; either works without `--query` too.
- `npm run content:agent -- submit {{countryId}}` checks {{draftFile}} with every rule the pipeline applies. Problems come back as a numbered list; fix all of them and submit again until it passes.
- `npm run content:agent -- submit {{countryId}} --dry-run` runs the same checks and prints the same problems, or says the revision would pass, but writes nothing and does not count as a submission. Use it to check the revision, for example its map routes, before you submit.
- `npm run content:agent -- status {{countryId}}` lists the pages you have fetched and your submissions so far.

## The overview

### Editor's notes

{{overviewNotes}}

### The overview as drafted

```json
{{country}}
```

{{countryUnread}}

## Stories to revise

{{revisions}}

## The stories of {{countryName}}

Starter questions are story IDs from this list (country ID {{countryId}}).

{{stories}}

## Stories elsewhere that link here

{{inboundReferences}}

## Cities and regions in and around {{countryName}}

Format: id | name | kind | lat, lng. Use the places command for anything not listed here or in the shared gazetteer.

{{candidatePlaces}}

## Submission schema

The draft file is one JSON object that matches this JSON Schema: the revised country part, every story listed under "Stories to revise", revised, and every source they cite. Every property is required: write null where the schema allows it instead of leaving a property out.

```json
{{submissionSchema}}
```
