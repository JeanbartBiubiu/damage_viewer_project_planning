import { Alert, Button, Empty, Input, Modal, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { listCharacters } from '../../../services/characterClient';
import { listEquipment } from '../../../services/equipmentClient';
import { getSkill, listSkills } from '../../../services/skillClient';
import {
  createCharacterSkillRelation,
  createEquipmentSkillRelation,
  deleteCharacterSkillRelation,
  deleteEquipmentSkillRelation,
  listCharacterSkillRelations,
  listEquipmentSkillRelations,
  updateCharacterSkillRelation,
  updateEquipmentSkillRelation
} from '../../../services/skillRelationClient';
import type { SkillStatus } from '../../../types/skill';
import type {
  CharacterSkillRelation,
  EquipmentSkillRelation,
  SkillRelationOwnerKind,
  SkillRelationTarget
} from '../../../types/skillRelation';
import {
  availableSkillRelationOptions,
  emptySkillRelationDraft,
  parseSkillRelationSortOrder,
  skillRelationDraftIsDirty,
  skillRelationIdentity,
  skillRelationOptionMatches,
  skillRelationOptionsFromResponse
} from './skillRelationForm';
import type { SkillRelationAddDraft, SkillRelationOption } from './skillRelationForm';

export type SkillRelationsModalProps = {
  visible: boolean;
  target: SkillRelationTarget | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onEditSkill?: (skillKey: string) => void;
};

type RelationRow = {
  identity: string;
  kind: SkillRelationOwnerKind;
  ownerKey: string;
  skillKey: string;
  name: string;
  key: string;
  skillStatus: SkillStatus;
  sortOrder: number;
};

type LoadedRelations = {
  scope: string;
  characters: CharacterSkillRelation[];
  equipment: EquipmentSkillRelation[];
  characterOptions: SkillRelationOption[];
  equipmentOptions: SkillRelationOption[];
  skillOptions: SkillRelationOption[];
  skillStatus: SkillStatus | null;
};

function initialDrafts(): Record<SkillRelationOwnerKind, SkillRelationAddDraft> {
  return { character: emptySkillRelationDraft(), equipment: emptySkillRelationDraft() };
}

export function SkillRelationsModal({
  visible, target, apiBaseUrl, selectedGameId, adminToken, onClose, onDirtyChange, onEditSkill
}: SkillRelationsModalProps) {
  const kind = target?.kind;
  const targetKey = target?.key;
  const token = adminToken.trim();
  const scope = JSON.stringify([visible, apiBaseUrl, selectedGameId, kind, targetKey, token]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const loadSerial = useRef(0);
  const activeWrite = useRef<string | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const [loaded, setLoaded] = useState<LoadedRelations | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [sortEdits, setSortEdits] = useState<Record<string, string>>({});
  const dirty = skillRelationDraftIsDirty(drafts, sortEdits);
  const data = loaded?.scope === scope ? loaded : null;
  const ready = Boolean(data && !loading && !saving && selectedGameId && token);

  const load = useCallback(async () => {
    const serial = ++loadSerial.current;
    if (!visible || !selectedGameId || !kind || !targetKey || !token) return;
    setLoading(true);
    setError(null);
    const next: LoadedRelations = {
      scope, characters: [], equipment: [], characterOptions: [], equipmentOptions: [], skillOptions: [], skillStatus: null
    };
    try {
      if (kind === 'skill') {
        const [characters, equipment, characterOptions, equipmentOptions, skill] = await Promise.all([
          listCharacterSkillRelations(apiBaseUrl, selectedGameId, token, { skillKey: targetKey }),
          listEquipmentSkillRelations(apiBaseUrl, selectedGameId, token, { skillKey: targetKey }),
          listCharacters(apiBaseUrl, selectedGameId, token),
          listEquipment(apiBaseUrl, selectedGameId, token),
          getSkill(apiBaseUrl, selectedGameId, targetKey, token)
        ]);
        next.characters = characters.data.items;
        next.equipment = equipment.data.items;
        next.characterOptions = skillRelationOptionsFromResponse(characterOptions.data, selectedGameId, 'character');
        next.equipmentOptions = skillRelationOptionsFromResponse(equipmentOptions.data, selectedGameId, 'equipment');
        const currentSkill = skillRelationOptionsFromResponse({ items: [skill.data], total: 1 }, selectedGameId, 'skill')[0];
        if (currentSkill.key !== targetKey) throw new Error('当前技能响应不符合接口约定。');
        next.skillStatus = currentSkill.status;
      } else {
        const [relations, skills] = await Promise.all([
          kind === 'character'
            ? listCharacterSkillRelations(apiBaseUrl, selectedGameId, token, { characterKey: targetKey })
            : listEquipmentSkillRelations(apiBaseUrl, selectedGameId, token, { equipmentKey: targetKey }),
          listSkills(apiBaseUrl, selectedGameId, token)
        ]);
        if (kind === 'character') next.characters = relations.data.items as CharacterSkillRelation[];
        else next.equipment = relations.data.items as EquipmentSkillRelation[];
        next.skillOptions = skillRelationOptionsFromResponse(skills.data, selectedGameId, 'skill');
      }
      if (currentScope.current === scope && loadSerial.current === serial) setLoaded(next);
    } catch (cause) {
      if (currentScope.current === scope && loadSerial.current === serial) {
        setLoaded(null);
        setError(getErrorMessage(cause));
      }
    } finally {
      if (currentScope.current === scope && loadSerial.current === serial) setLoading(false);
    }
  }, [apiBaseUrl, kind, scope, selectedGameId, targetKey, token, visible]);

  useEffect(() => {
    currentScope.current = scope;
    loadSerial.current += 1;
    activeWrite.current = null;
    setLoaded(null);
    setLoading(false);
    setSaving(false);
    setError(null);
    setNotice(null);
    setDrafts(initialDrafts());
    setSortEdits({});
    dirtyCallback.current?.(false);
    void load();
    return () => {
      currentScope.current = '';
      loadSerial.current += 1;
    };
  }, [load, scope]);

  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => () => { dirtyCallback.current?.(false); }, []);

  const leave = (afterLeave: () => void) => {
    if (activeWrite.current === scope) return;
    const finish = () => {
      if (currentScope.current !== scope) return;
      loadSerial.current += 1;
      setDrafts(initialDrafts());
      setSortEdits({});
      dirtyCallback.current?.(false);
      afterLeave();
    };
    if (dirty) {
      Modal.confirm({
        title: '放弃未保存的修改？',
        content: '候选选择和未保存的排序将丢失。已经保存的挂载关系会保留。',
        okText: '放弃修改', cancelText: '继续编辑', onOk: finish
      });
    } else finish();
  };

  const close = () => leave(onClose);

  const openSkill = (row: RelationRow) => {
    if (!ready || !onEditSkill || kind === 'skill') return;
    leave(() => onEditSkill(row.skillKey));
  };

  const write = async (action: () => Promise<unknown>, afterSuccess: () => void, message: string) => {
    if (!ready || activeWrite.current === scope) return;
    activeWrite.current = scope;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (currentScope.current !== scope) return;
      afterSuccess();
      setNotice(message);
      await load();
    } catch (cause) {
      if (currentScope.current === scope) setError(getErrorMessage(cause));
    } finally {
      if (currentScope.current === scope) {
        activeWrite.current = null;
        setSaving(false);
      }
    }
  };

  const removeSortDraft = (identity: string) => {
    setSortEdits(previous => {
      const next = { ...previous };
      delete next[identity];
      return next;
    });
  };

  const addRelation = (ownerKind: SkillRelationOwnerKind, options: SkillRelationOption[]) => {
    if (!selectedGameId || !targetKey || !ready) return;
    const draft = drafts[ownerKind];
    let sortOrder: number;
    try {
      if (!options.some(option => option.key === draft.selectedKey)) throw new Error('请选择一个可用且尚未挂载的对象。');
      if (kind === 'skill' && data?.skillStatus !== 'ENABLED') throw new Error('当前技能已停用，不能新增挂载。');
      sortOrder = parseSkillRelationSortOrder(draft.sortOrder);
    } catch (cause) {
      setError(getErrorMessage(cause));
      return;
    }
    const ownerKey = kind === 'skill' ? draft.selectedKey : targetKey;
    const skillKey = kind === 'skill' ? targetKey : draft.selectedKey;
    void write(
      () => ownerKind === 'character'
        ? createCharacterSkillRelation(apiBaseUrl, selectedGameId, token, { characterKey: ownerKey, skillKey, sortOrder })
        : createEquipmentSkillRelation(apiBaseUrl, selectedGameId, token, { equipmentKey: ownerKey, skillKey, sortOrder }),
      () => setDrafts(previous => ({ ...previous, [ownerKind]: emptySkillRelationDraft() })),
      '技能挂载已添加。'
    );
  };

  const saveSort = (row: RelationRow) => {
    if (!selectedGameId) return;
    let sortOrder: number;
    try { sortOrder = parseSkillRelationSortOrder(sortEdits[row.identity] ?? String(row.sortOrder)); }
    catch (cause) { setError(getErrorMessage(cause)); return; }
    void write(
      () => row.kind === 'character'
        ? updateCharacterSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey, token, { sortOrder })
        : updateEquipmentSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey, token, { sortOrder }),
      () => removeSortDraft(row.identity), '挂载顺序已保存。'
    );
  };

  const removeRelation = (row: RelationRow) => {
    if (!selectedGameId) return;
    void write(
      () => row.kind === 'character'
        ? deleteCharacterSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey, token)
        : deleteEquipmentSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey, token),
      () => removeSortDraft(row.identity), '技能挂载已移除。'
    );
  };

  const renderSection = (ownerKind: SkillRelationOwnerKind) => {
    const ownerLabel = ownerKind === 'character' ? '角色' : '装备';
    const rows: RelationRow[] = ownerKind === 'character'
      ? (data?.characters ?? []).map(item => ({
        identity: skillRelationIdentity(ownerKind, item.characterKey, item.skillKey),
        kind: ownerKind, ownerKey: item.characterKey, skillKey: item.skillKey,
        name: kind === 'skill' ? item.characterName : item.skillName,
        key: kind === 'skill' ? item.characterKey : item.skillKey,
        skillStatus: item.skillStatus, sortOrder: item.sortOrder
      }))
      : (data?.equipment ?? []).map(item => ({
        identity: skillRelationIdentity(ownerKind, item.equipmentKey, item.skillKey),
        kind: ownerKind, ownerKey: item.equipmentKey, skillKey: item.skillKey,
        name: kind === 'skill' ? item.equipmentName : item.skillName,
        key: kind === 'skill' ? item.equipmentKey : item.skillKey,
        skillStatus: item.skillStatus, sortOrder: item.sortOrder
      }));
    const options = availableSkillRelationOptions(
      kind === 'skill' ? (ownerKind === 'character' ? data?.characterOptions ?? [] : data?.equipmentOptions ?? []) : data?.skillOptions ?? [],
      rows.map(row => row.key)
    );
    const canAdd = ready && (kind !== 'skill' || data?.skillStatus === 'ENABLED');
    const draft = drafts[ownerKind];
    const columns: TableColumnProps[] = [
      { title: kind === 'skill' ? `${ownerLabel}名称` : '技能名称', dataIndex: 'name' },
      { title: '稳定标识', dataIndex: 'key' },
      {
        title: '技能状态', width: 105,
        render: (_value, row: RelationRow) => row.skillStatus === 'ENABLED'
          ? <Tag color="green">启用</Tag> : <Tag color="gray">已停用</Tag>
      },
      {
        title: '排序', width: 150,
        render: (_value, row: RelationRow) => (
          <Input
            aria-label={`${row.name}排序`}
            value={sortEdits[row.identity] ?? String(row.sortOrder)}
            disabled={!ready}
            onChange={value => setSortEdits(previous => {
              const next = { ...previous };
              if (value === String(row.sortOrder)) delete next[row.identity];
              else next[row.identity] = value;
              return next;
            })}
          />
        )
      },
      {
        title: '操作', width: onEditSkill && kind !== 'skill' ? 280 : 180,
        render: (_value, row: RelationRow) => (
          <Space size="mini">
            {onEditSkill && kind !== 'skill' ? <Button size="mini" type="primary" disabled={!ready} onClick={() => openSkill(row)}>录入技能</Button> : null}
            <Button size="mini" disabled={!ready || sortEdits[row.identity] === undefined} onClick={() => saveSort(row)}>保存排序</Button>
            <Button size="mini" status="danger" disabled={!ready} onClick={() => removeRelation(row)}>移除</Button>
          </Space>
        )
      }
    ];
    return (
      <section key={ownerKind} aria-label={`${ownerLabel}挂载`} style={{ marginBottom: 20 }}>
        {kind === 'skill' ? <Typography.Title heading={6}>{ownerLabel}挂载</Typography.Title> : null}
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            aria-label={kind === 'skill' ? `选择挂载${ownerLabel}` : `选择${ownerLabel}技能`}
            placeholder={kind === 'skill' ? `选择${ownerLabel}` : '选择启用技能'}
            style={{ width: 370 }}
            showSearch
            filterOption={(input, option) => {
              const candidate = options.find(item => item.key === option.props.value);
              return candidate ? skillRelationOptionMatches(candidate, input) : false;
            }}
            allowClear
            disabled={!canAdd}
            value={draft.selectedKey || undefined}
            onChange={value => setDrafts(previous => ({ ...previous, [ownerKind]: { ...previous[ownerKind], selectedKey: value ?? '' } }))}
            options={options.map(option => ({ value: option.key, label: `${option.name} · ${option.key} · ${option.status === null ? '可用' : '启用'}` }))}
          />
          <Input
            aria-label={`${ownerLabel}新增排序`}
            addBefore="排序"
            style={{ width: 190 }}
            value={draft.sortOrder}
            disabled={!canAdd}
            onChange={value => setDrafts(previous => ({ ...previous, [ownerKind]: { ...previous[ownerKind], sortOrder: value } }))}
          />
          <Button type="primary" disabled={!canAdd || !draft.selectedKey} onClick={() => addRelation(ownerKind, options)}>
            添加{ownerLabel}挂载
          </Button>
        </Space>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={rows}
          rowKey="identity"
          pagination={false}
          noDataElement={<Empty description="暂无技能挂载" />}
        />
      </section>
    );
  };

  return (
    <Modal
      title={`${kind === 'skill' ? '挂载对象' : '关联技能'}${target ? ` · ${target.name}` : ''}`}
      visible={visible && target !== null}
      style={{ width: 'calc(100vw - 80px)', maxWidth: 1150 }}
      maskClosable={false}
      onCancel={close}
      footer={<Button onClick={close} disabled={saving}>关闭</Button>}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button loading={loading} disabled={saving || !selectedGameId || !token} onClick={() => void load()}>刷新</Button>
      </div>
      {!token ? <Alert type="warning" content="请先配置管理令牌。" style={{ marginBottom: 12 }} /> : null}
      {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
      {notice ? <Alert type="success" content={notice} style={{ marginBottom: 12 }} /> : null}
      {data?.skillStatus === 'DISABLED' ? (
        <Alert type="warning" content="当前技能已停用，已有挂载仍可调整顺序或移除，不能新增挂载。" style={{ marginBottom: 12 }} />
      ) : null}
      {kind === 'character' || kind === 'skill' ? renderSection('character') : null}
      {kind === 'equipment' || kind === 'skill' ? renderSection('equipment') : null}
    </Modal>
  );
}
