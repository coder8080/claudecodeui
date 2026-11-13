import { memo } from 'react';

import { useProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { CommandPalette } from '@/modules/command-palette';
import { isNewSessionAllowedIn } from '@/shared/fixedWorkdir';
import { useFixedWorkdir } from '@/shared/hooks/useFixedWorkdir';

/** Rendered by ProjectWorkspaceShell to bind this module's project state to the command-palette module. */
function ProjectCommandPalette() {
  const {
    selectedProject,
    handleNewSession,
    openSettings,
    setActiveTab,
  } = useProjectCommandState();
  // CLOUDCLI_FIXED_WORKDIR: the server refuses new chats outside the fixed folder.
  const canStartNewChat = isNewSessionAllowedIn(selectedProject?.fullPath, useFixedWorkdir());

  return (
    <CommandPalette
      selectedProject={selectedProject}
      onStartNewChat={canStartNewChat ? handleNewSession : undefined}
      onOpenSettings={openSettings}
      onShowTab={setActiveTab}
    />
  );
}

export default memo(ProjectCommandPalette);
