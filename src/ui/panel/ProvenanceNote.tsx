import type { ProvenanceView } from '@/domain/view-models';
import { format, messages } from '@/i18n';

const dateFormat = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  // Content dates are calendar dates; reading them as UTC keeps the day in every time zone.
  timeZone: 'UTC',
});

/** Who wrote the content and whether it was reviewed: AI-assisted or edited by hand. */
export function ProvenanceNote({ provenance }: { provenance: ProvenanceView }) {
  const text = messages.provenance;
  const origin = provenance.aiAssisted ? text.aiAssisted : text.byHand;
  const review =
    provenance.status === 'reviewed' && provenance.reviewedAt
      ? format(text.reviewed, { date: dateFormat.format(new Date(provenance.reviewedAt)) })
      : text.draft;

  return (
    <p className="provenance-note">
      {origin} · {review}
    </p>
  );
}
