import { Alert, Button, Form, Input, Modal, Select, Space, Switch } from '@arco-design/web-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { createEntitySelectOption, buildSelectSearchText, filterEntitySelectOption } from '../../../../components/EntitySelectOption';
import { getErrorMessage, getHeroes, getSkills } from '../../../../services/apiClient';
import { buildHeroImageUri } from '../../../../services/resourceImage';
import type { Hero, Skill } from '../../../../types/api';
import { useResourceImageCache } from '../shared/useResourceImageCache';
import { SKILL_MOUNT_TARGET_CATEGORY_OPTIONS } from './constants';
import type { SkillMountsFormData } from './types';

type SkillMountsModalProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: SkillMountsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof SkillMountsFormData>(field: K, value: SkillMountsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

type SelectOption = {
  label: ReactNode;
  value: string;
  searchText?: string;
};

function appendCurrentOption(options: SelectOption[], currentValue: string): SelectOption[] {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options;
  }
  return [...options, { label: `${currentValue}（当前值）`, value: currentValue }];
}

export function SkillMountsModal({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: SkillMountsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';
  const token = adminToken.trim();
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const { imageSrcByUri } = useResourceImageCache(selectedGameId);

  useEffect(() => {
    if (!visible || !selectedGameId || !token) {
      setHeroes([]);
      setSkills([]);
      setLoadingOptions(false);
      setOptionsError(null);
      return;
    }

    let cancelled = false;
    setLoadingOptions(true);
    setOptionsError(null);

    Promise.all([getHeroes(apiBaseUrl, selectedGameId, token), getSkills(apiBaseUrl, selectedGameId, token)])
      .then(([heroesResult, skillsResult]) => {
        if (cancelled) {
          return;
        }
        setHeroes(heroesResult.data.heroes);
        setSkills(skillsResult.data.skills);
        setLoadingOptions(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setHeroes([]);
        setSkills([]);
        setLoadingOptions(false);
        setOptionsError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, token, visible]);

  const heroOptions = useMemo(() => {
    const options = heroes.map((hero) => {
      const imageUri = buildHeroImageUri(hero.heroId);
      return createEntitySelectOption({
        value: hero.heroId,
        primary: hero.name ?? hero.title ?? hero.heroId,
        secondary: hero.heroId,
        imageSrc: (imageUri ? imageSrcByUri[imageUri] ?? null : null) ?? hero.avatarUrl ?? null,
        showImage: true,
        imageAlt: hero.name ?? hero.title ?? hero.heroId
      });
    });
    const currentValue = formData.targetCategory === 'hero' ? formData.targetId.trim() : '';
    return appendCurrentOption(options, currentValue);
  }, [formData.targetCategory, formData.targetId, heroes, imageSrcByUri]);

  const skillOptions = useMemo(() => {
    const options = skills.map((skill) => ({
      label: `${skill.name ?? skill.skillId} / ${skill.skillKey ?? '-'} / ${skill.skillId}`,
      value: skill.skillId,
      searchText: buildSelectSearchText(skill.skillId, skill.name, skill.skillKey)
    }));
    return appendCurrentOption(options, formData.skillId.trim());
  }, [formData.skillId, skills]);

  return (
    <Modal
      title={mode === 'create' ? '新增技能挂载' : mode === 'edit' ? '编辑技能挂载' : '查看技能挂载'}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} onClick={() => void onSubmit()}>
              保存
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: '90vw', maxWidth: 1280 }}
    >
      <Form layout="vertical">
        {optionsError ? (
          <Alert type="error" content={`英雄/技能候选加载失败：${optionsError}`} style={{ marginBottom: 16 }} />
        ) : null}

        <div className="crud-form-grid">
          <Form.Item label="目标分类" required>
            <Select
              value={formData.targetCategory || undefined}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('targetCategory', String(value ?? ''))}
              placeholder="选择目标分类"
              options={SKILL_MOUNT_TARGET_CATEGORY_OPTIONS}
            />
          </Form.Item>

          <Form.Item label="目标 ID" required>
            {formData.targetCategory === 'hero' ? (
              <Select
                showSearch
                allowClear
                value={formData.targetId || undefined}
                disabled={readOnly || editingExisting || !selectedGameId || !token}
                loading={loadingOptions}
                options={heroOptions}
                placeholder="搜索并选择英雄"
                onChange={(value) => onFieldChange('targetId', String(value ?? ''))}
                filterOption={filterEntitySelectOption}
              />
            ) : (
              <Input
                value={formData.targetId}
                disabled={readOnly || editingExisting}
                onChange={(value) => onFieldChange('targetId', value)}
                placeholder="例如 hero_xxx"
              />
            )}
          </Form.Item>
        </div>

        <Form.Item label="技能 ID" required>
          <Select
            showSearch
            allowClear
            value={formData.skillId || undefined}
            disabled={readOnly || editingExisting || !selectedGameId || !token}
            loading={loadingOptions}
            options={skillOptions}
            placeholder="搜索并选择技能"
            onChange={(value) => onFieldChange('skillId', String(value ?? ''))}
            filterOption={filterEntitySelectOption}
          />
        </Form.Item>

        <Form.Item label="启用">
          <Switch checked={formData.enabled} disabled={readOnly} onChange={(checked) => onFieldChange('enabled', checked)} />
        </Form.Item>

        <Form.Item label="扩展字段">
          <Input.TextArea
            value={formData.extendText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 12 }}
            onChange={(value) => onFieldChange('extendText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
