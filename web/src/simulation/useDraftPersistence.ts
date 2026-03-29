/**
 * 草稿持久化 Hook — useDraftPersistence
 *
 * 自动将 SimulationDraft 保存到 localStorage，恢复上次配置。
 * 使用 debounce（500ms）避免频繁写入。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimulationDraft } from './types';

const STORAGE_KEY = 'damage-viewer.simulation.draft';
const DEBOUNCE_MS = 500;

export function getDefaultDraft(): SimulationDraft {
  return {
    scenarioId: 'single-run',
    self: {
      heroId: '',
      level: 6,
      itemIds: [],
      skillLevels: {},
      statOverrides: {},
    },
    enemy: {
      heroId: '',
      level: 6,
      itemIds: [],
      skillLevels: {},
      statOverrides: {},
    },
    action: {
      type: 'basic_attack',
      hitCount: 10,
    },
    maxSeconds: 10,
  };
}

function loadDraftFromStorage(): SimulationDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 基本字段校验
    if (parsed && typeof parsed === 'object' && parsed.scenarioId && parsed.self && parsed.enemy) {
      return parsed as SimulationDraft;
    }
    return null;
  } catch {
    return null;
  }
}

function saveDraftToStorage(draft: SimulationDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch (error) {
    console.warn('保存草稿失败', error);
  }
}

export type UseDraftPersistenceReturn = {
  draft: SimulationDraft;
  updateDraft: (patch: Partial<SimulationDraft>) => void;
  replaceDraft: (next: SimulationDraft) => void;
  resetDraft: () => void;
};

export function useDraftPersistence(): UseDraftPersistenceReturn {
  const [draft, setDraft] = useState<SimulationDraft>(() => {
    return loadDraftFromStorage() ?? getDefaultDraft();
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // debounce 保存
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveDraftToStorage(draft);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [draft]);

  const updateDraft = useCallback((patch: Partial<SimulationDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const replaceDraft = useCallback((next: SimulationDraft) => {
    setDraft(next);
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(getDefaultDraft());
  }, []);

  return { draft, updateDraft, replaceDraft, resetDraft };
}
