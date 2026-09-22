import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import { getGameVampRules } from '../../../../services/gameVampClient';
import type { GameVampRule } from '../../../../types/gameVamp';

export function useGameVampRules(apiBaseUrl: string, gameId: string, adminToken: string, enabled: boolean) {
  const token = adminToken.trim();
  const context = useMemo(() => ({ apiBaseUrl, gameId, token, enabled }), [apiBaseUrl, gameId, token, enabled]);
  const current = useRef(context);
  current.current = context;
  const serial = useRef(0);
  const [loaded, setLoaded] = useState<typeof context | null>(null);
  const [rules, setRules] = useState<GameVampRule[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const ticket = ++serial.current;
    setLoaded(null); setRules([]); setState('loading'); setError(null);
    if (!context.enabled || !context.token) return;
    try {
      const result = await getGameVampRules(context.apiBaseUrl, context.gameId, context.token);
      if (serial.current !== ticket || current.current !== context) return;
      setRules(result.data.rules); setState('ready'); setLoaded(context);
    } catch (e) {
      if (serial.current !== ticket || current.current !== context) return;
      setState('failed'); setError(getErrorMessage(e)); setLoaded(context);
    }
  }, [context]);
  useEffect(() => { void reload(); return () => { serial.current += 1; }; }, [reload]);
  return { rules: loaded === context ? rules : [], state: loaded === context ? state : 'loading' as const,
    error: loaded === context ? error : null, reload };
}
