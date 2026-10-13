import { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../services/apiClient';
import {
  createSimulationImageLoader, loadCharacterSkillOptions, loadCharacterOptions, loadCharacterLevelOptions, loadEquipmentOptions,
  type SimulationImageLoader
} from './simulationSelectionOptions';

type OptionList<T> = { scope: object | null; items: T[]; loading: boolean; error: string | null; notice: string | null };
const emptyList = { items: [], loading: false, error: null, notice: null };

function useOptionList<T>(scope: object | null, load: (signal: AbortSignal) => Promise<{ items: T[]; notice?: string | null }>) {
  const [state, setState] = useState<OptionList<T>>({ scope: null, ...emptyList });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    setState({ scope, ...emptyList, loading: true });
    void load(controller.signal).then(({ items, notice = null }) => {
      if (!controller.signal.aborted) setState({ scope, items, loading: false, error: null, notice });
    }, error => {
      if (!controller.signal.aborted) setState({ scope, items: [], loading: false, error: getErrorMessage(error), notice: null });
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
  const loadCharacters = useCallback(async (signal: AbortSignal) => ({ items: context
    ? await loadCharacterOptions(context, signal) : [] }), [context]);
  const characters = useOptionList(context, loadCharacters);
  const loadEquipment = useCallback(async (signal: AbortSignal) => ({ items: context
    ? await loadEquipmentOptions(context, signal) : [] }), [context]);
  const equipment = useOptionList(context, loadEquipment);
  const loadLevels = useCallback(async (signal: AbortSignal) => ({ items: context
    ? await loadCharacterLevelOptions(context, signal) : [] }), [context]);
  const levels = useOptionList(context, loadLevels);
  const skillScope = useMemo(() => context && characters.items.some(row => row.key === sourceKey)
    ? { context, sourceKey } : null, [context, characters.items, sourceKey]);
  const loadSkills = useCallback((signal: AbortSignal) => skillScope
    ? loadCharacterSkillOptions(skillScope.context, skillScope.sourceKey, signal) : Promise.resolve({ items: [], notice: null }), [skillScope]);
  const boundSkills = useOptionList(skillScope, loadSkills);
  const skills = { ...boundSkills, items: boundSkills.items.filter(option => option.basicAttack) };
  const activeSkills = { ...boundSkills, items: boundSkills.items.filter(option => !option.basicAttack), notice: null };
  const [images, setImages] = useState<{ scope: object; load: SimulationImageLoader } | null>(null);
  useEffect(() => {
    if (!context) return;
    const controller = new AbortController();
    setImages({ scope: context, load: createSimulationImageLoader(context, controller.signal) });
    return () => controller.abort();
  }, [context]);
  return { characters, skills, activeSkills, equipment, levels, imageLoader: images?.scope === context ? images.load : null };
}
