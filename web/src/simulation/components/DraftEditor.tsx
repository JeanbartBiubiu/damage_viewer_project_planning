/**
 * DraftEditor — 配置编辑器
 *
 * 按逻辑分块：我方配置、敌方配置、动作配置、场景特有配置。
 * 使用 Arco Design 的 Form/Select/InputNumber 组件。
 */

import { useCallback } from 'react';
import {
  Card,
  Form,
  Grid,
  InputNumber,
  Select,
  Space,
  Typography,
} from '@arco-design/web-react';
import { AttributeKeySelector } from '../../components/AttributeKeySelector';
import type { BundleIndex, CombatantDraft, SimulationDraft } from '../types';
import type { AttributeDefinition, Hero, Item, Skill } from '../../types/api';

const { Row, Col } = Grid;

type DraftEditorProps = {
  draft: SimulationDraft;
  onDraftChange: (patch: Partial<SimulationDraft>) => void;
  bundleIndex: BundleIndex | null;
};

// ═══════════════════════════════════════════════════════════════
// 战斗方面板
// ═══════════════════════════════════════════════════════════════

type CombatantPanelProps = {
  title: string;
  side: 'self' | 'enemy';
  combatant: CombatantDraft;
  onChange: (next: CombatantDraft) => void;
  heroes: Hero[];
  items: Item[];
  skills: Skill[];
};

