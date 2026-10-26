# Task: revise one story in {{countryName}}

An editor sent this story back. Redraft it so it addresses every note, then call submit_story with the complete story and the sources it cites.
Keep the story ID "{{storyId}}". Research again where the notes ask for it; the same sourcing rules apply, and you may cite only pages you retrieve in this task.
Today is {{today}}.

## Editor's notes

{{notes}}

## The story as drafted

```json
{{story}}
```

## The rest of the country, for context

Other stories in {{countryName}} (country ID {{countryId}}): {{otherStories}}

## Stories elsewhere that link here

{{inboundReferences}}

## Cities and regions in and around {{countryName}}

Format: id | name | kind | lat, lng. Call find_places for anything not listed here or in the shared gazetteer.

{{candidatePlaces}}
