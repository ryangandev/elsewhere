import { en } from './en';

/** The shape every language catalog must have. */
export type Messages = typeof en;

/** Stage 1 ships English only. A second language adds a catalog of type `Messages` and a locale switch here. */
export const messages: Messages = en;

/** Fills `{placeholder}` markers in a message. Unknown placeholders are left as they are. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
