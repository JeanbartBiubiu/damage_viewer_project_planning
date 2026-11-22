import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../services/apiClient';
import { getSimulationAvailability } from '../../services/simulationAvailabilityClient';
import type { SimulationAvailabilityResponse } from '../../types/simulationAvailability';
import {
  applySimulationAvailability, createSimulationImageLoader, loadCharacterSkillOptions, loadCharacterOptions, loadCharacterLevelOptions, loadEquipmentOptions,
  type SelectionContext, type SimulationImageLoader
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

type AvailabilityState = {
  scope: SelectionContext | null; loading: boolean; error: string | null; response: SimulationAvailabilityResponse | null;
};

function useSimulationAvailability(scope: SelectionContext | null) {
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const active = useRef<{ scope: SelectionContext; controller: AbortController } | null>(null);
  const [state, setState] = useState<AvailabilityState>({ scope: null, loading: false, error: null, response: null });
  const refresh = useCallback(async (signal?: AbortSignal): Promise<SimulationAvailabilityResponse> => {
    if (!scope || currentScope.current !== scope || !mounted.current) throw new DOMException('计算可用性读取作用域已改变。', 'AbortError');
    signal?.throwIfAborted();
    active.current?.controller.abort();
    const controller = new AbortController();
    const request = { scope, controller };
    const ownsRequest = () => mounted.current && active.current === request && currentScope.current === scope;
    const cancel = () => {
      controller.abort();
      if (!ownsRequest()) return;
      active.current = null;
      setState(previous => previous.scope === scope ? { ...previous, loading: false } : previous);
    };
    active.current = request;
    signal?.addEventListener('abort', cancel, { once: true });
    setState(previous => ({ scope, loading: true, error: null, response: previous.scope === scope ? previous.response : null }));
    try {
      const { data } = await getSimulationAvailability(scope.apiBaseUrl, scope.gameId, controller.signal);
      if (controller.signal.aborted || !ownsRequest()) {
        throw new DOMException('计算可用性读取已取消。', 'AbortError');
      }
      setState({ scope, loading: false, error: null, response: data });
      return data;
    } catch (error) {
      if (!controller.signal.aborted && ownsRequest()) {
        setState({ scope, loading: false, error: getErrorMessage(error), response: null });
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (active.current === request) active.current = null;
    }
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    if (scope) void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
      if (active.current?.scope === scope) active.current.controller.abort();
    };
  }, [scope, refresh]);
  const retry = useCallback(() => { void refresh().catch(() => undefined); }, [refresh]);
  const visible = scope && state.scope === scope ? state : { loading: Boolean(scope), error: null, response: null };
  return { loading: visible.loading, error: visible.error, response: visible.response, retry, refresh };
}

export function useSimulationSelectionOptions(apiBaseUrl: string, gameId: string | null, sourceKey: string,
  combatMode = false, targetKey = '') {
  const context = useMemo(() => gameId ? { apiBaseUrl, gameId } : null, [apiBaseUrl, gameId]);
  const loadCharacters = useCallback(async (signal: AbortSignal) => ({ items: context
    ? await loadCharacterOptions(context, signal) : [] }), [context]);
  const characters = useOptionList(context, loadCharacters);
  const availability = useSimulationAvailability(combatMode ? context : null);
  const loadEquipment = useCallback(async (signal: AbortSignal) => ({ items: context
    ? await loadEquipmentOptions(context, signal) : [] }), [context]);
  const equipment = useOptionList(context, loadEquipment);
  const loadLevels = useCallback(async (signal: AbortSignal) => ({ items: context
    ? await loadCharacterLevelOptions(context, signal) : [] }), [context]);
  const levels = useOptionList(context, loadLevels);
  const skillScope = useMemo(() => context && characters.items.some(row => row.key === sourceKey)
    ? { context, sourceKey, combatMode } : null, [context, characters.items, sourceKey, combatMode]);
  const loadSkills = useCallback((signal: AbortSignal) => skillScope
    ? loadCharacterSkillOptions(skillScope.context, skillScope.sourceKey, signal, skillScope.combatMode) : Promise.resolve({ items: [], notice: null }), [skillScope]);
  const boundSkills = useOptionList(skillScope, loadSkills);
  const skills = { ...boundSkills, items: boundSkills.items.filter(option => option.basicAttack) };
  const activeSkills = { ...boundSkills, items: boundSkills.items.filter(option => combatMode ? option.combat?.kind === 'active' : !option.basicAttack), notice: null };
  const targetSkillScope = useMemo(() => context && combatMode && characters.items.some(row => row.key === targetKey)
    ? { context, targetKey } : null, [context, characters.items, targetKey, combatMode]);
  const loadTargetBoundSkills = useCallback((signal: AbortSignal) => targetSkillScope
    ? loadCharacterSkillOptions(targetSkillScope.context, targetSkillScope.targetKey, signal, true)
    : Promise.resolve({ items: [], notice: null }), [targetSkillScope]);
  const targetBoundSkills = useOptionList(targetSkillScope, loadTargetBoundSkills);
  const [images, setImages] = useState<{ scope: object; load: SimulationImageLoader } | null>(null);
  useEffect(() => {
    if (!context) return;
    const controller = new AbortController();
    setImages({ scope: context, load: createSimulationImageLoader(context, controller.signal) });
    return () => controller.abort();
  }, [context]);
  const unavailableReason = availability.loading ? '正在核对完整计算证明…' : availability.error ? '计算可用性目录读取失败，请重试。' : undefined;
  const characterItems = useMemo(() => combatMode
    ? applySimulationAvailability(characters.items, availability.response, unavailableReason) : characters.items,
  [combatMode, characters.items, availability.response, unavailableReason]);
  const equipmentItems = useMemo(() => combatMode
    ? applySimulationAvailability(equipment.items, availability.response, unavailableReason) : equipment.items,
  [combatMode, equipment.items, availability.response, unavailableReason]);
  return { characters: { ...characters, items: characterItems }, skills, activeSkills, boundSkills, targetBoundSkills,
    equipment: { ...equipment, items: equipmentItems }, levels, availability, imageLoader: images?.scope === context ? images.load : null };
}
