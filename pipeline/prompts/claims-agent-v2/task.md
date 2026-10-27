# Check {{scope}} of {{countryName}} ({{countryId}})

{{context}}

## Sources

{{sources}}

## Units

{{units}}

## Commands

Run every command from the repository root. This is session {{sessionId}}.

- `npm run content:claims-agent -- fetch {{sessionId}} "<url>"` reads one of the sources above and prints its first part. Add `--offset <n>` to print the part that starts at character n, or `--find "<words>"` to list where the words appear, 20 at a time (with `--offset <n>`, those from character n on). Later reads of the same URL come from a stored copy, which is only for reading; add `--refresh` to fetch it again. It reads only the source URLs above.
- `npm run content:claims-agent -- submit {{sessionId}}` checks the verdict file at {{verdictFile}} and saves the verdict of every unit that passes. Add `--dry-run` to run every check, including the live fetch, without saving anything.
- `npm run content:claims-agent -- status {{sessionId}}` lists the units still to check, the pages you fetched, and your submissions.

## The verdict file

Write it to {{verdictFile}} as one JSON object of this JSON Schema: every source of the task once in `sources`, and one entry in `verdicts` for every unit.

```json
{{schema}}
```

Each unit whose verdict passes is saved at once; the submit command lists every unit that did not pass, with the reasons.
Fix them in the file and submit again; a unit that already passed may stay in the file or be left out, and keeps its saved verdict unless a new one passes.
If a unit cannot pass, stop and report it; it stays not checked.

Fetch every source, judge every unit against its own cited sources, then write the verdict file and submit it.
