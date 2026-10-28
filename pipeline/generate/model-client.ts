// How the pipeline talks to Claude. Generation code depends only on the ModelClient interface,
// so the same sessions run against the real API, a recording of it, or a replay in tests.
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages';
import { BATCH_CUSTOM_ID } from '../config';
import { writeJson } from '../content-tree';

/** One Messages API request, without streaming or batch-only options. */
export type MessageRequest = Omit<
  MessageCreateParamsNonStreaming,
  'stream' | 'betas' | 'fallbacks'
>;

/** A request with a stable tag: the country or plan it belongs to. Batch custom IDs use it. */
export type TaggedRequest = { tag: string; request: MessageRequest };

export type BatchOutcome =
  | { type: 'succeeded'; message: BetaMessage }
  | { type: 'errored' | 'canceled' | 'expired'; error: string };

export type BatchOptions = {
  /** Continue waiting for a batch submitted by an earlier, interrupted run. */
  resumeBatchId?: string;
  /** Called once the batch exists, so a run can record its ID before waiting. */
  onSubmitted?: (batchId: string) => void;
  onProgress?: (status: string) => void;
};

export interface ModelClient {
  /** A short description for logs, e.g. "Anthropic API" or "replay of tests/...". */
  readonly description: string;
  create(request: TaggedRequest): Promise<BetaMessage>;
  /** Run requests through the Message Batches API; results keyed by tag. */
  runBatch(requests: TaggedRequest[], options?: BatchOptions): Promise<Map<string, BatchOutcome>>;
}

/** Refuse tags the Batches API would reject as custom IDs, before anything is sent. */
export function checkBatchTags(requests: TaggedRequest[]): void {
  const invalid = requests.filter(({ tag }) => !BATCH_CUSTOM_ID.test(tag)).map(({ tag }) => tag);
  if (invalid.length) {
    throw new Error(
      `Batch custom IDs must match ${BATCH_CUSTOM_ID}; these tags do not: ${invalid.join(', ')}`,
    );
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      [
        'ANTHROPIC_API_KEY is not set.',
        'Put it in a git-ignored .env.local at the repository root:',
        '  ANTHROPIC_API_KEY=sk-ant-...',
        'or export it in your shell, then run the command again.',
        'To exercise the pipeline without the API, pass --replay <fixture dir>.',
      ].join('\n'),
    );
    this.name = 'MissingApiKeyError';
  }
}

/** Models that accept the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type AnthropicClientOptions = {
  /**
   * Retry a policy refusal on the server's default fallback model (synchronous requests only;
   * the Batches API rejects the parameter). provenance.generatedBy records whichever model
   * produced the accepted draft.
   */
  fallbacks: boolean;
  /** How often to poll a running batch. */
  pollIntervalMs?: number;
};

export class AnthropicModelClient implements ModelClient {
  readonly description = 'Anthropic API';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicClientOptions) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new MissingApiKeyError();
    }
    // Long research turns can run for minutes; the SDK retries 408, 429 and 5xx.
    this.client = new Anthropic({ maxRetries: 4, timeout: 30 * 60 * 1000 });
  }

  async create({ request }: TaggedRequest): Promise<BetaMessage> {
    const fallback = this.options.fallbacks && FALLBACK_MODELS.has(request.model);
    // Streaming avoids HTTP timeouts on long outputs; finalMessage() assembles the result.
    const stream = this.client.beta.messages.stream({
      ...request,
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    });
    return stream.finalMessage();
  }

  async runBatch(
    requests: TaggedRequest[],
    { resumeBatchId, onSubmitted, onProgress }: BatchOptions = {},
  ): Promise<Map<string, BatchOutcome>> {
    let batchId = resumeBatchId;
    if (!batchId) {
      checkBatchTags(requests);
      const batch = await this.client.beta.messages.batches.create({
        requests: requests.map(({ tag, request }) => ({ custom_id: tag, params: request })),
      });
      batchId = batch.id;
      onSubmitted?.(batchId);
    }
    const pollMs = this.options.pollIntervalMs ?? 60_000;
    for (;;) {
      const batch = await this.client.beta.messages.batches.retrieve(batchId);
      const counts = batch.request_counts;
      onProgress?.(
        `batch ${batchId}: ${batch.processing_status}, ${counts.processing} processing, ${counts.succeeded} succeeded, ${counts.errored} errored`,
      );
      if (batch.processing_status === 'ended') break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    const outcomes = new Map<string, BatchOutcome>();
    for await (const entry of await this.client.beta.messages.batches.results(batchId)) {
      const result = entry.result;
      outcomes.set(
        entry.custom_id,
        result.type === 'succeeded'
          ? { type: 'succeeded', message: result.message }
          : {
              type: result.type,
              error:
                result.type === 'errored' ? JSON.stringify(result.error) : `request ${result.type}`,
            },
      );
    }
    return outcomes;
  }
}

