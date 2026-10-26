import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { messages } from '@/i18n';

/** Shown for any address that is not a country or a question. The globe stays behind it. */
export function NotFoundView() {
  const text = messages.notFound;
  return (
    <section className="discovery" id="discovery-start">
      <div className="eyebrow">
        <span className="tiny-orbit" /> {text.eyebrow}
      </div>
      <h1>{text.title}</h1>
      <p className="intro">{text.description}</p>
      <Link className="surprise" href="/">
        {text.back}
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}
