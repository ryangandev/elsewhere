// One drafting conversation: research with server-side web tools, gazetteer lookups through
// find_places, then a submission that is validated and, if needed, sent back for repair.
// A session only builds requests and reacts to responses; a runner decides whether they go
// through synchronous calls or the Message Batches API, so both modes share this logic.
// The claim check (pipeline/claims) runs the same loop with its own tools and result type.
//
// History is append-only (thinking blocks and the prompt cache both depend on it): responses are
// appended unchanged, and repairs and reminders are new user turns.
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages';
import type { CountryFile } from '../../src/content/schema';
import type { Effort, GenerationLimits } from '../config';
import { retrievedUrls } from './evidence';
import type { MessageRequest } from './model-client';
import { addUsage, emptyUsage, type Usage } from './usage';

/** `file` is what the session produces: a country file for drafts, verdicts for a claim check. */
export type Submission<T = CountryFile> =
  { ok: true; file: T } | { ok: false; issues: string[]; draft?: unknown };

export type SessionSetup<T = CountryFile> = {
  /** Stable key: the batch custom ID and the recording directory name. */
  tag: string;
  model: string;
  effort: Effort;
  limits: GenerationLimits;
  /** Prompt cache lifetime; batch runs use 1h because queued requests may wait longer than 5m. */
  cacheTtl: '5m' | '1h';
  system: BetaTextBlockParam[];
  tools: BetaToolUnion[];
  /** The first user turn. Put shared, cacheable blocks first. */
  task: BetaTextBlockParam[];
  submitTool: string;
  /** Rendered prompt texts for the repair and reminder turns. */
  repairMessage: (issues: string[]) => string;
  nudgeMessage: string;
  /** Answer a client tool other than the submission tool. */
  runTool: (name: string, input: unknown) => string | Promise<string>;
  /** Validate a submission and turn it into a content file. */
  submit: (input: unknown, context: { model: string; evidence: Set<string> }) => Submission<T>;
  /** Which URLs a response retrieved; defaults to every page a web tool returned. */
  evidence?: (content: BetaContentBlock[]) => Set<string>;
};

export type SessionState<T = CountryFile> =
  | { status: 'running' }
  | { status: 'done'; file: T; model: string }
  | { status: 'failed'; reason: string; lastDraft?: unknown };

/** Everything a session needs to continue after the process restarts (batch runs). */
export type SessionSnapshot<T = CountryFile> = {
  tag: string;
  messages: BetaMessageParam[];
  evidence: string[];
  usage: Usage;
  log: string[];
  state: SessionState<T>;
  repairs: number;
  continuations: number;
  nudges: number;
  lastDraft?: unknown;
};

/** Shown to the model so it can fix several problems at once without flooding its context. */
const MAX_ISSUES_PER_REPAIR = 60;

export class DraftSession<T = CountryFile> {
  readonly tag: string;
  readonly usage: Usage = emptyUsage();
  /** One line per notable event, for the run log. */
  readonly log: string[] = [];
  state: SessionState<T> = { status: 'running' };

  private readonly messages: BetaMessageParam[];
  private readonly evidence = new Set<string>();
  private repairs = 0;
  private continuations = 0;
  private nudges = 0;
  private lastDraft: unknown;

  constructor(
    private readonly setup: SessionSetup<T>,
    snapshot?: SessionSnapshot<T>,
  ) {
    this.tag = setup.tag;
    this.messages = [{ role: 'user', content: setup.task }];
    if (snapshot) {
      if (snapshot.tag !== setup.tag)
        throw new Error(`Snapshot is for ${snapshot.tag}, not ${setup.tag}`);
      this.messages = snapshot.messages;
      snapshot.evidence.forEach((url) => this.evidence.add(url));
      Object.assign(this.usage, snapshot.usage);
      this.log.push(...snapshot.log);
      this.state = snapshot.state;
      this.repairs = snapshot.repairs;
      this.continuations = snapshot.continuations;
      this.nudges = snapshot.nudges;
      this.lastDraft = snapshot.lastDraft;
    }
  }

  snapshot(): SessionSnapshot<T> {
    return {
      tag: this.tag,
      messages: this.messages,
      evidence: [...this.evidence],
      usage: { ...this.usage },
      log: [...this.log],
      state: this.state,
      repairs: this.repairs,
      continuations: this.continuations,
      nudges: this.nudges,
      lastDraft: this.lastDraft,
    };
  }

