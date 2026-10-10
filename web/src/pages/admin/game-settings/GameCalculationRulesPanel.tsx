import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { listAttributes } from '../../../services/attributeClient';
import { getGameCalculationRules, updateGameCalculationRules, UnconfirmedCalculationRulesWriteError } from '../../../services/gameCalculationRulesClient';
import { sameFormulaPayload } from '../../../services/skillFormulaContract';
import type { Attribute } from '../../../types/attribute';
import type { GameCalculationConfiguration, GameCalculationRulesResponse } from '../../../types/gameCalculationRules';
import { CommonFormulaDefinitionEditor } from '../common-formula/CommonFormulaDefinitionEditor';
import { updateCommonFormulaNode, type CommonFormulaDraft, type CommonFormulaNodeDraft } from '../common-formula/commonFormulaForm';
import { emptyGameCalculationDraft, validateGameCalculationDraft, type GameCalculationDraft } from './gameCalculationForm';

type Props = { apiBaseUrl: string; selectedGameId: string | null; adminToken: string; onDirtyChange: (dirty: boolean) => void };
export function GameCalculationRulesPanel({ apiBaseUrl, selectedGameId, adminToken, onDirtyChange }: Props) {
  const context = useMemo(() => ({ apiBaseUrl, gameId: selectedGameId, token: adminToken.trim() }), [apiBaseUrl, selectedGameId, adminToken]);
  const current = useRef(context); current.current = context;
  const serial = useRef(0), active = useRef(true), busy = useRef(false);
  const [loaded, setLoaded] = useState<typeof context | null>(null);
  const [response, setResponse] = useState<GameCalculationRulesResponse | null>(null);
  const [draft, setDraft] = useState<GameCalculationDraft | null>(null);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [pending, setPending] = useState<GameCalculationConfiguration | null>(null);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const ready = loaded === context;
  const dirty = ready && (pending !== null || !sameFormulaPayload(draft, response?.configuration ?? null));
  const isCurrent = useCallback((id: number, origin: typeof context) => active.current && serial.current === id && current.current === origin, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const load = useCallback(async () => {
    const id = ++serial.current;
    setLoaded(null); setResponse(null); setDraft(null); setPending(null); setAttributes([]); setError(null); setNotice(null);
    setLoading(Boolean(context.gameId && context.token));
    if (!context.gameId || !context.token) return;
    try {
      const [rules, catalog] = await Promise.all([getGameCalculationRules(context.apiBaseUrl, context.gameId, context.token),
        listAttributes(context.apiBaseUrl, context.gameId, context.token)]);
      if (!isCurrent(id, context)) return;
      if (catalog.data.items.some(row => row.gameId !== context.gameId)) throw new Error('计算规则引用目录不属于当前游戏。');
      setResponse(rules.data); setDraft(structuredClone(rules.data.configuration)); setAttributes(catalog.data.items); setLoaded(context);
    } catch (error) { if (isCurrent(id, context)) setError(getErrorMessage(error)); }
    finally { if (isCurrent(id, context)) setLoading(false); }
  }, [context, isCurrent]);
  useEffect(() => {
    active.current = true; busy.current = false; setSaving(false); void load();
    return () => { active.current = false; serial.current++; };
  }, [load]);
  const refresh = () => {
    if (busy.current) return;
    if (!dirty) { void load(); return; }
    const origin = context;
    Modal.confirm({ title: '放弃未保存的计算规则？', content: '刷新会丢弃当前草稿。', okText: '放弃并刷新', cancelText: '继续编辑',
      onOk: () => { if (active.current && current.current === origin) void load(); } });
  };
  const confirm = async () => {
    if (!pending || !ready || busy.current || !context.gameId) return;
    const id = ++serial.current; busy.current = true; setSaving(true); setError(null);
    try {
      const read = await getGameCalculationRules(context.apiBaseUrl, context.gameId, context.token);
      if (!isCurrent(id, context)) return;
      if (!sameFormulaPayload(read.data.configuration, pending)) throw new Error('独立读回与待确认草稿不同，保留草稿；请核对当前版本。');
      setResponse(read.data); setDraft(structuredClone(read.data.configuration)); setPending(null); setNotice('计算规则已独立读回确认。');
    } catch (error) { if (isCurrent(id, context)) setError(getErrorMessage(error)); }
    finally { if (isCurrent(id, context)) { busy.current = false; setSaving(false); } }
  };
  const save = async () => {
    if (!ready || !draft || !response || pending || busy.current || !context.gameId) return;
    let candidate: GameCalculationConfiguration;
    try { candidate = validateGameCalculationDraft(draft, attributes); }
    catch (error) { setError(getErrorMessage(error)); return; }
    const id = ++serial.current; busy.current = true; setSaving(true); setError(null); setNotice(null);
    try {
      const written = await updateGameCalculationRules(context.apiBaseUrl, context.gameId, context.token, { baseDigest: response.baseDigest, configuration: candidate });
      if (!isCurrent(id, context)) return;
      setResponse(written.data); setDraft(structuredClone(written.data.configuration)); setNotice('计算规则已保存并独立读回确认。');
    } catch (error) {
      if (!isCurrent(id, context)) return;
      if (error instanceof UnconfirmedCalculationRulesWriteError) setPending(candidate);
      setError(getErrorMessage(error));
    } finally { if (isCurrent(id, context)) { busy.current = false; setSaving(false); } }
  };
  const disabled = !ready || loading || saving || pending !== null;
  const patch = (next: GameCalculationDraft) => { setDraft(next); setError(null); setNotice(null); };
  const options = attributes.map(row => ({ value: row.attributeKey, label: `${row.name} / ${row.attributeKey}${row.status === 'DISABLED' ? '（已停用）' : ''}`, disabled: row.status !== 'ENABLED' }));
  const rulePatch = (index: number, next: GameCalculationDraft['attributeDerivations'][number]) => {
    if (draft) patch({ ...draft, attributeDerivations: draft.attributeDerivations.map((rule, i) => index === i ? next : rule) });
  };
  return <Panel title="游戏计算规则" actions={<Button loading={loading} disabled={saving || !context.gameId || !context.token} onClick={refresh}>刷新计算规则</Button>}>
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Typography.Paragraph>明确暴击概率、倍率下限及连续攻击速度的用途绑定。派生公式读取拥有方本帧属性；有来源明确输出时优先采用来源输出。未配置时不补默认属性或公式。</Typography.Paragraph>
      {error ? <Alert type="error" content={error} /> : null}{notice ? <Alert type="success" content={notice} /> : null}
      {ready && !draft ? <><Alert type="warning" content="尚未配置游戏计算规则。" /><Button onClick={() => patch(emptyGameCalculationDraft())}>配置游戏计算规则</Button></> : null}
      {ready && draft ? <>
        <Form layout="vertical" disabled={disabled}>
          <Space wrap align="start">
            <Form.Item label="暴击概率属性"><Select aria-label="暴击概率属性" allowClear showSearch value={draft.criticalChanceAttributeKey ?? undefined} options={options} style={{ width: 260 }} onChange={value => patch({ ...draft, criticalChanceAttributeKey: value || null })} /></Form.Item>
            <Form.Item label="暴击倍率下限（空值为不设下限）"><InputNumber aria-label="暴击倍率下限" min={0} value={draft.criticalMultiplierMin ?? undefined} onChange={value => patch({ ...draft, criticalMultiplierMin: value ?? null })} /></Form.Item>
            <Form.Item label="连续攻击速度属性"><Select aria-label="连续攻击速度属性" allowClear showSearch value={draft.attackSpeedAttributeKey ?? undefined} options={options.filter(row => row.value !== 'hp')} style={{ width: 260 }} onChange={value => patch({ ...draft, attackSpeedAttributeKey: value || null })} /></Form.Item>
          </Space>
        </Form>
        <Button disabled={disabled || draft.attributeDerivations.length >= 4} onClick={() => patch({ ...draft, attributeDerivations: [...draft.attributeDerivations,
          { ruleKey: '', attributeKey: '', valuePolicy: 'set', activationAttributeKeys: [], formula: { inputs: [], stages: [{ key: '', name: '', expression: { op: 'empty' } }], outputStageKey: '' } }] })}>添加属性派生</Button>
        {draft.attributeDerivations.map((rule, index) => <Card key={index} title={`属性派生${index + 1}`}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input aria-label={`派生${index + 1}规则标识`} value={rule.ruleKey} disabled={disabled} onChange={ruleKey => rulePatch(index, { ...rule, ruleKey })} />
            <Select aria-label={`派生${index + 1}输出属性`} value={rule.attributeKey || undefined} options={options.filter(row => row.value !== 'hp')} disabled={disabled} onChange={attributeKey => rulePatch(index, { ...rule, attributeKey })} />
            <Select aria-label={`派生${index + 1}执行策略`} value={rule.valuePolicy} options={[{ value: 'set', label: '修正前替换' }, { value: 'multiply', label: '修正后乘算' }]} disabled={disabled} onChange={valuePolicy => rulePatch(index, { ...rule, valuePolicy })} />
            <Select aria-label={`派生${index + 1}激活属性`} mode="multiple" value={rule.activationAttributeKeys} options={options.filter(row => row.value !== 'hp')} disabled={disabled} onChange={activationAttributeKeys => rulePatch(index, { ...rule, activationAttributeKeys })} />
            <CommonFormulaDefinitionEditor root={rule.formula} path="expression" node={rule.formula} parameters={[]} attributes={attributes} retainedDisabledAttributeKeys={new Set()} nodeIssues={[]} readOnly={false} disabled={disabled} bindingScope="game"
              updateAtPath={(path, next) => rulePatch(index, { ...rule, formula: path === 'expression' ? next as CommonFormulaDraft : updateCommonFormulaNode(rule.formula, path, next as CommonFormulaNodeDraft) })}
              onNodeIssue={issue => setError(`${issue.path}：${issue.message}`)} />
            <Button status="danger" disabled={disabled} onClick={() => patch({ ...draft, attributeDerivations: draft.attributeDerivations.filter((_rule, i) => i !== index) })}>删除属性派生{index + 1}</Button>
          </Space>
        </Card>)}
        <Space>{pending ? <Button loading={saving} onClick={() => void confirm()}>重新读取计算规则确认</Button> : null}
          <Button type="primary" loading={saving} disabled={disabled} onClick={() => void save()}>保存计算规则</Button></Space>
      </> : null}
    </Space>
  </Panel>;
}
