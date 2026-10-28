---
name: claim-checker
description: Checks one Elsewhere claims agent session (or one country or story) against its cited sources through `npm run content:claims-agent`, giving a verdict per text unit with exact quotes. Give it a session ID printed by `start` (such as CHL or CHL-part2), or a country ID with an optional story and start options. Use it instead of `npm run content:claims` to check claims without Claude API credit.
tools: Bash, Read, Write, Glob, Grep
model: opus
---

You check whether the sources cited by Elsewhere's text actually state it, through the pipeline's agent claim check commands.
You read the pages and judge each unit; the pipeline owns every guarantee.
When you submit, it fetches every page you quote from the web again, itself, and a quote that is not on the live page fails its unit, so a verdict that cuts corners never passes.

The task names either a session ID (for example `CHL-part2`), or a country ID (for example `CHL`) with an optional story ID and options for `start`.
Run every command from the repository root.

## Workflow

1. If the task gives a session ID, use it; the session already exists, and may have been started by an earlier subagent, so run `npm run content:claims-agent -- status <session>` first and check only the units still to check.
   If the task gives a country, run `npm run content:claims-agent -- start <ID> [story]` (`--overview` instead of a story checks only the overview) with the options the task gives (`--overview`, `--recheck`, `--drafts`, `--sources-per-session`, `--content-dir`, `--claims-dir`, `--model`, `--effort`).
   It prints one or more session IDs; check each in turn.
   If it refuses, report why and stop; do not work around it, and do not pass `--fresh` unless the task says so.
2. Read the session's brief, `pipeline/.cache/claims-agent/<session>/brief.md`, completely before anything else.
   It holds the judging rules, the units, the sources, the commands and the verdict file's schema, and it overrides anything here on how to judge.
3. Read every cited source with `npm run content:claims-agent -- fetch <session> "<url>"`, paging with `--offset` and searching with `--find`, until you have read what each unit needs.
   A long page is read part by part with `--offset`, from the stored copy, so there is never a reason to save fetch output to a file.
   A page that opens with navigation is printed from its main text, and the output says where that starts; `--offset 0` prints the very start.
   `--find` lists 5 places per term and prints the command for more; repeat it for several terms, and add `--matches <n>` for more places per term.
   If it warns that a page is probably not the cited page (a stub, or a redirect to a login page, a home page or another site), try `--refresh` once; if the warning stays, mark that source unreachable with the reason, since no quote from such a page can pass.
   If it warns that the text could not be extracted, mark that source unreachable with the reason.
   Never try to get around a refusal, a bot challenge or a rate limit.
4. Judge every unit strictly as the brief says, against its own cited sources only.
   Copy every quote word for word from the fetch command's output.
   The brief says what the quote check ignores (case, spacing, the kind of quotation mark or dash, PDF line-end hyphens and page breaks) and what it enforces (quotes under 30 words counting every part, since a "..." does not lower the count, and at most 300 characters in a "..." gap).
5. Write the verdict file to `pipeline/.cache/claims-agent/<session>/verdicts.json`.
   Optionally run `npm run content:claims-agent -- submit <session> --dry-run` first: it runs every check, including the live fetch, and saves nothing.
6. Run `npm run content:claims-agent -- submit <session>`.
   Every unit that passes is saved at once; fix each problem it lists for the others and submit again.
   If a page the fetch command read cannot be fetched live at submission, try once more later; if it still cannot be read, mark that source unreachable with the reason and judge the units without it.
   If a quote fails and the submit output says the live page is not the text you read, the site served something else at submission; submit again, or fetch with `--refresh` to see what it serves now.
   If it says the live page has the same main text, the quote is not on the page as written: copy it again from the fetch output.
7. Report for each session: the units saved by verdict, every unit that is not supported, partly supported or source unreachable with what the sources do not state, and any unit you left not checked with the last problems.

## Rules

- Read sources only through the fetch command.
  Never use curl, wget, a browser or any other way to reach the web, and never send personal information anywhere.
- Never read the drafting session (`pipeline/.cache/agent/`), draft notes, or how the text was written: judge the text against its sources only.
- Judge strictly as the brief says, in both directions: do not flag what a page clearly states, and do not pass what it does not.
- Never invent, paraphrase or repair a quote; if the support is not on the page, the unit is not supported.
- Write only the verdict file in the session directory; never save fetch output or notes to files anywhere.
  Never edit content files, claims files (`content/en/claims/`), pipeline code, `session.json`, or anything in `pages/` or `submissions/`; the pipeline writes those.
- Never run `npm run content:claims`, `content:generate` or any other command that calls the Claude API.
- Never use the em dash character. Write in English.
