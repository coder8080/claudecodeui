import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * What the UI's permission mode turns into on the SDK options. The mode the
 * user picked has to reach the CLI as is, 'default' included: left out, the
 * CLI falls back to permissions.defaultMode from settings.json, which may be
 * 'auto'. Driven through `queryClaudeSDK` with a stand-in `createQuery` that
 * records the options it is handed.
 */

const NATIVE_ID = 'native-permission-mode';
const PLAN_MODE_TOOLS = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];

type CapturedOptions = { permissionMode?: string; allowedTools?: string[] };

async function sdkOptionsFor(sessionId: string, runOptions: Record<string, unknown>): Promise<CapturedOptions> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-permission-mode-'));
  let captured: CapturedOptions | null = null;

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    captured = { ...(options as CapturedOptions) };
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();
    const iterator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: NATIVE_ID };
      yield { type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'ok', duration_ms: 1, num_turns: 1 };
    })();
    return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} }) as never;
  };

  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, id) => sessions.normalizeMessage(raw, id),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    await queryClaudeSDK('hello', { sessionId, cwd, ...runOptions }, writer as never, context);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }

  assert.ok(captured, 'the SDK query was created');
  return captured;
}

const cases: Array<{ name: string; options: Record<string, unknown>; expected: string | undefined }> = [
  { name: 'no mode leaves it to settings.json', options: {}, expected: undefined },
  { name: 'default', options: { permissionMode: 'default' }, expected: 'default' },
  { name: 'auto', options: { permissionMode: 'auto' }, expected: 'auto' },
  { name: 'acceptEdits', options: { permissionMode: 'acceptEdits' }, expected: 'acceptEdits' },
  { name: 'bypassPermissions', options: { permissionMode: 'bypassPermissions' }, expected: 'bypassPermissions' },
  { name: 'plan', options: { permissionMode: 'plan' }, expected: 'plan' },
  {
    name: 'skipPermissions overrides default',
    options: { permissionMode: 'default', toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true } },
    expected: 'bypassPermissions',
  },
  {
    name: 'skipPermissions does not override plan',
    options: { permissionMode: 'plan', toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true } },
    expected: 'plan',
  },
];

for (const [index, { name, options, expected }] of cases.entries()) {
  test(`permission mode reaches the SDK: ${name}`, async () => {
    const sdkOptions = await sdkOptionsFor(`app-permission-mode-${index}`, options);
    assert.equal(sdkOptions.permissionMode, expected);
    if (!('permissionMode' in options) || expected === undefined) {
      assert.equal('permissionMode' in sdkOptions, false, 'no permissionMode key at all');
    }
  });
}

test('plan mode adds the read-only tools to allowedTools', async () => {
  const sdkOptions = await sdkOptionsFor('app-permission-mode-plan-tools', {
    permissionMode: 'plan',
    toolsSettings: { allowedTools: ['Bash(ls)'], disallowedTools: [], skipPermissions: false },
  });
  assert.deepEqual(sdkOptions.allowedTools, ['Bash(ls)', ...PLAN_MODE_TOOLS]);
});

test('other modes keep allowedTools as configured', async () => {
  const sdkOptions = await sdkOptionsFor('app-permission-mode-auto-tools', {
    permissionMode: 'auto',
    toolsSettings: { allowedTools: ['Bash(ls)'], disallowedTools: [], skipPermissions: false },
  });
  assert.deepEqual(sdkOptions.allowedTools, ['Bash(ls)']);
});
