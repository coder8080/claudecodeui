import assert from 'node:assert/strict';
import { createRef } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import type { LLMProvider, ProviderModelActions } from '@/shared/types';

/**
 * A new chat's empty state under the operator agent lock (CLOUDCLI_FIXED_AGENT).
 * With the lock the agent picker — card, logo and "Ready with …" line — must be
 * gone; without it the picker must look exactly as before; and while /health is
 * still answering nothing that could flash the picker may render.
 */

let fixedProviderState: { fixedProvider: LLMProvider | null; resolved: boolean } = { fixedProvider: null, resolved: false };

vi.mock('@/shared/hooks/useFixedProvider', () => ({
  useFixedProvider: () => fixedProviderState.fixedProvider,
  useFixedProviderResolved: () => fixedProviderState.resolved,
}));

const PROVIDER_MODELS: Record<LLMProvider, string> = {
  claude: 'opus',
  cursor: 'auto',
  codex: 'gpt-5',
  opencode: 'default',
};

const MODEL_ACTIONS: ProviderModelActions = {
  create: async () => {},
  update: async () => {},
  remove: async () => {},
  setCustomModelsOnly: async () => {},
};

const renderNewChat = (provider: LLMProvider = 'claude') => render(
  <ProviderSelectionEmptyState
    selectedSession={null}
    currentSessionId={null}
    provider={provider}
    setProvider={() => {}}
    textareaRef={createRef<HTMLTextAreaElement>()}
    providerModels={PROVIDER_MODELS}
    setProviderModel={() => {}}
    providerModelCatalog={{}}
    providerModelActions={MODEL_ACTIONS}
    providerModelsLoading={false}
    tasksEnabled={false}
    isTaskMasterInstalled={null}
    setInput={() => {}}
  />,
);

beforeEach(() => {
  fixedProviderState = { fixedProvider: null, resolved: false };
});

test('without a lock the agent picker card renders with its logo, as before', () => {
  fixedProviderState = { fixedProvider: null, resolved: true };

  renderNewChat('claude');

  assert.ok(screen.getByText('Choose Your AI Assistant'));
  assert.ok(screen.getByText('Click to change model'));
  assert.ok(screen.getByRole('img', { name: 'Claude' }));
  assert.ok(screen.getByText('Claude'));
});

test('while /health has not answered only a neutral heading renders, never the picker or its copy', () => {
  renderNewChat('claude');

  assert.ok(screen.getByText('Start a new conversation'));
  assert.equal(screen.queryByText('Choose Your AI Assistant'), null, 'the choose-an-agent copy would flash on a locked instance');
  assert.equal(screen.queryByText('Select a provider to start a new conversation'), null);
  assert.equal(screen.queryByText('Click to change model'), null);
  assert.equal(screen.queryByRole('img', { name: 'Claude' }), null);
});

test('with a fixed agent the picker, its logo and the ready line are gone', () => {
  fixedProviderState = { fixedProvider: 'claude', resolved: true };

  renderNewChat('claude');

  assert.ok(screen.getByText('Start a new conversation'));
  assert.ok(screen.getByText('Type your message below to begin'));
  assert.equal(screen.queryByText('Choose Your AI Assistant'), null);
  assert.equal(screen.queryByText('Click to change model'), null);
  assert.equal(screen.queryByRole('img', { name: 'Claude' }), null);
  assert.equal(screen.queryByText(/opus/), null, 'the "Ready with … opus" line names the agent');
});
