import type { Source } from './types';

export const sourcesToText = (sources: Source[]) =>
  sources.map((s) => (s.title && s.url ? `${s.title} | ${s.url}` : s.url || s.title)).join('\n');

/** Una fuente por línea: «Título | https://…», solo la URL o solo una referencia en texto. */
export function textToSources(text: string): Source[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cut = line.lastIndexOf('|');
      if (cut >= 0) return { title: line.slice(0, cut).trim(), url: line.slice(cut + 1).trim() };
      return /^https?:\/\//.test(line) ? { title: '', url: line } : { title: line, url: '' };
    });
}
