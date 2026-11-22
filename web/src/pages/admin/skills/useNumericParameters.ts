import { useEffect, useState } from 'react';
import { listSkillParameters } from '../../../services/maintenance/skillParameterClient';
import type { SkillParameter } from '../../../types/skillParameter';

export function useNumericParameters(apiBaseUrl: string, gameId: string, skillKey: string, visible: boolean, revision = 0) {
  const [parameters, setParameters] = useState<SkillParameter[]>([]);
  const [parametersLoadState, setState] = useState<'ready' | 'failed' | undefined>();
  useEffect(() => {
    let active = true;
    setParameters([]);
    setState(undefined);
    if (visible) void listSkillParameters(apiBaseUrl, gameId, skillKey).then((result) => {
      if (active) { setParameters(result.data); setState('ready'); }
    }).catch(() => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [apiBaseUrl, gameId, skillKey, visible, revision]);
  return { parameters, parametersLoadState };
}
