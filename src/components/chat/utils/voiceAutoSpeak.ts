import type { NormalizedMessage } from '../../../stores/useSessionStore';

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

    const text = (message.content || '').trim();
    return text ? text : null;
  }

  return null;
}
