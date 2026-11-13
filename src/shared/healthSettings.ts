import { api } from '@/shared/api';
import { HEALTH_REQUEST_TIMEOUT_MS } from '@/shared/constants';

let healthSettingsRequest: Promise<Record<string, unknown>> | null = null;

/**
 * The operator settings the server publishes on the public `GET /health`
 * (`fixedAgent`, `fixedWorkdir`, ...), fetched once per page load and shared by
 * every reader so the locks cost a single request.
 *
 * Used by `selectedProvider` (the agent lock) and `fixedWorkdir` (the working
 * folder lock). Rejects on a network error, a non-object body or a `/health`
 * a proxy holds open past the timeout; each reader decides how to fail open.
 */
export function loadHealthSettings(): Promise<Record<string, unknown>> {
  healthSettingsRequest ??= (async () => {
    const response = await api.health(AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS));
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== 'object') {
      throw new Error('/health did not answer with an object');
    }
    return data as Record<string, unknown>;
  })();
  return healthSettingsRequest;
}
