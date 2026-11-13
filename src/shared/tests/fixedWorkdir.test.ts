import assert from 'node:assert/strict';

import { afterEach, describe, test, vi } from 'vitest';

import { isNewSessionAllowedIn } from '@/shared/fixedWorkdir';

/**
 * The working-folder lock (CLOUDCLI_FIXED_WORKDIR) arrives over GET /health,
 * the same request that carries the agent lock. Both stores are module-level
 * singletons, so each case imports fresh copies.
 */
describe('working folder lock', () => {
  const loadFreshModules = async (health: { kind: 'json'; body: unknown } | { kind: 'reject' }) => {
    let healthCalls = 0;
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      if (String(input) !== '/health') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      healthCalls += 1;
      if (health.kind === 'reject') return Promise.reject(new Error('health unreachable'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(health.body) });
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.resetModules();
    const workdir = await import('@/shared/fixedWorkdir');
    const selected = await import('@/shared/selectedProvider');
    return { workdir, selected, getHealthCalls: () => healthCalls };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('the folder published on /health becomes the lock and subscribers hear it', async () => {
    const { workdir } = await loadFreshModules({ kind: 'json', body: { fixedWorkdir: '/home/u/work' } });
    let notifications = 0;
    const unsubscribe = workdir.subscribeToFixedWorkdir(() => {
      notifications += 1;
    });

    assert.equal(workdir.getFixedWorkdir(), null);
    await workdir.loadFixedWorkdir();
    unsubscribe();

    assert.equal(workdir.getFixedWorkdir(), '/home/u/work');
    assert.equal(notifications, 1);
  });

  test('an older server, an empty value or an unreachable /health means no lock', async () => {
    for (const health of [
      { kind: 'json' as const, body: { status: 'ok' } },
      { kind: 'json' as const, body: { fixedWorkdir: '' } },
      { kind: 'json' as const, body: { fixedWorkdir: null } },
      { kind: 'reject' as const },
    ]) {
      const { workdir } = await loadFreshModules(health);
      await workdir.loadFixedWorkdir();
      assert.equal(workdir.getFixedWorkdir(), null);
    }
  });

  test('the agent lock and the folder lock share one /health request', async () => {
    const { workdir, selected, getHealthCalls } = await loadFreshModules({
      kind: 'json',
      body: { fixedAgent: 'codex', fixedWorkdir: '/home/u/work' },
    });

    await Promise.all([workdir.loadFixedWorkdir(), selected.loadFixedProvider(), workdir.loadFixedWorkdir()]);

    assert.equal(getHealthCalls(), 1);
    assert.equal(selected.getFixedProvider(), 'codex');
    assert.equal(workdir.getFixedWorkdir(), '/home/u/work');
  });
});

test('new sessions are allowed anywhere without a lock and only in the fixed folder with one', () => {
  assert.equal(isNewSessionAllowedIn('/anywhere', null), true);
  assert.equal(isNewSessionAllowedIn('/home/u/work', '/home/u/work'), true);
  assert.equal(isNewSessionAllowedIn('/home/u/work/', '/home/u/work'), true);
  assert.equal(isNewSessionAllowedIn('/home/u/work/sub', '/home/u/work'), false);
  assert.equal(isNewSessionAllowedIn('/home/u', '/home/u/work'), false);
  assert.equal(isNewSessionAllowedIn(undefined, '/home/u/work'), false);
});
