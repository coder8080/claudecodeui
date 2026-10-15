import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, test, vi } from 'vitest';

import { readSelectedProvider, writeSelectedProvider } from '@/shared/selectedProvider';
import { subscribeToUserPreferences, writeUserPreference, resetUserPreferences } from '@/shared/userSettings';

/**
 * The provider selection was read in six places by four different hand-rolled
 * readers, only one of which validated the stored value, and written from three
 * modules with no same-tab notification — so the git panel's reader was stale
 * for the whole session after a switch.
 */

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

test('an unset provider falls back to claude', () => {
  assert.equal(readSelectedProvider(), 'claude');
});

test('a stored provider is read back', () => {
  writeSelectedProvider('codex');
  assert.equal(readSelectedProvider(), 'codex');
});

test('a value that is not a known provider falls back instead of being trusted', () => {
  // Only one of the previous readers validated; the rest returned this verbatim.
  writeUserPreference('selectedProvider', 'not-a-provider');
  assert.equal(readSelectedProvider(), 'claude');
});

test('a write publishes a same-tab change, which the storage event does not', () => {
  // The whole reason this module exists: the git panel listened only for the
  // cross-tab `storage` event and so never saw a switch made in its own tab.
  // The preference store notifies its subscribers synchronously, in the writing
  // tab too, which is what replaced the hand-rolled event.
  let changes = 0;
  const unsubscribe = subscribeToUserPreferences(() => {
    changes += 1;
  });

  writeSelectedProvider('cursor');

  unsubscribe();
  assert.equal(changes, 1);
});

test('a change to an unrelated preference does not read as a provider switch', () => {
  // The cross-tab `storage` listener this replaced had to filter by key, or a
  // theme toggle in another tab looked like a provider switch. The preference
  // store notifies on any change, so the guarantee moved to the reader: it must
  // still report the provider that is actually stored.
  writeSelectedProvider('codex');

  let observed: string | null = null;
  const unsubscribe = subscribeToUserPreferences(() => {
    observed = readSelectedProvider();
  });
  writeUserPreference('theme', 'dark');
  unsubscribe();

  assert.equal(observed, 'codex');
});

/**
 * The operator agent lock (CLOUDCLI_FIXED_AGENT) arrives over GET /health and
 * overrides the stored choice. The store is a module-level singleton that loads
 * once per page, so each case imports a fresh copy of it (and of the preference
 * store it reads through).
 */
describe('operator agent lock', () => {
  type HealthReply = { kind: 'json'; body: unknown } | { kind: 'reject' } | { kind: 'hang' };

  const loadFreshModules = async (health: HealthReply) => {
    const healthCalls: Array<AbortSignal | undefined> = [];
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => {
      if (String(input) !== '/health') {
        // Debounced preference writes; irrelevant to these cases.
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      healthCalls.push(init?.signal ?? undefined);
      if (health.kind === 'reject') return Promise.reject(new Error('health unreachable'));
      if (health.kind === 'hang') {
        // A proxy holding the connection open: only the abort signal ends it.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(health.body) });
    }));

    vi.resetModules();
    const selected = await import('@/shared/selectedProvider');
    const settings = await import('@/shared/userSettings');
    settings.resetUserPreferences();
    return { selected, settings, healthCalls };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('a fixed agent overrides the stored choice once /health answers', async () => {
    const { selected, settings } = await loadFreshModules({ kind: 'json', body: { fixedAgent: 'codex' } });
    settings.writeUserPreference('selectedProvider', 'cursor');

    assert.equal(selected.readSelectedProvider(), 'cursor', 'before /health answers the stored choice stands');
    await selected.loadFixedProvider();

    assert.equal(selected.getFixedProvider(), 'codex');
    assert.equal(selected.isFixedProviderResolved(), true);
    assert.equal(selected.readSelectedProvider(), 'codex');
  });

  test('without a lock the stored choice is read back unchanged', async () => {
    // Regression contract for the default (unlocked) mode.
    const { selected, settings } = await loadFreshModules({ kind: 'json', body: { status: 'ok', fixedAgent: null } });
    settings.writeUserPreference('selectedProvider', 'codex');

    await selected.loadFixedProvider();

    assert.equal(selected.getFixedProvider(), null);
    assert.equal(selected.isFixedProviderResolved(), true);
    assert.equal(selected.readSelectedProvider(), 'codex');
  });

  test('an older server without the field, or an unknown agent, means not fixed', async () => {
    for (const body of [{ status: 'ok' }, { fixedAgent: 'gemini' }]) {
      const { selected } = await loadFreshModules({ kind: 'json', body });
      await selected.loadFixedProvider();
      assert.equal(selected.getFixedProvider(), null, JSON.stringify(body));
      assert.equal(selected.isFixedProviderResolved(), true, JSON.stringify(body));
    }
  });

  test('an unreachable /health fails open to the picker', async () => {
    const { selected } = await loadFreshModules({ kind: 'reject' });

    await selected.loadFixedProvider();

    assert.equal(selected.getFixedProvider(), null);
    assert.equal(selected.isFixedProviderResolved(), true);
  });

  test('a /health held open past the timeout fails open instead of hiding the picker forever', async () => {
    // AbortSignal.timeout runs on the runtime's internal timers, which fake
    // timers cannot advance, so hand out a signal the test aborts itself and
    // check the budget the store asked for.
    const timeoutController = new AbortController();
    const requestedTimeouts: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds: number) => {
      requestedTimeouts.push(milliseconds);
      return timeoutController.signal;
    });
    const { selected } = await loadFreshModules({ kind: 'hang' });
    const { HEALTH_REQUEST_TIMEOUT_MS } = await import('@/shared/constants');

    const loading = selected.loadFixedProvider();
    await Promise.resolve();
    assert.equal(selected.isFixedProviderResolved(), false);

    timeoutController.abort(new DOMException('timed out', 'TimeoutError'));
    await loading;

    assert.deepEqual(requestedTimeouts, [HEALTH_REQUEST_TIMEOUT_MS]);
    assert.equal(selected.getFixedProvider(), null);
    assert.equal(selected.isFixedProviderResolved(), true);
  });

  test('the lock is fetched once however many readers ask for it', async () => {
    const { selected, healthCalls } = await loadFreshModules({ kind: 'json', body: { fixedAgent: 'opencode' } });

    await Promise.all([selected.loadFixedProvider(), selected.loadFixedProvider(), selected.loadFixedProvider()]);

    assert.equal(healthCalls.length, 1);
  });

  test('subscribers hear the lock land', async () => {
    const { selected } = await loadFreshModules({ kind: 'json', body: { fixedAgent: 'cursor' } });
    let notifications = 0;
    const unsubscribe = selected.subscribeToFixedProvider(() => {
      notifications += 1;
    });

    await selected.loadFixedProvider();
    unsubscribe();

    assert.equal(notifications, 1);
  });
});
