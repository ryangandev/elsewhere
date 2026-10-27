// Command-line parsing for the pipeline's commands. Node's parseArgs keeps only the last value of
// an option given twice, so `places NGA --country A --country B` searched only B without a word.
// Here an option that takes one value refuses a second; options that may repeat say so with
// `multiple: true`.
import { parseArgs, type ParseArgsConfig } from 'node:util';

/** The option names given more than once that may not repeat, in the order first given. */
export function repeatedOptions(config: ParseArgsConfig): string[] {
  const { tokens } = parseArgs({ ...config, tokens: true });
  const given = tokens.flatMap((token) => (token.kind === 'option' ? [token.name] : []));
  return [...new Set(given)].filter(
    (name) =>
      !config.options?.[name]?.multiple && given.filter((other) => other === name).length > 1,
  );
}

/** parseArgs, except that an option that takes one value may not be given twice. */
export function parseArgsOnce<T extends ParseArgsConfig>(
  config: T,
): ReturnType<typeof parseArgs<T>> {
  const [repeated] = repeatedOptions(config);
  if (repeated) {
    throw new Error(
      `--${repeated} was given more than once; give it once (only options documented as repeatable may repeat).`,
    );
  }
  return parseArgs(config);
}
