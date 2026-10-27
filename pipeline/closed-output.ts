// A command's output piped into `head` (or anything that stops reading early) is closed while the
// command still writes. Node then raises EPIPE as an unhandled error and the command dies with a
// stack trace, although nothing went wrong: the reader just wanted no more. The command carries
// on, its remaining output is dropped, and it exits with its own code.

/** Write errors that only mean the reader has gone. */
const CLOSED = new Set(['EPIPE', 'ERR_STREAM_DESTROYED']);

/** Let `stream` (stdout by default) close early without failing the command. */
export function ignoreClosedOutput(stream: NodeJS.WriteStream = process.stdout): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (!error.code || !CLOSED.has(error.code)) throw error;
  });
}
