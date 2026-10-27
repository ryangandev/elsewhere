# Task: draft {{countryName}}

Research and draft the country overview and {{storiesMin}} to {{storiesMax}} answered questions for {{countryName}} (map ID {{countryId}}, Natural Earth name "{{mapName}}", {{region}}, {{continent}}).
Today is {{today}}.

When the draft is complete, write it to {{draftFile}} and run the submit command.
The pipeline sets the country ID, URL slug, focus country, and provenance; you supply everything else in the schema.

## Commands

Run these from the repository root, and put each URL in quotes.

- `npm run content:agent -- fetch {{countryId}} "<url>"` reads a page and prints its first part with a header that says how long it is. Add `--offset <n>` to print the part that starts at character n, or `--find "<words>"` to list where the words appear. Later reads of the same URL come from the stored copy.
- `npm run content:agent -- places {{countryId}} --query "<name>"` searches the gazetteer by name. Add `--country <map ID>` to search within one country, or `--near <place ID>` to sort by distance from a place; either works without `--query` too.
- `npm run content:agent -- submit {{countryId}}` checks {{draftFile}} with every rule the pipeline applies. Problems come back as a numbered list; fix all of them and submit again until it passes.
- `npm run content:agent -- status {{countryId}}` lists the pages you have fetched and your submissions so far.

## Editor's notes on the previous draft

{{editorNotes}}

## Questions to answer

{{plannedStories}}

## Stories elsewhere that link here

{{inboundReferences}}

## Cities and regions in and around {{countryName}}

Format: id | name | kind | lat, lng. Use the places command for anything not listed here or in the shared gazetteer.

{{candidatePlaces}}

## Submission schema

The draft file is one JSON object that matches this JSON Schema. Every property is required: write null where the schema allows it instead of leaving a property out.

```json
{{submissionSchema}}
```
