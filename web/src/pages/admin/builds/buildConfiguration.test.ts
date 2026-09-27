import { describe, expect, it } from 'vitest';
import type { BuildDefinition, BuildGroup, BuildOption, BuildSystem } from '../../../types/build';
import type { BuildOptionSkillRelation } from '../../../types/skillRelation';
import { cumulativeRankCost, parseBuildConfigurationDocument, validateBuildConfigurations } from './buildConfiguration';

const time = { createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' };

function option(key: string, costs: number[]): BuildOption {
  return { ...time, gameId: 'g', systemKey: 'paths', optionKey: key, name: key, description: null, maxRank: costs.length, rankCosts: costs };
}

function group(key: string, slots: BuildGroup['slots']): BuildGroup {
  return { ...time, gameId: 'g', systemKey: 'paths', groupKey: key, name: key, description: null, sortOrder: 0, slots };
}

function system(mode: BuildSystem['configurationMode'], rules: BuildSystem['selectionRules']): BuildSystem {
  return { ...time, gameId: 'g', systemKey: 'paths', name: '系', description: null, configurationMode: mode, sortOrder: 0, selectionRules: rules };
}

function definition(partial: Partial<BuildDefinition> & Pick<BuildDefinition, 'system' | 'groups' | 'options'>): BuildDefinition {
  return { skillRelations: [], ...partial };
}

const slotDefinition = definition({
  system: system('SLOT_SELECTION', {
    groupRoles: [{
      roleKey: 'primary', name: '主系', groupKeys: ['precision', 'domination'], minimumGroups: 1, maximumGroups: 1,
      minimumSelectedSlots: 1, maximumSelectedSlots: 1, distinctFromRoleKeys: ['secondary'],
      slotRules: [
        { groupKey: 'precision', slotKey: 'keystone', minimumSelections: 1, maximumSelections: 1 },
        { groupKey: 'domination', slotKey: 'keystone', minimumSelections: 1, maximumSelections: 1 }
      ]
    }, {
      roleKey: 'secondary', name: '副系', groupKeys: ['precision', 'domination'], minimumGroups: 0, maximumGroups: 0,
      minimumSelectedSlots: 0, maximumSelectedSlots: 0, distinctFromRoleKeys: [], slotRules: []
    }],
    budget: { budgetKey: 'points', name: '点数', maximumSource: 'FIXED', fixedMaximum: 1 },
    prerequisites: [],
    exclusions: [{ optionKeys: ['press', 'other'], maximumSelected: 1 }]
  }),
  groups: [
    group('precision', [{ slotKey: 'keystone', name: '基石', minimumSelections: 1, maximumSelections: 1, optionKeys: ['press', 'other'] }]),
    group('domination', [{ slotKey: 'keystone', name: '基石', minimumSelections: 1, maximumSelections: 1, optionKeys: ['press'] }])
  ],
  options: [option('press', [1]), option('other', [0])]
});

function selection(groupKey: string, optionKey: string, rank = 1) {
  return { roleKey: 'primary', groupKey, slotKey: 'keystone', optionKey, rank };
}

describe('build configuration validation', () => {
  it('sums every rank cost and treats a missing skill grant as a notice', () => {
    expect(cumulativeRankCost([1, 2, 4], 3)).toBe(7);
    const result = validateBuildConfigurations('g', [slotDefinition], [{
      systemKey: 'paths', groupAssignments: [{ roleKey: 'primary', groupKey: 'precision' }],
      selections: [selection('precision', 'other')], budgets: {}
    }]);
    expect(result.ok).toBe(true);
    expect(result.notices.map(issue => issue.message)).toContain('当前没有可计算授予内容。');
  });

  it('counts the same slot option twice and fails the whole set when any system fails', () => {
    const doubled = validateBuildConfigurations('g', [slotDefinition], [{
      systemKey: 'paths',
      groupAssignments: [{ roleKey: 'primary', groupKey: 'precision' }, { roleKey: 'primary', groupKey: 'domination' }],
      selections: [selection('precision', 'press'), selection('domination', 'press')],
      budgets: {}
    }]);
    expect(doubled.ok).toBe(false);
    expect(doubled.errors.some(issue => issue.path === 'buildConfigurations[0].budgets' && issue.message.includes('累计成本 2'))).toBe(true);
    const second = validateBuildConfigurations('g', [slotDefinition], [
      { systemKey: 'paths', groupAssignments: [{ roleKey: 'primary', groupKey: 'precision' }], selections: [selection('precision', 'other')], budgets: {} },
      { systemKey: 'missing', groupAssignments: [], selections: [], budgets: {} }
    ]);
    expect(second.ok).toBe(false);
    expect(second.errors.some(issue => issue.path === 'buildConfigurations[1].systemKey')).toBe(true);
  });

  it('uses the highest rank for prerequisites and distinct options for exclusions', () => {
    const point = definition({
      system: system('POINT_ALLOCATION', {
        groupRoles: [{
          roleKey: 'pool', name: '池', groupKeys: ['pool'], minimumGroups: 1, maximumGroups: 1,
          minimumSelectedSlots: 0, maximumSelectedSlots: 2, distinctFromRoleKeys: [],
          slotRules: [{ groupKey: 'pool', slotKey: 'slot', minimumSelections: 0, maximumSelections: 2 }]
        }],
        budget: { budgetKey: 'scene', name: '场景', maximumSource: 'SCENARIO_INPUT', fixedMaximum: null },
        prerequisites: [{ optionKey: 'left', minimumRank: 2, requiredOptionKey: 'right', requiredMinimumRank: 1 }],
        exclusions: [{ optionKeys: ['left', 'right'], maximumSelected: 1 }]
      }),
      groups: [group('pool', [{ slotKey: 'slot', name: '位', minimumSelections: 0, maximumSelections: 2, optionKeys: ['left', 'right'] }])],
      options: [option('left', [0, 0]), option('right', [0])]
    });
    const below = validateBuildConfigurations('g', [point], [{
      systemKey: 'paths', groupAssignments: [{ roleKey: 'pool', groupKey: 'pool' }],
      selections: [{ roleKey: 'pool', groupKey: 'pool', slotKey: 'slot', optionKey: 'left', rank: 1 }],
      budgets: { scene: 0 }
    }]);
    expect(below.errors.some(issue => issue.message.includes('至少要达到'))).toBe(false);
    const missing = validateBuildConfigurations('g', [point], [{
      systemKey: 'paths', groupAssignments: [{ roleKey: 'pool', groupKey: 'pool' }],
      selections: [{ roleKey: 'pool', groupKey: 'pool', slotKey: 'slot', optionKey: 'left', rank: 2 }],
      budgets: { scene: 0 }
    }]);
    expect(missing.errors.some(issue => issue.path === 'buildConfigurations[0].selections[0]' && issue.message.includes('right'))).toBe(true);
    const omitted = validateBuildConfigurations('g', [point], [{
      systemKey: 'paths', groupAssignments: [{ roleKey: 'pool', groupKey: 'pool' }], selections: [], budgets: {}
    }]);
    expect(omitted.errors.some(issue => issue.path === 'buildConfigurations[0].budgets.scene')).toBe(true);
    expect(parseBuildConfigurationDocument({ buildConfigurations: [] }).buildConfigurations).toEqual([]);
  });

  it('rejects a disabled activating grant and a repeated fixed budget', () => {
    const granted = definition({
      ...slotDefinition,
      skillRelations: [{
        gameId: 'g', systemKey: 'paths', optionKey: 'other', optionName: 'other', skillKey: 'haste', skillName: '急速',
        skillStatus: 'DISABLED', activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 1, sortOrder: 0
      } satisfies BuildOptionSkillRelation]
    });
    const result = validateBuildConfigurations('g', [granted], [{
      systemKey: 'paths', groupAssignments: [{ roleKey: 'primary', groupKey: 'precision' }],
      selections: [selection('precision', 'other')], budgets: { points: 0 }
    }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some(issue => issue.message === '停用技能的授予不能进入可运行配置。')).toBe(true);
    expect(result.errors.some(issue => issue.message === '固定预算不能在配置中重复提交。')).toBe(true);
  });

  it('rejects unknown document fields and duplicate selection identity inside one configuration', () => {
    expect(() => parseBuildConfigurationDocument({ buildConfigurations: [], extra: true })).toThrow(/不接受此字段/);
    expect(() => parseBuildConfigurationDocument({
      buildConfigurations: [{
        systemKey: 'paths', groupAssignments: [], budgets: {},
        selections: [selection('precision', 'press'), selection('precision', 'press')]
      }]
    })).toThrow(/同一位置不能重复选择/);
  });
});
