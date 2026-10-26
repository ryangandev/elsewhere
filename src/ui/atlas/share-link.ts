/** What sharing did: handed to the system share sheet, copied, or left for the reader to copy. */
export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'manual';

/** The parts of the browser sharing depends on, so tests can supply their own. */
export type ShareEnvironment = {
  /** True when the main pointer is a finger, where the system share sheet is the natural choice. */
  touch: boolean;
  share?: (data: { title: string; url: string }) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
};

export function browserShareEnvironment(): ShareEnvironment {
  return {
    touch: window.matchMedia('(pointer: coarse)').matches,
    share: typeof navigator.share === 'function' ? (data) => navigator.share(data) : undefined,
    writeText: navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : undefined,
  };
}

/**
 * Shares a link. Touch devices with a share sheet use it, and closing the sheet is a choice, not a
 * failure. Everywhere else (or when the sheet is refused) the link is copied, and when even that is
 * refused the caller shows it to copy by hand.
 */
export async function shareLink(
  data: { title: string; url: string },
  env: ShareEnvironment,
): Promise<ShareOutcome> {
  if (env.touch && env.share) {
    try {
      await env.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (!env.writeText) throw new Error('Clipboard unavailable');
    await env.writeText(data.url);
    return 'copied';
  } catch {
    return 'manual';
  }
}
