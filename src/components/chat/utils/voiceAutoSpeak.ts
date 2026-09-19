import type { NormalizedMessage } from '../../../stores/useSessionStore';

// Whatever is spoken is also what gets sent to the voice backend, so an answer
// is reduced to prose before it leaves: code, images and link targets are
// dropped rather than read out, and the turn is capped, because automatic
// read-aloud should not narrate a thousand-line answer.
const MAX_SPEECH_LENGTH = 1200;

function cutAtSentenceEnd(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  // Only honour a break past the halfway mark: a single long sentence would
  // otherwise collapse to a few words.
  if (sentenceEnd > limit / 2) return head.slice(0, sentenceEnd + 1);
  const lastSpace = head.lastIndexOf(' ');
  return lastSpace > limit / 2 ? head.slice(0, lastSpace) : head;
}

/**
 * Reduces an assistant answer to the words worth speaking. Pure, so the rules
 * are testable without a player or a backend.
 */
export function speakableText(raw: string): string {
  const prose = raw
    .replace(/```[\s\S]*?```/g, ' ')               // fenced code, language tag included
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')                 // inline code: keep the name, drop the ticks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')         // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // links: keep the label, drop the target
    .replace(/<[a-z][a-z0-9+.-]*:\/\/[^>\s]+>/gi, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ') // bare urls of any scheme
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')            // heading markers
    .replace(/^\s{0,3}[-*+]\s+/gm, '')             // bullet markers
    .replace(/^\s{0,3}>\s?/gm, '')                 // quote markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[ \t]+/g, ' ')
    // Removing a block leaves the blank line it stood on, so lines are rebuilt
    // rather than patched with more whitespace regexes.
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  return cutAtSentenceEnd(prose, MAX_SPEECH_LENGTH).trim();
}

// Auto read-aloud picks the text the user just saw arrive: the last finalized
// assistant turn of the session. Streaming rows are skipped because they carry
// partial text, and tool traffic is skipped because it is not prose.
export function pickAutoSpeakText(messages: NormalizedMessage[] | null | undefined): string | null {
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.kind !== 'text' || message.role !== 'assistant') continue;
    // `updateStreaming` writes a well-known id that `finalizeStreaming` replaces;
    // seeing it here means the turn is still mid-flight.
    if (typeof message.id === 'string' && message.id.startsWith('__streaming_')) continue;

    const text = speakableText(message.content || '');
    return text ? text : null;
  }

  return null;
}
