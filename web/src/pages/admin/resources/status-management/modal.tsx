import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch } from '@arco-design/web-react';
import {
  ATTACK_LOCK_MODE_OPTIONS,
  CAST_LOCK_MODE_OPTIONS,
  CONTROL_KIND_OPTIONS,
  CRIT_CHANCE_SOURCE_OPTIONS,
  DAMAGE_TYPE_OPTIONS,
  DISPLACEMENT_KIND_OPTIONS,
  INPUT_OVERRIDE_MODE_OPTIONS,
  MOVEMENT_LOCK_MODE_OPTIONS,
  PERIODIC_EFFECT_KIND_OPTIONS,
  RESOURCE_LABELS,
  STATUS_DURATION_MODE_OPTIONS,
  STATUS_GROUP_PHASE_OPTIONS,
  STATUS_GROUP_SNAPSHOT_POLICY_OPTIONS,
  STATUS_KIND_OPTIONS,
  STATUS_MODIFIER_MODE_OPTIONS,
  STATUS_SNAPSHOT_POLICY_OPTIONS,
  STATUS_SOURCE_SCOPE_OPTIONS,
  STATUS_STACK_MODE_OPTIONS
} from './constants';
import type {
  ControlStateProfileFormData,
  ModalFieldChange,
  StatusAttributeModifierFormData,
  StatusDefinitionFormData,
  StatusModalState,
  StatusModifierGroupFormData,
  StatusPeriodicHpEffectFormData,
  StatusSnapshot
} from './types';

type ModalProps = {
  snapshot: StatusSnapshot;
  groupOptions: { label: string; value: string }[];
  modal: StatusModalState | null;
  saving: boolean;
  onClose: () => void;
  onFieldChange: ModalFieldChange;
  onSubmit: () => Promise<void>;
};

export function StatusResourceModal({ snapshot, groupOptions, modal, saving, onClose, onFieldChange, onSubmit }: ModalProps) {
  const readOnly = modal?.mode === 'view';
  const editingExisting = modal?.mode !== 'create';
  const title = modal
    ? `${modal.mode === 'create' ? '新增' : modal.mode === 'edit' ? '编辑' : '查看'}${RESOURCE_LABELS[modal.resourceId]}`
    : '';

  return (
    <Modal
      title={title}
      visible={!!modal}
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
      {modal ? renderModalForm(snapshot, groupOptions, modal, readOnly, editingExisting, onFieldChange) : null}
    </Modal>
  );
}

function renderModalForm(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  modal: StatusModalState,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: ModalFieldChange
) {
  if (modal.resourceId === 'statusDefinitions') {
    return renderStatusDefinitionForm(snapshot, modal.formData, readOnly, editingExisting, onFieldChange);
  }
  if (modal.resourceId === 'controlStateProfiles') {
    return renderControlStateProfileForm(modal.formData, readOnly, editingExisting, onFieldChange);
  }
  if (modal.resourceId === 'statusModifierGroups') {
    return renderStatusModifierGroupForm(snapshot, modal.formData, readOnly, editingExisting, onFieldChange);
  }
  if (modal.resourceId === 'statusAttributeModifiers') {
    return renderStatusAttributeModifierForm(snapshot, groupOptions, modal.formData, readOnly, editingExisting, onFieldChange);
  }
  return renderStatusPeriodicHpEffectForm(snapshot, groupOptions, modal.formData, readOnly, editingExisting, onFieldChange);
}

