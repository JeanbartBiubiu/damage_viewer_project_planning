/**
 * 引擎管理 Hook — useSimulationEngine
 *
 * 懒加载策略：首次 run 时触发 init，缓存到页面卸载。
 * 当 bundle 的 dataHash 变化时自动重新初始化。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MvpEngineClient } from '../engine/client';
import { compileAndInjectBenchmark, type CompileScenarioInput } from '../engine/bundleCompiler';
import type { EngineMeta, EngineRunInput, EngineRunOutput } from '../engine/types';
import type { GameDataBundle } from '../types/api';
import type { EngineStatus } from './types';

type EngineState = {
  client: MvpEngineClient | null;
  initializedHash: string | null;
};

export type UseSimulationEngineReturn = {
  status: EngineStatus;
  errorMessage: string | null;
  /**
   * 确保引擎已就绪。如果尚未 init，会自动编译 bundle 并初始化。
   * 返回 true 表示就绪，false 表示失败。
   */
  ensureReady: (bundle: GameDataBundle, compileInput: CompileScenarioInput) => Promise<boolean>;
  /** 执行一次运行 */
  run: (input: EngineRunInput) => Promise<EngineRunOutput>;
  /** 强制重置引擎 */
  reset: () => void;
};

export function useSimulationEngine(): UseSimulationEngineReturn {
  const [status, setStatus] = useState<EngineStatus>('not-loaded');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const engineRef = useRef<EngineState>({ client: null, initializedHash: null });

  // 页面卸载时清理
  useEffect(() => {
    return () => {
      engineRef.current.client?.dispose();
      engineRef.current = { client: null, initializedHash: null };
    };
  }, []);

  const reset = useCallback(() => {
    engineRef.current.client?.dispose();
    engineRef.current = { client: null, initializedHash: null };
    setStatus('not-loaded');
    setErrorMessage(null);
  }, []);

  const ensureReady = useCallback(
    async (bundle: GameDataBundle, compileInput: CompileScenarioInput): Promise<boolean> => {
      const dataHash = bundle.meta.dataHash;

      // 已用同一 hash 初始化过，直接返回
      if (engineRef.current.client && engineRef.current.initializedHash === dataHash) {
        setStatus('ready');
        return true;
      }

      // hash 变了，先销毁旧实例
      if (engineRef.current.client) {
        engineRef.current.client.dispose();
        engineRef.current = { client: null, initializedHash: null };
      }

      setStatus('loading');
      setErrorMessage(null);

      try {
        // 编译 bundle
        const compiledBundle = compileAndInjectBenchmark(compileInput);

        const meta: EngineMeta = {
          gameId: bundle.meta.gameId,
          versionId: bundle.meta.versionId,
          dataHash,
        };

        const client = new MvpEngineClient();
        await client.init(meta, compiledBundle);

        engineRef.current = { client, initializedHash: dataHash };
        setStatus('ready');
        return true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setErrorMessage(msg);
        setStatus('error');
        return false;
      }
    },
    []
  );

  const run = useCallback(async (input: EngineRunInput): Promise<EngineRunOutput> => {
    const { client } = engineRef.current;
    if (!client) {
      throw new Error('引擎尚未初始化，请先调用 ensureReady');
    }
    return client.run(input);
  }, []);

  return { status, errorMessage, ensureReady, run, reset };
}
