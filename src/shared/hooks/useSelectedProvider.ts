import { useEffect, useState } from 'react';

import { useFixedProvider } from '@/shared/hooks/useFixedProvider';
import { readSelectedProvider } from '@/shared/selectedProvider';
import { subscribeToUserPreferences } from '@/shared/userSettings';
import type { LLMProvider } from '@/shared/types';

/** Used by the git-panel module (to attribute a generated commit message to a provider) and the quick-settings-panel module (to list the provider's slash commands). */
export function useSelectedProvider(): LLMProvider {
  // Mirrors the stored selection so the panel re-renders when it changes.
  // Reading storage during render would not, and this value decides which
  // provider a generated commit message is attributed to.
  const [provider, setProvider] = useState(readSelectedProvider);

  // One subscription covers a switch made in this tab and one hydrated from the
  // server, including a switch made on another device: the store notifies
  // synchronously in the writing tab too.
  useEffect(() => subscribeToUserPreferences(() => {
    setProvider(readSelectedProvider());
  }), []);

  // An operator agent lock (CLOUDCLI_FIXED_AGENT) arrives from /health after
  // mount and overrides the stored choice. Read through the external store so
  // a lock that lands between render and subscription is not missed.
  const fixedProvider = useFixedProvider();

  return fixedProvider ?? provider;
}
