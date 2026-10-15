import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

import type { LLMProvider, ProjectSession } from '@/shared/types';

/**
 * The composer creates a new session under useChatProviderState's `provider`
 * (useChatComposerState → api.providers.createSession). That state is seeded
 * synchronously from the stored choice, while the operator agent lock
 * (CLOUDCLI_FIXED_AGENT) arrives later over /health — so the hook has to follow
 * the lock once it lands, or the first chat goes to the wrong agent. An open
 * session keeps the provider it was created with.
 */

let answerHealth: (body: unknown) => void = () => {};

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    health: () => new Promise((resolve) => {
      answerHealth = (body) => resolve({ ok: true, json: async () => body });
    }),
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: null }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

// The lock store loads once per page, so every case gets fresh modules — React
// and the testing library included, so they share one React with the hook.
const loadFresh = async () => {
  vi.resetModules();
  const testingLibrary = await import('@testing-library/react');
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { loadFixedProvider } = await import('@/shared/selectedProvider');
  const { resetUserPreferences, writeUserPreference } = await import('@/shared/userSettings');
  resetUserPreferences();
  return { testingLibrary, useChatProviderState, loadFixedProvider, writeUserPreference };
};

const sessionOf = (provider: LLMProvider) => ({
  id: 'session-1',
  __provider: provider,
}) as unknown as ProjectSession;

beforeEach(() => {
  localStorage.clear();
});

test('a new chat switches to the fixed agent once /health answers', async () => {
  const { testingLibrary, useChatProviderState, loadFixedProvider, writeUserPreference } = await loadFresh();
  writeUserPreference('selectedProvider', 'claude');
  const loading = loadFixedProvider();

  const { result } = testingLibrary.renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
  assert.equal(result.current.provider, 'claude');

  await testingLibrary.act(async () => {
    answerHealth({ fixedAgent: 'codex' });
    await loading;
  });

  await testingLibrary.waitFor(() => assert.equal(result.current.provider, 'codex'));
});

test('an open session keeps its own provider when a lock lands', async () => {
  const { testingLibrary, useChatProviderState, loadFixedProvider, writeUserPreference } = await loadFresh();
  writeUserPreference('selectedProvider', 'claude');
  const loading = loadFixedProvider();
  const selectedSession = sessionOf('claude');

  const { result } = testingLibrary.renderHook(() => useChatProviderState({ selectedSession, selectedProject: null }));

  await testingLibrary.act(async () => {
    answerHealth({ fixedAgent: 'codex' });
    await loading;
  });

  assert.equal(result.current.provider, 'claude');
});

test('without a lock a new chat keeps the stored choice', async () => {
  const { testingLibrary, useChatProviderState, loadFixedProvider, writeUserPreference } = await loadFresh();
  writeUserPreference('selectedProvider', 'cursor');
  const loading = loadFixedProvider();

  const { result } = testingLibrary.renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));

  await testingLibrary.act(async () => {
    answerHealth({ fixedAgent: null });
    await loading;
  });

  assert.equal(result.current.provider, 'cursor');
});
