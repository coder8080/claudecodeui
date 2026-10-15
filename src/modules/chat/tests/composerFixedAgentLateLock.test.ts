import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import type { PermissionMode, Project } from '@/shared/types';

/**
 * A brand-new chat is created under the composer's `provider`, and its model
 * options come from that provider. The operator agent lock
 * (CLOUDCLI_FIXED_AGENT) arrives over /health; if the user sends before it
 * lands, the first submit must wait for it, and must not create a session under
 * a different agent — that session would keep the wrong agent for good.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let answerHealth: (body: unknown) => void = () => {};
let fetchMock: ReturnType<typeof vi.fn>;

const createRequests = () => fetchMock.mock.calls
  .filter(([url, init]) => String(url) === '/api/providers/sessions' && (init as RequestInit | undefined)?.method === 'POST');

// The lock store loads once per page, so each case gets fresh modules — React
// and the testing library included, so they share one React with the hook.
const renderNewChat = async () => {
  vi.resetModules();
  const testingLibrary = await import('@testing-library/react');
  await import('@/modules/i18n');
  const { useChatComposerState } = await import('@/modules/chat/hooks/useChatComposerState');
  const sent: Array<{ type: string; sessionId?: string }> = [];
  const view = testingLibrary.renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: null,
      currentSessionId: null,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'opus',
      currentProviderEffort: 'medium',
      isLoading: false,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      onSessionEstablished: () => undefined,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }));
  return { testingLibrary, view, chatSends: () => sent.filter((message) => message.type === 'chat.send') };
};

beforeEach(() => {
  fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/health') {
      return new Promise<Response>((resolve) => {
        answerHealth = (body) => resolve(jsonResponse(body));
      });
    }
    if (String(url) === '/api/providers/sessions' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse({ success: true, data: { sessionId: 'session-1', sessionName: 'hello' } }, 201));
    }
    return Promise.resolve(jsonResponse([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a first send before /health answers does not start a chat under another agent', async () => {
  const { testingLibrary, view, chatSends } = await renderNewChat();
  await testingLibrary.act(async () => { view.result.current.setInput('hello'); });

  let submitting: Promise<void> = Promise.resolve();
  await testingLibrary.act(async () => {
    submitting = view.result.current.handleSubmit({ preventDefault: () => undefined } as never) as Promise<void>;
  });
  assert.equal(createRequests().length, 0, 'the submit waits for the lock before creating a session');

  await testingLibrary.act(async () => {
    answerHealth({ fixedAgent: 'codex' });
    await submitting;
  });

  assert.equal(createRequests().length, 0, 'no session is created under the stale agent');
  assert.equal(chatSends().length, 0);
  assert.equal(view.result.current.input, 'hello', 'the draft stays for the send under the fixed agent');
});

test('a first send before /health answers goes ahead once the lock matches or is absent', async () => {
  for (const fixedAgent of ['claude', null]) {
    const { testingLibrary, view, chatSends } = await renderNewChat();
    fetchMock.mockClear();
    await testingLibrary.act(async () => { view.result.current.setInput('hello'); });

    let submitting: Promise<void> = Promise.resolve();
    await testingLibrary.act(async () => {
      submitting = view.result.current.handleSubmit({ preventDefault: () => undefined } as never) as Promise<void>;
    });
    await testingLibrary.act(async () => {
      answerHealth({ fixedAgent });
      await submitting;
    });

    assert.equal(createRequests().length, 1, `fixedAgent=${String(fixedAgent)}`);
    const body = JSON.parse(String((createRequests()[0][1] as RequestInit).body));
    assert.equal(body.provider, 'claude');
    assert.deepEqual(chatSends().map((message) => message.sessionId), ['session-1']);
  }
});
