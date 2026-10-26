import { ArrowUpRight } from 'lucide-react';
import type { StoryLinkView } from '@/domain/view-models';
import { messages } from '@/i18n';
import { DestinationLink } from '../DestinationLink';

/** The few starting questions content suggests (content/<locale>/home.json). */
export function SuggestedQuestions({ links }: { links: StoryLinkView[] }) {
  if (!links.length) return null;
  return (
    <section className="home-suggestions" aria-labelledby="home-suggestions-label">
      <h2 className="home-label" id="home-suggestions-label">
        {messages.home.suggestions}
      </h2>
      <ul>
        {links.map((link) => (
          <li key={link.key}>
            <DestinationLink href={link.href} className="home-suggestion">
              <span className="home-suggestion-text">
                <strong>{link.title}</strong>
                <small>
                  <span aria-hidden>{link.flag}</span> {link.countryName}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </DestinationLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
