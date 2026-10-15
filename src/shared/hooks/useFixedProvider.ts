import { useEffect, useSyncExternalStore } from 'react';

import {
  getFixedProvider,
  isFixedProviderResolved,
  loadFixedProvider,
  subscribeToFixedProvider,
} from '@/shared/selectedProvider';
import type { LLMProvider } from '@/shared/types';

// main.tsx already started the request; this only covers renders outside the
// app shell (tests, isolated mounts). The call is idempotent.
const useFixedProviderRequest = () => {
  useEffect(() => {
    void loadFixedProvider();
  }, []);
};

/**
 * The agent the operator fixed with `CLOUDCLI_FIXED_AGENT`, or null when users choose it.
 *
 * Used by the chat module (to hide assistant avatars and the agent picker and to start new chats
 * with the fixed agent), the sidebar module (to hide session provider icons), the
 * project-workspace module (to hide the header provider icon) and shared `useSelectedProvider`
 * (to let the lock override the stored choice).
 */
export function useFixedProvider(): LLMProvider | null {
  useFixedProviderRequest();
  // The same snapshot serves server rendering: the transcript HTML export renders
  // MessageComponent to static markup, and should honor the lock there too.
  return useSyncExternalStore(subscribeToFixedProvider, getFixedProvider, getFixedProvider);
}

/**
 * Whether `/health` has answered about the agent lock yet. Used by the chat module's empty state,
 * which must not show the agent picker before it knows the picker is allowed.
 */
export function useFixedProviderResolved(): boolean {
  useFixedProviderRequest();
  return useSyncExternalStore(subscribeToFixedProvider, isFixedProviderResolved, isFixedProviderResolved);
}