const turnFile = (dir: string, tag: string, turn: number) =>
  join(dir, tag, `${String(turn).padStart(3, '0')}.json`);

/**
 * Wraps a client and saves every response as <dir>/<tag>/<turn>.json, so a real run can be
 * replayed later (for example as a test fixture) without the API.
 */
export class RecordingClient implements ModelClient {
  readonly description: string;
  private readonly turns = new Map<string, number>();

  constructor(
    private readonly inner: ModelClient,
    private readonly dir: string,
  ) {
    this.description = `${inner.description}, recording to ${dir}`;
  }

  private save(tag: string, message: BetaMessage) {
    const turn = (this.turns.get(tag) ?? 0) + 1;
    this.turns.set(tag, turn);
    mkdirSync(join(this.dir, tag), { recursive: true });
    writeJson(turnFile(this.dir, tag, turn), message);
  }

  async create(request: TaggedRequest): Promise<BetaMessage> {
    const message = await this.inner.create(request);
    this.save(request.tag, message);
    return message;
  }

  async runBatch(requests: TaggedRequest[], options?: BatchOptions) {
    const outcomes = await this.inner.runBatch(requests, options);
    for (const { tag } of requests) {
      const outcome = outcomes.get(tag);
      if (outcome?.type === 'succeeded') this.save(tag, outcome.message);
    }
    return outcomes;
  }
}

/**
 * Replays recorded responses: the n-th request with a tag gets <dir>/<tag>/<n>.json. Used by the
 * tests and by `--replay` to run the whole pipeline without network or an API key.
 */
export class ReplayClient implements ModelClient {
  readonly description: string;
  private readonly turns = new Map<string, number>();
  /** Every request received, for tests to inspect. */
  readonly requests: TaggedRequest[] = [];

  constructor(private readonly dir: string) {
    if (!existsSync(dir)) throw new Error(`Replay directory "${dir}" does not exist`);
    this.description = `replay of ${dir}`;
  }

  /** Tags that have recordings. */
  tags(): string[] {
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  async create(request: TaggedRequest): Promise<BetaMessage> {
    // A copy: sessions keep appending to the same message history after the call.
    this.requests.push(structuredClone(request));
    const turn = (this.turns.get(request.tag) ?? 0) + 1;
    this.turns.set(request.tag, turn);
    const file = turnFile(this.dir, request.tag, turn);
    if (!existsSync(file)) {
      throw new Error(`No recorded response for "${request.tag}" turn ${turn} (${file})`);
    }
    return JSON.parse(readFileSync(file, 'utf8')) as BetaMessage;
  }

  async runBatch(requests: TaggedRequest[], options?: BatchOptions) {
    checkBatchTags(requests);
    options?.onSubmitted?.('replay');
    const outcomes = new Map<string, BatchOutcome>();
    for (const request of requests) {
      outcomes.set(request.tag, { type: 'succeeded', message: await this.create(request) });
    }
    return outcomes;
  }
}
