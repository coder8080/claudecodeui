import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '../../../hooks/useVoiceConfig';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend.
const STORAGE_KEY = 'uiPreferences';
const SYNC_EVENT = 'ui-preferences:sync';
/**
 * What `/api/voice/health` reports: whether a backend exists, whether this
 * deployment permits automatic read-aloud, and the host that receives the text.
 */
export type VoiceHealth = {
  configured: boolean;
  autoSpeak: boolean;
  backendHost: string | null;
};

const NO_VOICE_BACKEND: VoiceHealth = { configured: false, autoSpeak: false, backendHost: null };
let healthRequest: Promise<VoiceHealth> | null = null;

function checkVoiceHealth(): Promise<VoiceHealth> {
  if (healthRequest) return healthRequest;
  const request = authenticatedFetch('/api/voice/health')
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      return {
        configured: data?.configured === true,
        // A server without these fields is read as "not permitted", so automatic
        // read-aloud never switches itself on against an older deployment.
        autoSpeak: data?.autoSpeak === true,
        backendHost: typeof data?.backendHost === 'string' ? data.backendHost : null,
      };
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

/**
 * The instance's voice capabilities, or null until the answer arrives. Automatic
 * read-aloud and Settings both need the server's verdict even when the browser
 * is pointed at a backend of its own.
 */
export function useVoiceHealth(): VoiceHealth | null {
  const [health, setHealth] = useState<VoiceHealth | null>(null);

  useEffect(() => {
    let active = true;
    checkVoiceHealth()
      .then((result) => { if (active) setHealth(result); })
      .catch(() => { if (active) setHealth(NO_VOICE_BACKEND); });
    return () => { active = false; };
  }, []);

  return health;
}

function readPreference(key: 'voiceEnabled' | 'voiceAutoSpeak'): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.[key] === true || parsed?.[key] === 'true';
  } catch {
    return false;
  }
}

function readVoiceEnabled(): boolean {
  return readPreference('voiceEnabled');
}

export function useVoiceAvailable(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readVoiceEnabled(),
  );
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const update = () => setEnabled(readVoiceEnabled());
    window.addEventListener('storage', update);
    window.addEventListener(SYNC_EVENT, update as EventListener);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(SYNC_EVENT, update as EventListener);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      if (!enabled) {
        setAvailable(false);
        return;
      }
      if (readVoiceConfig().baseUrl.trim()) {
        setAvailable(true);
        return;
      }
      const id = ++requestId;
      try {
        const result = await checkVoiceHealth();
        if (active && id === requestId) setAvailable(result.configured);
      } catch {
        if (active && id === requestId) setAvailable(false);
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [enabled]);

  return enabled && available;
}

/**
 * Auto read-aloud rides on the same gate as the manual button (voice on and a
 * backend that answers), plus the deployment's permission and its own
 * `voiceAutoSpeak` preference. The server has the last word: a viewer cannot
 * start a continuous stream of answers to the backend where it is not allowed.
 */
export function useVoiceAutoSpeak(): boolean {
  const available = useVoiceAvailable();
  const health = useVoiceHealth();
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readPreference('voiceAutoSpeak'),
  );

  useEffect(() => {
    const update = () => setAutoSpeak(readPreference('voiceAutoSpeak'));
    update();
    window.addEventListener('storage', update);
    window.addEventListener(SYNC_EVENT, update as EventListener);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(SYNC_EVENT, update as EventListener);
    };
  }, []);

  return available && health?.autoSpeak === true && autoSpeak;
}