// 字符串承载的数字字段：在 string <-> number 之间安全转换，空串显示为空。
function numberValue(text: string): number | undefined {
  if (text.trim() === '') {
    return undefined;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function numberOnChange(value: number | undefined, onFieldChange: ModalFieldChange, field: string) {
  onFieldChange(field, value !== undefined && value !== null ? String(value) : '');
}

function renderStatusDefinitionForm(
  snapshot: StatusSnapshot,
  formData: StatusDefinitionFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: ModalFieldChange
) {
  return (
    <Form layout="vertical">
      <div className="crud-form-grid">
        <Form.Item label="状态 ID">
          <Input value={formData.statusId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('statusId', value)} />
        </Form.Item>
        <Form.Item label="名称">
          <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} />
        </Form.Item>
      </div>

      <Form.Item label="说明">
        <Input.TextArea value={formData.description} disabled={readOnly} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => onFieldChange('description', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="状态类别">
          <Select value={formData.statusKind} disabled={readOnly} options={STATUS_KIND_OPTIONS} onChange={(value) => onFieldChange('statusKind', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="状态类型 ID">
          <InputNumber
            value={numberValue(formData.statusTypeId)}
            min={0}
            disabled={readOnly}
            onChange={(value) => numberOnChange(value, onFieldChange, 'statusTypeId')}
            placeholder="可选 types.typeId"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="控制语义 ID">
          <Select
            allowClear
            showSearch
            value={formData.controlProfileId || undefined}
            disabled={readOnly}
            options={snapshot.controlStateProfiles.map((profile) => ({
              label: `${profile.controlProfileId}${profile.name ? ` / ${profile.name}` : ''}`,
              value: profile.controlProfileId
            }))}
            onChange={(value) => onFieldChange('controlProfileId', value ? String(value) : '')}
          />
        </Form.Item>
        <Form.Item label="叠层组 Key">
          <Input value={formData.stackGroupKey} disabled={readOnly} onChange={(value) => onFieldChange('stackGroupKey', value)} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="来源范围">
          <Select value={formData.sourceScope} disabled={readOnly} options={STATUS_SOURCE_SCOPE_OPTIONS} onChange={(value) => onFieldChange('sourceScope', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="叠层策略">
          <Select value={formData.stackMode} disabled={readOnly} options={STATUS_STACK_MODE_OPTIONS} onChange={(value) => onFieldChange('stackMode', String(value ?? ''))} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="最大叠层">
          <InputNumber
            value={numberValue(formData.maxStacks)}
            min={1}
            disabled={readOnly}
            onChange={(value) => numberOnChange(value, onFieldChange, 'maxStacks')}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label="最大实例">
          <InputNumber
            value={numberValue(formData.maxInstances)}
            min={0}
            disabled={readOnly}
            onChange={(value) => numberOnChange(value, onFieldChange, 'maxInstances')}
            placeholder="可选"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="时长模式">
          <Select
            value={formData.durationMode}
            disabled={readOnly}
            options={STATUS_DURATION_MODE_OPTIONS}
            onChange={(value) => onFieldChange('durationMode', String(value ?? ''))}
          />
        </Form.Item>
        <Form.Item label="快照策略">
          <Select
            value={formData.snapshotPolicy}
            disabled={readOnly}
            options={STATUS_SNAPSHOT_POLICY_OPTIONS}
            onChange={(value) => onFieldChange('snapshotPolicy', String(value ?? ''))}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="时长(ms)">
          <InputNumber
            value={numberValue(formData.durationMs)}
            min={0}
            disabled={readOnly || formData.durationMode === 'permanent'}
            onChange={(value) => numberOnChange(value, onFieldChange, 'durationMs')}
            placeholder="timed 模式至少填 durationMs 或 durationFormulaId"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label="时长公式 ID">
          <Input
            value={formData.durationFormulaId}
            disabled={readOnly || formData.durationMode === 'permanent'}
            onChange={(value) => onFieldChange('durationFormulaId', value)}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="默认量级公式 ID">
          <Input value={formData.defaultMagnitudeFormulaId} disabled={readOnly} onChange={(value) => onFieldChange('defaultMagnitudeFormulaId', value)} />
        </Form.Item>
        <Form.Item label="驱散优先级">
          <InputNumber
            value={numberValue(formData.cleansePriority)}
            min={0}
            disabled={readOnly}
            onChange={(value) => numberOnChange(value, onFieldChange, 'cleansePriority')}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>

      <Form.Item label="可驱散">
        <Switch checked={formData.isDispellable} disabled={readOnly} onChange={(checked) => onFieldChange('isDispellable', Boolean(checked))} />
      </Form.Item>

      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderControlStateProfileForm(
  formData: ControlStateProfileFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: ModalFieldChange
) {
  return (
    <Form layout="vertical">
      <div className="crud-form-grid">
        <Form.Item label="控制语义 ID">
          <Input value={formData.controlProfileId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('controlProfileId', value)} />
        </Form.Item>
        <Form.Item label="名称">
          <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} />
        </Form.Item>
      </div>

      <Form.Item label="说明">
        <Input.TextArea value={formData.description} disabled={readOnly} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => onFieldChange('description', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="控制类型">
          <Select value={formData.controlKind} disabled={readOnly} options={CONTROL_KIND_OPTIONS} onChange={(value) => onFieldChange('controlKind', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="位移类型">
          <Select value={formData.displacementKind} disabled={readOnly} options={DISPLACEMENT_KIND_OPTIONS} onChange={(value) => onFieldChange('displacementKind', String(value ?? ''))} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="移动锁定">
          <Select value={formData.movementLockMode} disabled={readOnly} options={MOVEMENT_LOCK_MODE_OPTIONS} onChange={(value) => onFieldChange('movementLockMode', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="施法锁定">
          <Select value={formData.castLockMode} disabled={readOnly} options={CAST_LOCK_MODE_OPTIONS} onChange={(value) => onFieldChange('castLockMode', String(value ?? ''))} />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="普攻锁定">
          <Select value={formData.attackLockMode} disabled={readOnly} options={ATTACK_LOCK_MODE_OPTIONS} onChange={(value) => onFieldChange('attackLockMode', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="输入接管">
          <Select value={formData.inputOverrideMode} disabled={readOnly} options={INPUT_OVERRIDE_MODE_OPTIONS} onChange={(value) => onFieldChange('inputOverrideMode', String(value ?? ''))} />
        </Form.Item>
      </div>

      <Form.Item label="优先级">
        <InputNumber
          value={numberValue(formData.priority)}
          min={0}
          disabled={readOnly}
          onChange={(value) => numberOnChange(value, onFieldChange, 'priority')}
          style={{ width: '100%' }}
        />
      </Form.Item>

      <Space wrap size={24}>
        {renderSwitch('blocksControlInput', '阻断控制输入', formData.blocksControlInput, readOnly, onFieldChange)}
        {renderSwitch('grantsUnstoppable', '赋予不可阻挡', formData.grantsUnstoppable, readOnly, onFieldChange)}
        {renderSwitch('breaksOnDamage', '受伤解除', formData.breaksOnDamage, readOnly, onFieldChange)}
        {renderSwitch('tenacityReducible', '可被韧性减免', formData.tenacityReducible, readOnly, onFieldChange)}
      </Space>

      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderStatusModifierGroupForm(
  snapshot: StatusSnapshot,
  formData: StatusModifierGroupFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: ModalFieldChange
) {
  return (
    <Form layout="vertical">
      <div className="crud-form-grid">
        <Form.Item label="状态 ID">
          <Select
            showSearch
            value={formData.statusId || undefined}
            disabled={readOnly || editingExisting}
            options={snapshot.statusDefinitions.map((status) => ({
              label: `${status.statusId}${status.name ? ` / ${status.name}` : ''}`,
              value: status.statusId
            }))}
            onChange={(value) => onFieldChange('statusId', String(value ?? ''))}
          />
        </Form.Item>
        <Form.Item label="组 Key">
          <Input value={formData.groupKey} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('groupKey', value)} />
        </Form.Item>
      </div>

      <Form.Item label="组名">
        <Input value={formData.groupName} disabled={readOnly} onChange={(value) => onFieldChange('groupName', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="阶段">
          <Select value={formData.phaseKey} disabled={readOnly} options={STATUS_GROUP_PHASE_OPTIONS} onChange={(value) => onFieldChange('phaseKey', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="快照策略">
          <Select
            value={formData.snapshotPolicy}
            disabled={readOnly}
            options={STATUS_GROUP_SNAPSHOT_POLICY_OPTIONS}
            onChange={(value) => onFieldChange('snapshotPolicy', String(value ?? ''))}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="间隔(ms)">
          <InputNumber
            value={numberValue(formData.intervalMs)}
            min={0}
            disabled={readOnly || formData.phaseKey !== 'on_interval'}
            onChange={(value) => numberOnChange(value, onFieldChange, 'intervalMs')}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label="最大 Tick 数">
          <InputNumber
            value={numberValue(formData.maxTicks)}
            min={0}
            disabled={readOnly || formData.phaseKey !== 'on_interval'}
            onChange={(value) => numberOnChange(value, onFieldChange, 'maxTicks')}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>

      <Form.Item label="优先级">
        <InputNumber
          value={numberValue(formData.priority)}
          min={0}
          disabled={readOnly}
          onChange={(value) => numberOnChange(value, onFieldChange, 'priority')}
          style={{ width: '100%' }}
        />
      </Form.Item>

      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderStatusAttributeModifierForm(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  formData: StatusAttributeModifierFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: ModalFieldChange
) {
  return (
    <Form layout="vertical">
      {renderGroupIdentityFields(snapshot, groupOptions, formData.statusId, formData.groupKey, readOnly || editingExisting, onFieldChange)}

      <div className="crud-form-grid">
        <Form.Item label="修饰 ID">
          <Input value={formData.modifierId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('modifierId', value)} />
        </Form.Item>
        <Form.Item label="属性 Key">
          <Input value={formData.attrKey} disabled={readOnly} onChange={(value) => onFieldChange('attrKey', value)} placeholder="attributeDefinitions.attrKey" />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="修饰模式">
          <Select value={formData.modifierMode} disabled={readOnly} options={STATUS_MODIFIER_MODE_OPTIONS} onChange={(value) => onFieldChange('modifierMode', String(value ?? ''))} />
        </Form.Item>
        <Form.Item label="优先级">
          <InputNumber
            value={numberValue(formData.priority)}
            min={0}
            disabled={readOnly}
            onChange={(value) => numberOnChange(value, onFieldChange, 'priority')}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="数值">
          <InputNumber
            value={numberValue(formData.value)}
            disabled={readOnly}
            onChange={(value) => numberOnChange(value, onFieldChange, 'value')}
            placeholder="value 或 formulaId 至少填一个"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label="公式 ID">
          <Input value={formData.formulaId} disabled={readOnly} onChange={(value) => onFieldChange('formulaId', value)} />
        </Form.Item>
      </div>

      <Form.Item label="桶 Key">
        <Input value={formData.bucketKey} disabled={readOnly} onChange={(value) => onFieldChange('bucketKey', value)} placeholder="bucket_add / bucket_mul 必填" />
      </Form.Item>

      {renderSwitch('perStack', '每叠层', formData.perStack, readOnly, onFieldChange)}
      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderStatusPeriodicHpEffectForm(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  formData: StatusPeriodicHpEffectFormData,
  readOnly: boolean,
  editingExisting: boolean,
  onFieldChange: ModalFieldChange
) {
  return (
    <Form layout="vertical">
      {renderGroupIdentityFields(snapshot, groupOptions, formData.statusId, formData.groupKey, readOnly || editingExisting, onFieldChange)}

      <div className="crud-form-grid">
        <Form.Item label="效果 ID">
          <Input value={formData.effectId} disabled={readOnly || editingExisting} onChange={(value) => onFieldChange('effectId', value)} />
        </Form.Item>
        <Form.Item label="效果类型">
          <Select value={formData.effectKind} disabled={readOnly} options={PERIODIC_EFFECT_KIND_OPTIONS} onChange={(value) => onFieldChange('effectKind', String(value ?? ''))} />
        </Form.Item>
      </div>

      <Form.Item label="Tick 公式 ID">
        <Input value={formData.tickFormulaId} disabled={readOnly} onChange={(value) => onFieldChange('tickFormulaId', value)} />
      </Form.Item>

      <div className="crud-form-grid">
        <Form.Item label="伤害类型">
          <Select
            value={formData.damageType}
            disabled={readOnly || formData.effectKind !== 'damage'}
            options={DAMAGE_TYPE_OPTIONS}
            onChange={(value) => onFieldChange('damageType', String(value ?? ''))}
          />
        </Form.Item>
        <Form.Item label="受治疗加成影响">
          <Switch
            checked={formData.affectedByHealModifier}
            disabled={readOnly || formData.effectKind !== 'heal'}
            onChange={(checked) => onFieldChange('affectedByHealModifier', Boolean(checked))}
          />
        </Form.Item>
      </div>

      <div className="crud-form-grid">
        <Form.Item label="暴击来源">
          <Select
            value={formData.critChanceSource}
            disabled={readOnly || !formData.canCrit}
            options={CRIT_CHANCE_SOURCE_OPTIONS}
            onChange={(value) => onFieldChange('critChanceSource', String(value ?? 'none'))}
          />
        </Form.Item>
        <Form.Item label="暴击倍率">
          <InputNumber
            value={numberValue(formData.critMultiplier)}
            step={0.1}
            disabled={readOnly || !formData.canCrit}
            onChange={(value) => numberOnChange(value, onFieldChange, 'critMultiplier')}
            placeholder="canCrit=true 时必填，须大于 0"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>

      <Form.Item label="暴击率">
        <InputNumber
          value={numberValue(formData.critChance)}
          min={0}
          max={1}
          step={0.01}
          disabled={readOnly || !formData.canCrit || formData.critChanceSource !== 'fixed'}
          onChange={(value) => numberOnChange(value, onFieldChange, 'critChance')}
          placeholder="仅 critChanceSource=fixed 时填写，范围 0~1"
          style={{ width: '100%' }}
        />
      </Form.Item>

      <Space wrap size={24}>
        {renderSwitch('canCrit', '可暴击', formData.canCrit, readOnly, onFieldChange)}
        {renderSwitch('perStack', '每叠层', formData.perStack, readOnly, onFieldChange)}
      </Space>
      {renderExtendField(formData.extendText, readOnly, onFieldChange)}
    </Form>
  );
}

function renderGroupIdentityFields(
  snapshot: StatusSnapshot,
  groupOptions: { label: string; value: string }[],
  statusId: string,
  groupKey: string,
  disabled: boolean,
  onFieldChange: ModalFieldChange
) {
  const selectedGroupKey = statusId && groupKey ? `${statusId}|${groupKey}` : undefined;
  return (
    <div className="crud-form-grid">
      <Form.Item label="状态 ID">
        <Select
          showSearch
          value={statusId || undefined}
          disabled={disabled}
          options={snapshot.statusDefinitions.map((status) => ({
            label: `${status.statusId}${status.name ? ` / ${status.name}` : ''}`,
            value: status.statusId
          }))}
          onChange={(value) => {
            onFieldChange('statusId', String(value ?? ''));
            onFieldChange('groupKey', '');
          }}
        />
      </Form.Item>
      <Form.Item label="组 Key">
        <Select
          showSearch
          value={selectedGroupKey}
          disabled={disabled}
          options={groupOptions.filter((option) => !statusId || option.value.startsWith(`${statusId}|`))}
          onChange={(value) => {
            const [nextStatusId = '', nextGroupKey = ''] = String(value ?? '').split('|');
            onFieldChange('statusId', nextStatusId);
            onFieldChange('groupKey', nextGroupKey);
          }}
        />
      </Form.Item>
    </div>
  );
}

function renderSwitch(
  field: string,
  label: string,
  checked: boolean,
  disabled: boolean,
  onFieldChange: ModalFieldChange
) {
  return (
    <Form.Item label={label}>
      <Switch checked={checked} disabled={disabled} onChange={(value) => onFieldChange(field, Boolean(value))} />
    </Form.Item>
  );
}

function renderExtendField(extendText: string, readOnly: boolean, onFieldChange: ModalFieldChange) {
  return (
    <Form.Item label="扩展字段">
      <Input.TextArea
        value={extendText}
        disabled={readOnly}
        autoSize={{ minRows: 6, maxRows: 12 }}
        onChange={(value) => onFieldChange('extendText', value)}
        className="admin-json-input"
        placeholder="{\n  \n}"
      />
    </Form.Item>
  );
}
