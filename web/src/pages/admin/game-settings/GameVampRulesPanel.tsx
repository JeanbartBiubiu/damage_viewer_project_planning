import { Alert, Button, Form, InputNumber, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { listAttributes } from '../../../services/attributeClient';
import { getGameVampRules, updateGameVampRules } from '../../../services/gameVampClient';
import { listSkillCategories } from '../../../services/skillCategoryClient';
import type { Attribute } from '../../../types/attribute';
import type { SkillCategory } from '../../../types/skillCategory';
import { GAME_VAMP_BASIS_LABELS, GAME_VAMP_TYPE_LABELS, GAME_VAMP_TYPES, sortGameVampRules } from '../../../types/gameVamp';
import { createGameVampRuleDraft, validateGameVampRules, type GameVampRuleDraft } from './gameVampForm';

type Props = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

export function GameVampRulesPanel({ apiBaseUrl, selectedGameId, adminToken, onDirtyChange }: Props) {
  const token = adminToken.trim();
  const context = useMemo(() => ({ apiBaseUrl, gameId: selectedGameId, token }), [apiBaseUrl, selectedGameId, token]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const serial = useRef(0);
  const active = useRef(true);
  const busy = useRef(false);
  const confirmation = useRef<ReturnType<typeof Modal.confirm> | null>(null);
  const [loadedContext, setLoadedContext] = useState<typeof context | null>(null);
  const [draft, setDraft] = useState<GameVampRuleDraft[]>([]);
  const [baseline, setBaseline] = useState<GameVampRuleDraft[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = loadedContext === context;
  const dirty = ready && JSON.stringify(draft) !== JSON.stringify(baseline);
  const isCurrent = useCallback((request: number, requestContext: typeof context) => (
    active.current && serial.current === request && currentContext.current === requestContext
  ), []);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const load = useCallback(async () => {
    const request = ++serial.current;
    setLoadedContext(null); setError(null); setNotice(null);
    setDraft([]); setBaseline([]); setAttributes([]); setCategories([]);
    setLoading(Boolean(context.gameId && context.token));
    if (!context.gameId || !context.token) return;
    try {
      const [rules, attributeList, categoryList] = await Promise.all([
        getGameVampRules(context.apiBaseUrl, context.gameId, context.token),
        listAttributes(context.apiBaseUrl, context.gameId, context.token),
        listSkillCategories(context.apiBaseUrl, context.gameId, context.token)
      ]);
      if (!isCurrent(request, context)) return;
      if (attributeList.data.items.some((item) => item.gameId !== context.gameId)
        || categoryList.data.items.some((item) => item.gameId !== context.gameId)) throw new Error('吸血规则引用目录不属于当前游戏。');
      setDraft(rules.data.rules); setBaseline(rules.data.rules);
      setAttributes(attributeList.data.items); setCategories(categoryList.data.items); setLoadedContext(context);
    } catch (loadError) {
      if (isCurrent(request, context)) setError(getErrorMessage(loadError));
    } finally {
      if (isCurrent(request, context)) setLoading(false);
    }
  }, [context, isCurrent]);

  useEffect(() => {
    active.current = true; busy.current = false; setSaving(false); void load();
    return () => { active.current = false; serial.current += 1; confirmation.current?.close(); confirmation.current = null; };
  }, [load]);

  const refresh = () => {
    if (busy.current) return;
    if (!dirty) { void load(); return; }
    const requestContext = context;
    confirmation.current = Modal.confirm({
      title: '放弃未保存的吸血规则？', content: '刷新将丢弃当前吸血规则草稿。', okText: '放弃并刷新', cancelText: '继续编辑',
      onOk: () => { if (currentContext.current === requestContext && active.current) void load(); }
    });
  };

  const save = async () => {
    if (!ready || loading || busy.current || !context.gameId || !context.token) return;
    const validation = validateGameVampRules(draft, attributes, categories);
    if (!validation.ok) { setError(validation.message); return; }
    const request = ++serial.current;
    busy.current = true; setSaving(true); setError(null); setNotice(null);
    try {
      const result = await updateGameVampRules(context.apiBaseUrl, context.gameId, context.token, validation.value);
      if (!isCurrent(request, context)) return;
      setDraft(result.data.rules); setBaseline(result.data.rules); setNotice('游戏吸血规则已保存；已核定的普通伤害继承这些规则。');
    } catch (saveError) {
      if (isCurrent(request, context)) setError(getErrorMessage(saveError));
    } finally {
      if (isCurrent(request, context)) { busy.current = false; setSaving(false); }
    }
  };

  const patch = (index: number, next: GameVampRuleDraft) => {
    setDraft((current) => sortGameVampRules(current.map((item, i) => i === index ? next : item)));
    setError(null); setNotice(null);
  };
  const disabled = !ready || loading || saving;

  return <Panel title="通用吸血规则" actions={<Button loading={loading} disabled={saving || !context.gameId || !context.token} onClick={refresh}>刷新吸血规则</Button>}>
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Typography.Paragraph>在这里维护共同规则；伤害结果只核定资格并填写有来源依据的禁止或覆盖。比例读取伤害来源当前属性，技能自身治疗仍单独配置。</Typography.Paragraph>
      <Alert type="info" content="每个选择集合内任一项匹配；产生方式、来源性质和技能分类三个条件必须同时满足。未配置的吸血种类不会启用。" />
      {error ? <Alert type="error" content={error} /> : null}
      {notice ? <Alert type="success" content={notice} /> : null}
      {loading ? <Typography.Text>正在读取吸血规则与引用目录…</Typography.Text> : null}
      {ready && !draft.length ? <Alert type="warning" content="尚未配置通用吸血规则。伤害可以保存为未核定，准备运行前需要先维护游戏规则并核定资格。" /> : null}
      {ready ? draft.map((rule, index) => {
        const prefix = GAME_VAMP_TYPE_LABELS[rule.vampType];
        return <fieldset key={rule.vampType} style={{ border: '1px solid var(--color-border-2)', padding: 16 }}>
          <legend>{prefix}</legend>
          <Form layout="vertical" disabled={disabled}>
            <Space wrap align="start" style={{ width: '100%' }}>
              <Form.Item label="吸血种类" required><Select aria-label={`${prefix}种类`} value={rule.vampType} style={{ width: 160 }}
                options={GAME_VAMP_TYPES.map((value) => ({ value, label: GAME_VAMP_TYPE_LABELS[value], disabled: draft.some((item, i) => i !== index && item.vampType === value) }))}
                onChange={(vampType) => patch(index, { ...rule, vampType })} /></Form.Item>
              <Form.Item label="来源比例属性" required><Select aria-label={`${prefix}来源比例属性`} value={rule.sourceAttributeKey || undefined} showSearch style={{ width: 290 }}
                options={attributes.filter((item) => item.valueType === 'DECIMAL').map((item) => ({ value: item.attributeKey, label: `${item.name} / ${item.attributeKey}${item.status === 'DISABLED' ? '（已停用）' : ''}` }))}
                onChange={(sourceAttributeKey) => patch(index, { ...rule, sourceAttributeKey })} /></Form.Item>
              <Form.Item label="计算基数" required><Select aria-label={`${prefix}计算基数`} value={rule.basisOutputKind} style={{ width: 190 }}
                options={Object.entries(GAME_VAMP_BASIS_LABELS).map(([value, label]) => ({ value, label }))}
                onChange={(basisOutputKind) => patch(index, { ...rule, basisOutputKind })} /></Form.Item>
              <Form.Item label="默认效率" required><InputNumber aria-label={`${prefix}默认效率`} value={rule.defaultEfficiency} min={0} placeholder="1 表示100%" style={{ width: 150 }}
                onChange={(defaultEfficiency) => patch(index, { ...rule, defaultEfficiency })} /></Form.Item>
            </Space>
            <Space wrap align="start" style={{ width: '100%' }}>
              <Form.Item label="伤害产生方式" required><Select mode="multiple" aria-label={`${prefix}伤害产生方式`} value={rule.deliveryKinds} style={{ width: 260 }}
                options={[{ value: 'SKILL', label: '技能伤害' }, { value: 'BASIC_ATTACK', label: '普通攻击伤害' }]}
                onChange={(deliveryKinds) => patch(index, { ...rule, deliveryKinds })} /></Form.Item>
              <Form.Item label="伤害来源性质" required><Select mode="multiple" aria-label={`${prefix}伤害来源性质`} value={rule.originKinds} style={{ width: 230 }}
                options={[{ value: 'DIRECT', label: '直接伤害' }, { value: 'REFLECTED', label: '反射伤害' }]}
                onChange={(originKinds) => patch(index, { ...rule, originKinds })} /></Form.Item>
              <Form.Item label="技能分类" required><Select mode="multiple" showSearch aria-label={`${prefix}技能分类`} value={rule.skillCategoryKeys} style={{ minWidth: 290 }}
                options={categories.map((item) => ({ value: item.skillCategoryKey, label: `${item.name} / ${item.skillCategoryKey}` }))}
                onChange={(skillCategoryKeys) => patch(index, { ...rule, skillCategoryKeys })} /></Form.Item>
            </Space>
            <Button status="danger" disabled={disabled} onClick={() => { setDraft(draft.filter((_, i) => i !== index)); setNotice(null); }}>删除{prefix}规则</Button>
          </Form>
        </fieldset>;
      }) : null}
      <Space>
        <Button disabled={disabled || draft.length >= GAME_VAMP_TYPES.length} onClick={() => {
          const next = GAME_VAMP_TYPES.find((type) => !draft.some((item) => item.vampType === type));
          if (next) { setDraft(sortGameVampRules([...draft, createGameVampRuleDraft(next)])); setNotice(null); }
        }}>新增游戏吸血规则</Button>
        <Button type="primary" disabled={disabled} loading={saving} onClick={() => void save()}>保存吸血规则</Button>
      </Space>
    </Space>
  </Panel>;
}
