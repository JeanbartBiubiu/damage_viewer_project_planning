import { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../services/apiClient';
import {
  createSimulationImageLoader, loadBasicAttackOptions, loadCharacterOptions, loadCharacterLevelOptions, loadEquipmentOptions,
  type SimulationImageLoader
} from './simulationSelectionOptions';

type OptionList<T> = { scope: object | null; items: T[]; loading: boolean; error: string | null };
const emptyList = { items: [], loading: false, error: null };

function useOptionList<T>(scope: object | null, load: (signal: AbortSignal) => Promise<T[]>) {
  const [state, setState] = useState<OptionList<T>>({ scope: null, ...emptyList });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    setState({ scope, items: [], loading: true, error: null });
    void load(controller.signal).then(items => {
      if (!controller.signal.aborted) setState({ scope, items, loading: false, error: null });
    }, error => {
      if (!controller.signal.aborted) setState({ scope, items: [], loading: false, error: getErrorMessage(error) });
    });
    return () => controller.abort();
  }, [scope, load, revision]);
  const visible: OptionList<T> = state.scope === scope ? state : { scope, ...emptyList, loading: Boolean(scope) };
  return {
    ...visible,
    retry: () => setRevision(value => value + 1)
  };
}

export function useSimulationSelectionOptions(apiBaseUrl: string, gameId: string | null, token: string, sourceKey: string) {
  const context = useMemo(() => gameId && token ? { apiBaseUrl, gameId, token } : null, [apiBaseUrl, gameId, token]);
  const loadCharacters = useCallback((signal: AbortSignal) => context
    ? loadCharacterOptions(context, signal) : Promise.resolve([]), [context]);
  const characters = useOptionList(context, loadCharacters);
  const loadEquipment = useCallback((signal: AbortSignal) => context
    ? loadEquipmentOptions(context, signal) : Promise.resolve([]), [context]);
  const equipment = useOptionList(context, loadEquipment);
  const loadLevels = useCallback((signal: AbortSignal) => context
    ? loadCharacterLevelOptions(context, signal) : Promise.resolve([]), [context]);
  const levels = useOptionList(context, loadLevels);
  const skillScope = useMemo(() => context && characters.items.some(row => row.key === sourceKey)
    ? { context, sourceKey } : null, [context, characters.items, sourceKey]);
  const loadSkills = useCallback((signal: AbortSignal) => skillScope
    ? loadBasicAttackOptions(skillScope.context, skillScope.sourceKey, signal) : Promise.resolve([]), [skillScope]);
  const skills = useOptionList(skillScope, loadSkills);
  const [images, setImages] = useState<{ scope: object; load: SimulationImageLoader } | null>(null);
  useEffect(() => {
    if (!context) return;
    const controller = new AbortController();
    setImages({ scope: context, load: createSimulationImageLoader(context, controller.signal) });
    return () => controller.abort();
  }, [context]);
  return { characters, skills, equipment, levels, imageLoader: images?.scope === context ? images.load : null };
}
