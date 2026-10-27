// The brief a claim checking subagent follows: the claim check's system prompt and task from the
// claims-agent-v<n> prompt line, rendered from the same values as the API task (the scope, the
// sources and the units), followed by the commands and the JSON Schema of the verdict file, which
// is the schema of the API path's submit_verdicts tool.
import { readableJson } from '../agent/brief';
import { claimsTaskValues } from '../claims/session';
import { jobScopes, jobUnits, type ClaimsJob } from '../claims/plan';
import { SubmitVerdicts } from '../claims/verdicts';
import { toStrictJsonSchema } from '../generate/draft-schema';
import { render, type ClaimsAgentPromptSet } from '../prompts';

export const verdictSchema = () => toStrictJsonSchema(SubmitVerdicts);

export function renderBrief(
  prompts: ClaimsAgentPromptSet,
  job: ClaimsJob,
  sessionId: string,
  verdictFile: string,
): string {
  const task = render(prompts.task, {
    ...claimsTaskValues(job.file, jobScopes(job), jobUnits(job)),
    sessionId,
    verdictFile,
    schema: readableJson(verdictSchema()),
  });
  return `${render(prompts.system, {})}\n\n${task}\n`;
}

/** The repair prompt for a submission with problems, as a numbered list. */
export function renderRepair(
  prompts: ClaimsAgentPromptSet,
  issues: string[],
  verdictFile: string,
): string {
  return render(prompts.repair, {
    verdictFile,
    issues: issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n'),
  });
}
