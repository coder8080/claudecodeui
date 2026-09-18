import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { pickAutoSpeakText } from './voiceAutoSpeak';

const message = (overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: 'text_1',
  sessionId: 's1',
  timestamp: '2026-01-01T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  content: 'hello',
  ...overrides,
} as NormalizedMessage);

test('pickAutoSpeakText returns the last finalized assistant turn', () => {
  const messages = [
    message({ id: 'text_1', content: 'first answer' }),
    message({ id: 'user_1', role: 'user', content: 'a question' }),
    message({ id: 'text_2', content: 'second answer' }),
  ];

  assert.equal(pickAutoSpeakText(messages), 'second answer');
});

test('pickAutoSpeakText ignores tool traffic after the answer', () => {
  const messages = [
    message({ id: 'text_1', content: 'the answer' }),
    message({ id: 'tool_1', kind: 'tool_use', content: undefined, toolName: 'Bash' }),
    message({ id: 'tool_2', kind: 'tool_result', content: 'command output' }),
  ];

  assert.equal(pickAutoSpeakText(messages), 'the answer');
});

test('pickAutoSpeakText skips a still-streaming row', () => {
  const messages = [
    message({ id: '__streaming_s1', kind: 'text', content: 'partial te' }),
  ];

  assert.equal(pickAutoSpeakText(messages), null);
});

test('pickAutoSpeakText returns null when the last assistant turn is blank', () => {
  const messages = [
    message({ id: 'text_1', content: 'earlier answer' }),
    message({ id: 'text_2', content: '   ' }),
  ];

  assert.equal(pickAutoSpeakText(messages), null);
});

test('pickAutoSpeakText tolerates missing input', () => {
  assert.equal(pickAutoSpeakText(null), null);
  assert.equal(pickAutoSpeakText([]), null);
});