  get running(): boolean {
    return this.state.status === 'running';
  }

  /** The next request. Only valid while running. */
  request(): MessageRequest {
    const ttl = this.setup.cacheTtl === '1h' ? { ttl: '1h' as const } : {};
    return {
      model: this.setup.model,
      max_tokens: this.setup.limits.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.setup.effort },
      // An explicit breakpoint ends the shared system prompt; automatic caching follows the
      // growing conversation so each turn reads the previous turns from cache.
      cache_control: { type: 'ephemeral', ...ttl },
      system: this.setup.system,
      tools: this.setup.tools,
      messages: this.messages,
    };
  }

  /** A request failed outright (API error, expired batch entry). */
  fail(reason: string): void {
    this.state = { status: 'failed', reason, lastDraft: this.lastDraft };
  }

  async handle(message: BetaMessage, batch: boolean): Promise<void> {
    if (!this.running) throw new Error(`Session ${this.tag} is not running`);
    addUsage(this.usage, message.usage, batch);
    const evidence = this.setup.evidence ?? retrievedUrls;
    for (const url of evidence(message.content)) this.evidence.add(url);
    this.messages.push({ role: 'assistant', content: message.content as BetaContentBlockParam[] });
    await this.respond(message);
    // The limit applies to the next request: a submission in the last allowed response still counts.
    if (this.running && this.usage.requests >= this.setup.limits.requests) {
      this.fail(`stopped after ${this.usage.requests} requests`);
    }
  }

  private async respond(message: BetaMessage): Promise<void> {
    switch (message.stop_reason) {
      case 'pause_turn':
        // The server tool loop hit its iteration limit; resending the history resumes it.
        this.continuations += 1;
        if (this.continuations > this.setup.limits.continuations) {
          return this.fail('research did not finish within the continuation limit');
        }
        return;
      case 'tool_use':
        return this.handleToolUse(message);
      case 'end_turn':
      case 'stop_sequence':
        this.nudges += 1;
        if (this.nudges > this.setup.limits.nudges) {
          return this.fail(`ended without calling ${this.setup.submitTool}`);
        }
        this.log.push(`reminded to call ${this.setup.submitTool}`);
        this.messages.push({ role: 'user', content: this.setup.nudgeMessage });
        return;
      case 'refusal':
        return this.fail(
          `refused${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}: ${message.stop_details?.explanation ?? 'no explanation'}`,
        );
      case 'max_tokens':
        return this.fail(
          `output reached max_tokens (${this.setup.limits.maxTokens}); raise it or reduce the scope`,
        );
      default:
        return this.fail(`unexpected stop reason "${message.stop_reason}"`);
    }
  }

  private async handleToolUse(message: BetaMessage): Promise<void> {
    const calls = message.content.filter(
      (block): block is BetaToolUseBlock => block.type === 'tool_use',
    );
    const results: BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name !== this.setup.submitTool) {
        results.push(await this.runTool(call));
        continue;
      }
      this.lastDraft = call.input;
      const submission = this.setup.submit(call.input, {
        model: message.model,
        evidence: this.evidence,
      });
      if (submission.ok) {
        this.state = { status: 'done', file: submission.file, model: message.model };
        return;
      }
      this.repairs += 1;
      this.log.push(`submission ${this.repairs} had ${submission.issues.length} issues`);
      if (this.repairs > this.setup.limits.repairAttempts) {
        return this.fail(
          `still invalid after ${this.setup.limits.repairAttempts} repairs:\n  ${submission.issues.join('\n  ')}`,
        );
      }
      const shown = submission.issues.slice(0, MAX_ISSUES_PER_REPAIR);
      const more = submission.issues.length - shown.length;
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: this.setup.repairMessage(
          more > 0 ? [...shown, `...and ${more} more like these`] : shown,
        ),
      });
    }
    if (!results.length) return this.fail('stopped for tool use without a tool call');
    this.messages.push({ role: 'user', content: results });
  }

  private async runTool(call: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
    try {
      return {
        type: 'tool_result',
        tool_use_id: call.id,
        content: await this.setup.runTool(call.name, call.input),
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
