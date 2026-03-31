/**
 * 场景模拟工作台 — 核心类型
 *
 * 定义场景模板、配置草稿、变体规格、运行结果等数据结构，
 * 作为前端场景编排层的基础类型系统。
 */

import type { EngineRunInput, EngineRunOutput } from '../engine/types';
import type { AttributeDefinition, GameDataBundle, Hero, Item, Skill } from '../types/api';

// ═══════════════════════════════════════════════════════════════
// 场景模板
// ═══════════════════════════════════════════════════════════════

/** 场景稳定性标签 */
export type ScenarioStatus = 'stable' | 'experimental' | 'disabled';

/** 场景模板静态定义 */
export type ScenarioTemplate = {
  id: ScenarioId;
  title: string;
  description: string;
  status: ScenarioStatus;
  /** 此场景需要的引擎能力描述 */
  requiredCapabilities: string[];
  /** 结果区使用的视图类型 */
  resultViews: ResultViewKind[];
};

export type ScenarioId =
  | 'single-run'
  | 'item-compare'
  | 'free-experiment'
  | 'growth-curve'
  | 'kill-threshold';

/** 结果展示视图种类 */
export type ResultViewKind =
  | 'summary-cards'
  | 'timeline-chart'
  | 'comparison-chart'
  | 'event-table'
  | 'damage-breakdown'
  | 'input-snapshot';

// ═══════════════════════════════════════════════════════════════
// 配置草稿（SimulationDraft）
// ═══════════════════════════════════════════════════════════════

/** 战斗方配置 */
export type CombatantDraft = {
  heroId: string;
  level: number;
  itemIds: string[];
  skillLevels: Record<string, number>;
  /** 属性覆盖 */
  statOverrides: Record<string, number>;
};

/** 动作模型配置 */
export type ActionDraft = {
  type: 'basic_attack' | 'cast_skill';
  skillId?: string;
  castCount?: number;
  hitCount?: number;
};

/** 用户正在编辑的完整配置草稿 */
export type SimulationDraft = {
  scenarioId: ScenarioId;
  self: CombatantDraft;
  enemy: CombatantDraft;
  action: ActionDraft;
  /** 模拟持续秒数 */
  maxSeconds: number;
  /** 可复现种子 */
  seed?: number;

  // ── 场景特有字段 ──
  /** 装备对比：多个装备变体 */
  itemVariants?: ItemVariant[];
  /** 成长曲线：扫描维度 */
  sweepDimension?: SweepDimension;
  /** 斩杀线：搜索范围 */
  killThresholdRange?: { minHp: number; maxHp: number };
};

/** 装备对比变体 */
export type ItemVariant = {
  key: string;
  label: string;
  itemIds: string[];
};

/** 成长曲线扫描维度 */
export type SweepDimension = {
  axis: 'level' | 'item-count' | 'attribute';
  /** axis=attribute 时指定属性键 */
  attrKey?: string;
  from: number;
  to: number;
  step: number;
};

// ═══════════════════════════════════════════════════════════════
// 变体规格
// ═══════════════════════════════════════════════════════════════

/** 单个运行变体 */
export type VariantSpec = {
  key: string;
  label: string;
  xValue?: number;
  note?: string;
};

// ═══════════════════════════════════════════════════════════════
// 运行结果
// ═══════════════════════════════════════════════════════════════

/** 单个变体运行的输出 */
export type VariantResult = {
  variant: VariantSpec;
  input: EngineRunInput;
  output: EngineRunOutput;
  durationMs: number;
};

/** 整个场景的运行结果 */
export type SimulationResult = {
  scenarioId: ScenarioId;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  variants: VariantResult[];
  /** 运行时的 bundle meta 快照 */
  bundleMeta: {
    gameId: string;
    versionId: number;
    dataHash: string;
  };
};

/** 运行状态机 */
export type RunPhase = 'idle' | 'compiling' | 'running' | 'done' | 'error';

// ═══════════════════════════════════════════════════════════════
// 场景模块接口（Scenario Module）
// ═══════════════════════════════════════════════════════════════

/**
 * 每个场景需要导出一个 ScenarioModule。
 * 场景编排层通过此接口完成：模板展示 → 变体展开 → 输入构建 → 结果解读。
 */
export type ScenarioModule = {
  /** 场景模板定义 */
  template: ScenarioTemplate;

  /**
   * 根据草稿展开变体列表。
   * 单次模拟返回 1 个变体；装备对比返回 N 个；成长曲线返回 sweep 点。
   */
  buildVariants: (draft: SimulationDraft) => VariantSpec[];

  /**
   * 对每个变体构建 EngineRunInput。
   * 接收 bundle 用于查找英雄/装备元数据。
   */
  buildRunInput: (draft: SimulationDraft, variant: VariantSpec, bundle: GameDataBundle) => EngineRunInput;

  /**
   * 从运行结果中提取用于展示的摘要数据。
   */
  interpretResults: (results: VariantResult[]) => InterpretedResult;

  /**
   * 场景特有的配置面板（可选）。
   * 当切换到此场景时，该组件会渲染在通用配置区下方。
   */
  ExtraConfigPanel?: React.ComponentType<ExtraConfigPanelProps>;
};

/** 场景特有配置面板的 props */
export type ExtraConfigPanelProps = {
  draft: SimulationDraft;
  onDraftChange: (patch: Partial<SimulationDraft>) => void;
  bundle: GameDataBundle;
};

/** 结果解读输出 */
export type InterpretedResult = {
  /** 结论卡片数据 */
  summaryCards: SummaryCard[];
  /** 图表数据系列 */
  chartSeries: ChartSeries[];
  /** 对比表行 */
  comparisonRows: ComparisonRow[];
};

export type SummaryCard = {
  label: string;
  value: string | number;
  unit?: string;
  highlight?: 'positive' | 'negative' | 'neutral';
};

export type ChartSeries = {
  name: string;
  data: Array<{ x: number; y: number }>;
  color?: string;
};

export type ComparisonRow = {
  variantKey: string;
  variantLabel: string;
  totalDamage: number;
  dps: number;
  timeToKillMs?: number;
  stopReason: string;
};

// ═══════════════════════════════════════════════════════════════
// 引擎状态
// ═══════════════════════════════════════════════════════════════

export type EngineStatus = 'not-loaded' | 'loading' | 'ready' | 'error';

// ═══════════════════════════════════════════════════════════════
// Bundle 上下文（从 API 数据提取的便捷索引）
// ═══════════════════════════════════════════════════════════════

export type BundleIndex = {
  gameId: string;
  attributeDefinitions: AttributeDefinition[];
  heroes: Map<string, Hero>;
  items: Map<string, Item>;
  skills: Map<string, Skill>;
  heroSkills: Map<string, Skill[]>;
};
