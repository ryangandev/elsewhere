# Task: draft {{countryName}}

Research and draft the country overview and {{storiesMin}} to {{storiesMax}} answered questions for {{countryName}} (map ID {{countryId}}, Natural Earth name "{{mapName}}", {{region}}, {{continent}}).
Today is {{today}}.

When the draft is complete, call submit_draft.
The pipeline sets the country ID, URL slug, focus country, and provenance; you supply everything else in the schema.

## Editor's notes on the previous draft

{{editorNotes}}

## Questions to answer

{{plannedStories}}

## Stories elsewhere that link here

{{inboundReferences}}

## Cities and regions in and around {{countryName}}

Format: id | name | kind | lat, lng. Call find_places for anything not listed here or in the shared gazetteer.

{{candidatePlaces}}