function CombatantPanel({ title, combatant, onChange, heroes, items, skills }: CombatantPanelProps) {
  const heroOptions = heroes.map((h) => ({
    label: h.name ?? h.heroId,
    value: h.heroId,
  }));

  const itemOptions = items.map((i) => ({
    label: i.name ?? i.itemId,
    value: i.itemId,
  }));

  // 获取当前英雄的技能
  const heroSkills = skills.filter(
    (s) => s.ownerType === 'hero' && s.ownerId === combatant.heroId
  );

  return (
    <Card size="small" title={title} style={{ marginBottom: 12 }}>
      <Form layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="英雄">
              <Select
                showSearch
                placeholder="选择英雄"
                value={combatant.heroId || undefined}
                onChange={(val) => onChange({ ...combatant, heroId: val ?? '' })}
                options={heroOptions}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="等级">
              <InputNumber
                min={1}
                max={18}
                value={combatant.level}
                onChange={(val) => onChange({ ...combatant, level: val ?? 1 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="装备">
          <Select
            mode="multiple"
            placeholder="选择装备"
            value={combatant.itemIds}
            onChange={(val) => onChange({ ...combatant, itemIds: val ?? [] })}
            options={itemOptions}
            allowClear
            maxTagCount={3}
          />
        </Form.Item>

        {heroSkills.length > 0 && (
          <Form.Item label="技能等级">
            <Space size={8} wrap>
              {heroSkills.map((sk) => (
                <Space key={sk.skillId} size={4}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    {sk.skillKey ?? sk.skillId}
                  </Typography.Text>
                  <InputNumber
                    min={0}
                    max={5}
                    size="mini"
                    value={combatant.skillLevels[sk.skillKey ?? sk.skillId] ?? 0}
                    onChange={(val) =>
                      onChange({
                        ...combatant,
                        skillLevels: {
                          ...combatant.skillLevels,
                          [sk.skillKey ?? sk.skillId]: val ?? 0,
                        },
                      })
                    }
                    style={{ width: 56 }}
                  />
                </Space>
              ))}
            </Space>
          </Form.Item>
        )}
      </Form>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// 动作配置面板
// ═══════════════════════════════════════════════════════════════

type ActionPanelProps = {
  draft: SimulationDraft;
  onDraftChange: (patch: Partial<SimulationDraft>) => void;
  heroSkills: Skill[];
};

function ActionPanel({ draft, onDraftChange, heroSkills }: ActionPanelProps) {
  const skillOptions = heroSkills.map((s) => ({
    label: `${s.skillKey ?? '?'} — ${s.name ?? s.skillId}`,
    value: s.skillId,
  }));

  return (
    <Card size="small" title="动作配置" style={{ marginBottom: 12 }}>
      <Form layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="动作类型">
              <Select
                value={draft.action.type}
                onChange={(val) =>
                  onDraftChange({
                    action: { ...draft.action, type: val as 'basic_attack' | 'cast_skill' },
                  })
                }
              >
                <Select.Option value="basic_attack">平A</Select.Option>
                <Select.Option value="cast_skill">施放技能</Select.Option>
              </Select>
            </Form.Item>
          </Col>

          {draft.action.type === 'basic_attack' && (
            <Col span={8}>
              <Form.Item label="平A次数">
                <InputNumber
                  min={1}
                  max={100}
                  value={draft.action.hitCount ?? 10}
                  onChange={(val) =>
                    onDraftChange({ action: { ...draft.action, hitCount: val ?? 10 } })
                  }
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          )}

          {draft.action.type === 'cast_skill' && (
            <>
              <Col span={8}>
                <Form.Item label="技能">
                  <Select
                    placeholder="选择技能"
                    value={draft.action.skillId || undefined}
                    onChange={(val) =>
                      onDraftChange({ action: { ...draft.action, skillId: val } })
                    }
                    options={skillOptions}
                    allowClear
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="施放次数">
                  <InputNumber
                    min={1}
                    max={50}
                    value={draft.action.castCount ?? 1}
                    onChange={(val) =>
                      onDraftChange({ action: { ...draft.action, castCount: val ?? 1 } })
                    }
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </>
          )}

          <Col span={8}>
            <Form.Item label="最大秒数">
              <InputNumber
                min={1}
                max={120}
                value={draft.maxSeconds}
                onChange={(val) => onDraftChange({ maxSeconds: val ?? 10 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="Seed（可选）">
          <InputNumber
            placeholder="留空则随机"
            value={draft.seed}
            onChange={(val) => onDraftChange({ seed: val ?? undefined })}
            style={{ width: 160 }}
          />
        </Form.Item>
      </Form>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// 属性覆盖面板
// ═══════════════════════════════════════════════════════════════

type StatOverridePanelProps = {
  side: 'self' | 'enemy';
  combatant: CombatantDraft;
  onChange: (next: CombatantDraft) => void;
  attributeDefinitions: AttributeDefinition[];
  gameId?: string;
};

function StatOverridePanel({ side, combatant, onChange, attributeDefinitions, gameId }: StatOverridePanelProps) {
  const entries = Object.entries(combatant.statOverrides);
  const label = side === 'self' ? '我方属性覆盖' : '敌方属性覆盖';

  const addEntry = () => {
    const usedKeys = new Set(entries.map(([key]) => key));
    const nextAttrKey = attributeDefinitions.find((definition) => !usedKeys.has(definition.attrKey))?.attrKey ?? `attr_${entries.length + 1}`;
    onChange({
      ...combatant,
      statOverrides: { ...combatant.statOverrides, [nextAttrKey]: 0 },
    });
  };

  const removeEntry = (key: string) => {
    const next = { ...combatant.statOverrides };
    delete next[key];
    onChange({ ...combatant, statOverrides: next });
  };

  const updateKey = (oldKey: string, newKey: string) => {
    const next = { ...combatant.statOverrides };
    const val = next[oldKey] ?? 0;
    delete next[oldKey];
    next[newKey] = val;
    onChange({ ...combatant, statOverrides: next });
  };

  const updateValue = (key: string, val: number) => {
    onChange({
      ...combatant,
      statOverrides: { ...combatant.statOverrides, [key]: val },
    });
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <Space size={4} align="center" style={{ marginBottom: 4 }}>
        <Typography.Text bold style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
        <Typography.Text
          type="primary"
          style={{ fontSize: 12, cursor: 'pointer' }}
          onClick={addEntry}
        >
          + 添加
        </Typography.Text>
      </Space>
      {entries.map(([key, value]) => (
        <Space key={key} size={4} style={{ marginBottom: 2 }}>
          <div style={{ width: 220 }}>
            <AttributeKeySelector
              definitions={attributeDefinitions}
              gameId={gameId ?? null}
              mode="single"
              valueMode="attrKey"
            value={key}
              size="mini"
              onChange={(val) => {
                if (typeof val === 'string' && val.trim()) {
                  updateKey(key, val);
                }
              }}
              excludeAttrKeys={entries.map(([entryKey]) => entryKey).filter((entryKey) => entryKey !== key)}
              placeholder="选择属性"
              showMetaText={false}
            />
          </div>
          <InputNumber
            size="mini"
            value={value}
            onChange={(val) => updateValue(key, val ?? 0)}
            style={{ width: 80 }}
          />
          <Typography.Text
            type="error"
            style={{ fontSize: 12, cursor: 'pointer' }}
            onClick={() => removeEntry(key)}
          >
            ×
          </Typography.Text>
        </Space>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主编辑器
// ═══════════════════════════════════════════════════════════════

export function DraftEditor({ draft, onDraftChange, bundleIndex }: DraftEditorProps) {
  const heroes = bundleIndex ? Array.from(bundleIndex.heroes.values()) : [];
  const items = bundleIndex ? Array.from(bundleIndex.items.values()) : [];
  const attributeDefinitions = bundleIndex?.attributeDefinitions ?? [];
  const gameId = bundleIndex?.gameId;
  const selfSkills = bundleIndex
    ? bundleIndex.heroSkills.get(draft.self.heroId) ?? []
    : [];
  const enemySkills = bundleIndex
    ? bundleIndex.heroSkills.get(draft.enemy.heroId) ?? []
    : [];

  const updateSelf = useCallback(
    (next: CombatantDraft) => onDraftChange({ self: next }),
    [onDraftChange]
  );
  const updateEnemy = useCallback(
    (next: CombatantDraft) => onDraftChange({ enemy: next }),
    [onDraftChange]
  );

  return (
    <div className="sim-draft-editor">
      <Row gutter={12}>
        <Col span={12}>
          <CombatantPanel
            title="我方配置"
            side="self"
            combatant={draft.self}
            onChange={updateSelf}
            heroes={heroes}
            items={items}
            skills={selfSkills}
          />
          <StatOverridePanel
            side="self"
            combatant={draft.self}
            onChange={updateSelf}
            attributeDefinitions={attributeDefinitions}
            gameId={gameId}
          />
        </Col>
        <Col span={12}>
          <CombatantPanel
            title="敌方配置"
            side="enemy"
            combatant={draft.enemy}
            onChange={updateEnemy}
            heroes={heroes}
            items={items}
            skills={enemySkills}
          />
          <StatOverridePanel
            side="enemy"
            combatant={draft.enemy}
            onChange={updateEnemy}
            attributeDefinitions={attributeDefinitions}
            gameId={gameId}
          />
        </Col>
      </Row>

      <ActionPanel
        draft={draft}
        onDraftChange={onDraftChange}
        heroSkills={selfSkills}
      />
    </div>
  );
}
