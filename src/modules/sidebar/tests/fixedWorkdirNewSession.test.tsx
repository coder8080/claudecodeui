import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { afterEach, test, vi } from 'vitest';

import type { Project, SidebarProjectListProps } from '@/shared/types';

/**
 * Under CLOUDCLI_FIXED_WORKDIR the server refuses a new session anywhere but
 * the fixed folder, so the sidebar offers "New session" only on that project.
 * Other projects stay listed and expandable; their sessions can be continued.
 */

let lockedFolder: string | null = null;

vi.mock('@/shared/hooks/useFixedWorkdir', () => ({
  useFixedWorkdir: () => lockedFolder,
}));

vi.mock('@/shared/hooks/useProviderCapabilities', () => ({
  useSessionForkingProviders: () => new Set(),
}));

vi.mock('@/modules/sidebar/SessionOptions', () => ({ default: () => null }));

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => false,
}));

const { default: SidebarProjectSessions } = await import('@/modules/sidebar/SidebarProjectSessions');

const noop = () => {};
const NO_IDS: ReadonlySet<string> = new Set<string>();
const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];

const renderProject = (fullPath: string) => {
  const project = { projectId: 'p', displayName: 'p', fullPath, sessions: [] } as unknown as Project;
  return render(
    React.createElement(SidebarProjectSessions, {
      project,
      isExpanded: true,
      sessions: [],
      selectedSession: null,
      initialSessionsLoaded: true,
      hasMoreSessions: false,
      isLoadingMoreSessions: false,
      activeSessions: NO_IDS,
      backgroundSessionIds: NO_IDS,
      attentionSessionIds: NO_IDS,
      currentTime: new Date('2026-11-13T10:00:00.000Z'),
      sessionRenameId: null,
      sessionRenameDraft: '',
      onRenameDraftChange: noop,
      onStartEditingSession: noop,
      onCancelEditingSession: noop,
      onSaveEditingSession: noop,
      onProjectSelect: noop,
      onSessionSelect: noop,
      onArchiveSession: noop,
      onDeleteSession: noop,
      onLoadMoreSessions: noop,
      onNewSession: noop,
      selectedSessionIds: null,
      onSetSessionSelection: noop,
      onToggleSessionSelected: noop,
      onCancelSessionSelection: noop,
      onDeleteSelectedSessions: noop,
      t,
    }),
  );
};

const hasNewSessionButton = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'sessions.newSession');

afterEach(() => {
  lockedFolder = null;
});

test('without a lock every project offers a new session', () => {
  const { container } = renderProject('/repo');
  assert.equal(hasNewSessionButton(container), true);
});

test('with a lock only the fixed project offers a new session', () => {
  lockedFolder = '/home/u/work';

  const fixed = renderProject('/home/u/work');
  assert.equal(hasNewSessionButton(fixed.container), true);
  fixed.unmount();

  const other = renderProject('/repo');
  assert.equal(hasNewSessionButton(other.container), false);
});
