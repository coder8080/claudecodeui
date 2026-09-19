import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { pickAutoSpeakText, speakableText } from './voiceAutoSpeak';

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

test('speakableText drops fenced code but keeps the prose around it', () => {
  const answer = [
    'Here is the fix.',
    '',
    '```ts',
    'const secret = readToken();',
    '```',
    '',
    'Run it once.',
  ].join('\n');

  assert.equal(speakableText(answer), 'Here is the fix.\nRun it once.');
});

test('speakableText keeps inline code words and link labels, drops targets', () => {
  assert.equal(
    speakableText('Open the [dashboard](https://internal.example/reports?token=abc) and check `usage`.'),
    'Open the dashboard and check usage.',
  );
});

test('speakableText removes bare urls of any scheme', () => {
  assert.equal(
    speakableText('Logs live at https://logs.example/a?b=c and postgres://user:pw@db/app is the source.'),
    'Logs live at and is the source.',
  );
});

test('speakableText strips markdown markers that should not be pronounced', () => {
  const answer = '## Result\n\n- **first** item\n- second item\n\n> quoted line';

  assert.equal(speakableText(answer), 'Result\nfirst item\nsecond item\nquoted line');
});

test('speakableText caps a long answer at a sentence boundary', () => {
  const sentence = 'This sentence is exactly the padding this test needs. ';
  const spoken = speakableText(sentence.repeat(40));

  assert.ok(spoken.length <= 1200, `expected a capped turn, got ${spoken.length}`);
  assert.ok(spoken.endsWith('needs.'), `expected a whole sentence, got …${spoken.slice(-40)}`);
});

test('speakableText returns nothing for an answer that was only code', () => {
  assert.equal(speakableText('```\nnpm run build\n```'), '');
});

test('pickAutoSpeakText skips an answer that leaves nothing to say', () => {
  const messages = [
    message({ id: 'text_1', content: 'earlier answer' }),
    message({ id: 'text_2', content: '```\nnpm run build\n```' }),
  ];

  assert.equal(pickAutoSpeakText(messages), null);
});
