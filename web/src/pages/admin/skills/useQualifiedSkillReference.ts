import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { getSkillEffect } from '../../../services/skillEffectClient';
import { getSkillInternalState } from '../../../services/skillInternalStateClient';
import type { SkillEffect } from '../../../types/skillEffect';
import type { SkillInternalState } from '../../../types/skillInternalState';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function matchingOwnedReference<T extends { skillKey: string }>(
  items: readonly T[], ownerSkillKey: string, key: string, field: keyof T
): T | null {
  return items.find((item) => item.skillKey === ownerSkillKey && item[field] === key) ?? null;
}

type Options<T> = {
  visible: boolean;
  apiBaseUrl: string;
  gameId: string;
  adminToken: string;
  currentSkillKey: string;
  ownerSkillKey: string;
  objectKey: string;
  local: readonly T[];
  keyField: keyof T;
  load: (apiBaseUrl: string, gameId: string, ownerSkillKey: string, objectKey: string,
    token: string) => Promise<{ data: T }>;
};

function useQualifiedReference<T extends { skillKey: string }>(options: Options<T>) {
  const [loaded, setLoaded] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const serial = useRef(0);
  const owner = options.ownerSkillKey.trim();
  const key = options.objectKey.trim();
  const external = Boolean(owner && owner !== options.currentSkillKey);
  const local = !external ? matchingOwnedReference(options.local, options.currentSkillKey,
    key, options.keyField) : null;
  const externalValue = loaded && loaded.skillKey === owner && loaded[options.keyField] === key
    ? loaded : null;

  useEffect(() => {
    const request = ++serial.current;
    if (!options.visible || !external || !key) {
      setLoaded(null);
      setState('idle');
      setError(null);
      return;
    }
    if (!options.adminToken.trim()) {
      setLoaded(null);
      setState('error');
      setError('请先配置管理令牌。');
      return;
    }
    setLoaded(null);
    setState('loading');
    setError(null);
    void options.load(options.apiBaseUrl, options.gameId, owner, key, options.adminToken.trim())
      .then((result) => {
        if (serial.current !== request) return;
        setLoaded(result.data);
        setState('ready');
      })
      .catch((reason) => {
        if (serial.current !== request) return;
        setState('error');
        setError(getErrorMessage(reason));
      });
    return () => { serial.current += 1; };
  }, [options.visible, options.apiBaseUrl, options.gameId, options.adminToken,
    options.load, external, owner, key, retryRevision]);

  return { value: external ? externalValue : local,
    state: external ? state : local ? 'ready' as const : 'idle' as const,
    error, external, retry: () => setRetryRevision((value) => value + 1) };
}

export function useQualifiedSkillState(options: Omit<Options<SkillInternalState>, 'keyField' | 'load'>) {
  return useQualifiedReference({ ...options, keyField: 'stateKey', load: getSkillInternalState });
}

export function useQualifiedSkillEffect(options: Omit<Options<SkillEffect>, 'keyField' | 'load'>) {
  return useQualifiedReference({ ...options, keyField: 'effectKey', load: getSkillEffect });
}
