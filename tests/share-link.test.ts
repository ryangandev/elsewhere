import { describe, expect, it, vi } from 'vitest';
import { shareLink } from '@/ui/atlas/share-link';

const data = { title: 'Why is Singapore so rich? | Elsewhere', url: 'https://example.test/sg' };

describe('shareLink', () => {
  it('opens the share sheet on a touch device and copies nothing', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);

    expect(await shareLink(data, { touch: true, share, writeText })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link on a desktop even when the browser has a share sheet', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    expect(await shareLink(data, { touch: false, share, writeText })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
    expect(share).not.toHaveBeenCalled();
  });

  it('treats closing the share sheet as a choice, not an error', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const writeText = vi.fn();

    expect(await shareLink(data, { touch: true, share, writeText })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link when the share sheet is refused', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);

    expect(await shareLink(data, { touch: true, share, writeText })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('copies the link on a touch device without a share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    expect(await shareLink(data, { touch: true, writeText })).toBe('copied');
  });

  it('leaves the link to copy by hand when both fail', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const writeText = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));

    expect(await shareLink(data, { touch: true, share, writeText })).toBe('manual');
    expect(await shareLink(data, { touch: false })).toBe('manual');
  });
});
