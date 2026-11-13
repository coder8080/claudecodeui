import { useEffect, useSyncExternalStore } from 'react';

import { getFixedWorkdir, loadFixedWorkdir, subscribeToFixedWorkdir } from '@/shared/fixedWorkdir';

/**
 * The folder the operator fixed with `CLOUDCLI_FIXED_WORKDIR`, or null when users pick projects.
 *
 * Used by the sidebar module (hides "New project" and "New session" outside the folder), the
 * git-panel module (hides worktree creation) and the project-workspace module (selects the
 * fixed project when nothing is selected).
 */
export function useFixedWorkdir(): string | null {
  // main.tsx already started the request; this covers isolated mounts (tests).
  useEffect(() => {
    void loadFixedWorkdir();
  }, []);
  return useSyncExternalStore(subscribeToFixedWorkdir, getFixedWorkdir, getFixedWorkdir);
}
