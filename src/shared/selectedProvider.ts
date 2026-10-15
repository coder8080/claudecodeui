import { api } from '@/shared/api';
import { HEALTH_REQUEST_TIMEOUT_MS } from '@/shared/constants';
import type { LLMProvider } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * The provider the user last chose, shared by chat, the shell, the git panel and
 * the project workspace.
 *
 * It was read from localStorage in six places with four different hand-rolled
 * readers — only one of which validated the stored string — and written from
 * three modules. Nothing published a same-tab change, so the git panel's reader
 * (which listens only for the cross-tab `storage` event) never saw a switch made
 * in its own tab.
 *
 * The value now lives in `auth.db` through the preference store, which notifies
 * its subscribers synchronously — including in the tab that wrote — so the
 * choice both reaches every reader at once and follows the user between devices.
 *
 * An operator can pin the agent with `CLOUDCLI_FIXED_AGENT`. The server
 * publishes it on `/health`; once that answers, `readSelectedProvider()` returns
 * it ahead of the stored choice. Callers that read at action time follow the
 * lock automatically; anything that caches the value (React state) must also
 * subscribe with `subscribeToFixedProvider`, as `useSelectedProvider` and chat's
 * `useChatProviderState` do.
 */

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const DEFAULT_PROVIDER: LLMProvider = 'claude';

// Primitives on purpose: useSyncExternalStore re-renders on any snapshot change,
// and most readers only care about the agent, not whether /health has answered.
let fixedProvider: LLMProvider | null = null;
let fixedProviderResolved = false;
let fixedProviderRequest: Promise<void> | null = null;
const fixedProviderListeners = new Set<() => void>();

export function readSelectedProvider(): LLMProvider {
  if (fixedProvider) {
    return fixedProvider;
  }
  const stored = readUserPreference<string | null>('selectedProvider', null);
  return PROVIDERS.includes(stored as LLMProvider) ? (stored as LLMProvider) : DEFAULT_PROVIDER;
}

export function writeSelectedProvider(provider: LLMProvider): void {
  writeUserPreference('selectedProvider', provider);
}

/**
 * Fetches the operator's agent lock from `/health` once per page load; later
 * calls return the same request. Started from main.tsx before the first render
 * so the answer is usually in before the user can send; chat's new-chat submit
 * awaits it in case it is not.
 *
 * Fails open: an error, an unknown agent name or a `/health` a proxy holds open
 * past the timeout all resolve as "not fixed", which keeps today's agent picker.
 */
export function loadFixedProvider(): Promise<void> {
  fixedProviderRequest ??= (async () => {
    try {
      const response = await api.health(AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS));
      const data = (await response.json()) as { fixedAgent?: unknown };
      if (PROVIDERS.includes(data.fixedAgent as LLMProvider)) {
        fixedProvider = data.fixedAgent as LLMProvider;
      }
    } catch (error) {
      // Not fixed: see the fail-open note above. Logged so an operator can tell
      // why a locked instance is showing the agent picker.
      console.warn('[selectedProvider] Could not read the agent lock from /health; users keep choosing the agent.', error);
    }

    fixedProviderResolved = true;
    fixedProviderListeners.forEach((listener) => listener());
  })();
  return fixedProviderRequest;
}

/** The operator-fixed agent, or null when users choose (or /health has not answered yet). */
export function getFixedProvider(): LLMProvider | null {
  return fixedProvider;
}

/** True once /health has answered, failed or timed out. */
export function isFixedProviderResolved(): boolean {
  return fixedProviderResolved;
}

export function subscribeToFixedProvider(listener: () => void): () => void {
  fixedProviderListeners.add(listener);
  return () => {
    fixedProviderListeners.delete(listener);
  };
}
