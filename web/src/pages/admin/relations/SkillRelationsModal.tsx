import { Alert, Button, Empty, Input, Modal, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage, getErrorMessageWithContext } from '../../../services/apiClient';
import { getBuildOption, listBuildOptions, listBuildSystems } from '../../../services/buildClient';
import { listCharacters } from '../../../services/characterClient';
import { listEquipment } from '../../../services/equipmentClient';
import { getSkill, listSkills } from '../../../services/skillClient';
import {
  createBuildOptionSkillRelation,
  createCharacterSkillRelation,
  createEquipmentSkillRelation,
  deleteBuildOptionSkillRelation,
  deleteCharacterSkillRelation,
  deleteEquipmentSkillRelation,
  listBuildOptionSkillRelations,
  listCharacterSkillRelations,
  listEquipmentSkillRelations,
  updateBuildOptionSkillRelation,
  updateCharacterSkillRelation,
  updateEquipmentSkillRelation
} from '../../../services/skillRelationClient';
import {
  BUILD_SKILL_LEVEL_MODE_LABELS,
  BUILD_SKILL_LEVEL_MODES,
  type BuildConfigurationMode,
  type BuildSkillLevelMode,
  type BuildSystem
} from '../../../types/build';
import type { SkillStatus } from '../../../types/skill';
import type {
  BuildOptionSkillRelation,
  CharacterSkillRelation,
  EquipmentSkillRelation,
  SkillRelationOwnerKind,
  SkillRelationTarget,
  UpdateBuildOptionSkillRelationRequest
} from '../../../types/skillRelation';
import { buildWriteResultIsUncertain, validateGrantDraft } from '../builds/buildForm';
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
  systemKey?: string;
  activationRank?: number;
  skillLevelMode?: BuildSkillLevelMode;
  fixedSkillLevel?: number | null;
};

type GrantEdit = { activationRank: string; skillLevelMode: BuildSkillLevelMode; fixedSkillLevel: string };
type BuildGrantIdentity = { systemKey: string; optionKey: string; skillKey: string };
type BuildGrantExpectation = BuildGrantIdentity & {
  activationRank: number;
  skillLevelMode: BuildSkillLevelMode;
  fixedSkillLevel: number | null;
  sortOrder: number;
};
type GrantReadbackExpectation =
  | { kind: 'present'; grant: BuildGrantExpectation }
  | { kind: 'absent'; identity: BuildGrantIdentity };
type PendingGrantReadback = {
  expectation: GrantReadbackExpectation;
  afterSuccess: () => void;
  message: string;
};

function grantMatches(grant: BuildOptionSkillRelation, expected: BuildGrantExpectation): boolean {
  return grant.systemKey === expected.systemKey && grant.optionKey === expected.optionKey
    && grant.skillKey === expected.skillKey && grant.activationRank === expected.activationRank
    && grant.skillLevelMode === expected.skillLevelMode && grant.fixedSkillLevel === expected.fixedSkillLevel
    && grant.sortOrder === expected.sortOrder;
}

function grantReadbackMatches(grants: BuildOptionSkillRelation[], expected: GrantReadbackExpectation): boolean {
  if (expected.kind === 'present') return grants.some(grant => grantMatches(grant, expected.grant));
  return !grants.some(grant => grant.systemKey === expected.identity.systemKey
    && grant.optionKey === expected.identity.optionKey && grant.skillKey === expected.identity.skillKey);
}

type LoadedRelations = {
  scope: string;
  characters: CharacterSkillRelation[];
  equipment: EquipmentSkillRelation[];
  buildGrants: BuildOptionSkillRelation[];
  characterOptions: SkillRelationOption[];
  equipmentOptions: SkillRelationOption[];
  skillOptions: SkillRelationOption[];
  systems: BuildSystem[];
  skillStatus: SkillStatus | null;
  skillMaxLevel: number | null;
};

function initialDrafts(): Record<SkillRelationOwnerKind, SkillRelationAddDraft> {
  return { character: emptySkillRelationDraft(), equipment: emptySkillRelationDraft(), buildOption: emptySkillRelationDraft() };
}

export function SkillRelationsModal({
  visible, target, apiBaseUrl, selectedGameId, onClose, onDirtyChange, onEditSkill
}: SkillRelationsModalProps) {
  const kind = target?.kind;
  const targetKey = target?.key;

  const scope = JSON.stringify([visible, apiBaseUrl, selectedGameId, kind, targetKey, target?.systemKey]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const loadSerial = useRef(0);
  const optionSerial = useRef(0);
  const activeWrite = useRef<string | null>(null);
  const uncertainBuildGrant = useRef<PendingGrantReadback | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const [loaded, setLoaded] = useState<LoadedRelations | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [sortEdits, setSortEdits] = useState<Record<string, string>>({});
  const [grantEdits, setGrantEdits] = useState<Record<string, GrantEdit>>({});
  const [optionCatalog, setOptionCatalog] = useState<SkillRelationOption[]>([]);
  const [uncertainGrantPending, setUncertainGrantPending] = useState(false);
  const dirty = skillRelationDraftIsDirty(drafts, sortEdits) || Object.keys(grantEdits).length > 0;
  const data = loaded?.scope === scope ? loaded : null;
  const ready = Boolean(data && !loading && !saving && !uncertainGrantPending && selectedGameId);

  const load = useCallback(async (): Promise<LoadedRelations | null> => {
    const serial = ++loadSerial.current;
    if (!visible || !selectedGameId || !kind || !targetKey) return null;
    setLoading(true);
    setError(null);
    const next: LoadedRelations = {
      scope, characters: [], equipment: [], buildGrants: [], characterOptions: [], equipmentOptions: [],
      skillOptions: [], systems: [], skillStatus: null, skillMaxLevel: null
    };
    try {
      if (kind === 'buildOption' && !target?.systemKey) throw new Error('构筑可选项缺少所属构筑系统。');
      if (kind === 'skill') {
        const [characters, equipment, grants, characterOptions, equipmentOptions, systems, skill] = await Promise.all([
          listCharacterSkillRelations(apiBaseUrl, selectedGameId, { skillKey: targetKey }),
          listEquipmentSkillRelations(apiBaseUrl, selectedGameId, { skillKey: targetKey }),
          listBuildOptionSkillRelations(apiBaseUrl, selectedGameId, { skillKey: targetKey }),
          listCharacters(apiBaseUrl, selectedGameId),
          listEquipment(apiBaseUrl, selectedGameId),
          listBuildSystems(apiBaseUrl, selectedGameId),
          getSkill(apiBaseUrl, selectedGameId, targetKey)
        ]);
        next.characters = characters.data.items;
        next.equipment = equipment.data.items;
        next.buildGrants = grants.data.items;
        next.characterOptions = skillRelationOptionsFromResponse(characterOptions.data, selectedGameId, 'character');
        next.equipmentOptions = skillRelationOptionsFromResponse(equipmentOptions.data, selectedGameId, 'equipment');
        next.systems = systems.data.items;
        const currentSkill = skillRelationOptionsFromResponse({ items: [skill.data], total: 1 }, selectedGameId, 'skill')[0];
        if (!currentSkill || currentSkill.key !== targetKey) throw new Error('当前技能响应不符合接口约定。');
        next.skillStatus = currentSkill.status;
        next.skillMaxLevel = currentSkill.maxLevel ?? null;
      } else {
        const [relations, skills] = await Promise.all([
          kind === 'character'
            ? listCharacterSkillRelations(apiBaseUrl, selectedGameId, { characterKey: targetKey })
            : kind === 'buildOption'
              ? listBuildOptionSkillRelations(apiBaseUrl, selectedGameId, { systemKey: target?.systemKey, optionKey: targetKey })
              : listEquipmentSkillRelations(apiBaseUrl, selectedGameId, { equipmentKey: targetKey }),
          listSkills(apiBaseUrl, selectedGameId)
        ]);
        if (kind === 'character') next.characters = relations.data.items as CharacterSkillRelation[];
        else if (kind === 'equipment') next.equipment = relations.data.items as EquipmentSkillRelation[];
        else next.buildGrants = relations.data.items as BuildOptionSkillRelation[];
        next.skillOptions = skillRelationOptionsFromResponse(skills.data, selectedGameId, 'skill');
      }
      if (currentScope.current === scope && loadSerial.current === serial) {
        setLoaded(next);
        const pending = uncertainBuildGrant.current;
        if (pending) {
          const found = grantReadbackMatches(next.buildGrants, pending.expectation);
          uncertainBuildGrant.current = null;
          setUncertainGrantPending(false);
          if (found) {
            pending.afterSuccess();
            setNotice(`${pending.message.replace(/并回读确认。$|。$/, '')}，写入结果已通过独立回读确认。`);
            setError(null);
          } else {
            setError(pending.expectation.kind === 'present'
              ? '独立回读未返回与本次写入一致的技能授予，原草稿已保留；核对后可以重新提交。'
              : '独立回读仍返回这条技能授予，删除结果尚未确认；不会重复提交。');
          }
        }
        return next;
      }
      return null;
    } catch (cause) {
      if (currentScope.current === scope && loadSerial.current === serial) {
        setLoaded(null);
        setError(getErrorMessageWithContext(cause, uncertainBuildGrant.current ? '写入结果不明，独立回读失败；请刷新确认，暂不重复提交。' : ''));
      }
      return null;
    } finally {
      if (currentScope.current === scope && loadSerial.current === serial) setLoading(false);
    }
  }, [apiBaseUrl, kind, scope, selectedGameId, target?.systemKey, targetKey, visible]);

  useEffect(() => {
    const serial = ++optionSerial.current;
    if (!visible || kind !== 'skill' || !selectedGameId || !drafts.buildOption.systemKey) {
      setOptionCatalog([]);
      return;
    }
    let current = true;
    void listBuildOptions(apiBaseUrl, selectedGameId, drafts.buildOption.systemKey).then(result => {
      if (!current || serial !== optionSerial.current) return;
      setOptionCatalog(skillRelationOptionsFromResponse(result.data, selectedGameId, 'buildOption'));
    }).catch(cause => {
      if (current && serial === optionSerial.current) { setOptionCatalog([]); setError(getErrorMessage(cause)); }
    });
    return () => { current = false; };
  }, [apiBaseUrl, drafts.buildOption.systemKey, kind, selectedGameId, visible]);

  useEffect(() => {
    currentScope.current = scope;
    loadSerial.current += 1;
    activeWrite.current = null;
    uncertainBuildGrant.current = null;
    setUncertainGrantPending(false);
    setLoaded(null);
    setLoading(false);
    setSaving(false);
    setError(null);
    setNotice(null);
    setDrafts(initialDrafts());
    setSortEdits({});
    setGrantEdits({});
    setOptionCatalog([]);
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
      setGrantEdits({});
      dirtyCallback.current?.(false);
      afterLeave();
    };
    if (dirty) {
      Modal.confirm({
        title: '放弃未保存的修改？',
        content: '候选选择和未保存的授予修改将丢失。已经保存的挂载关系会保留。',
        okText: '放弃修改', cancelText: '继续编辑', onOk: finish
      });
    } else finish();
  };

  const close = () => leave(onClose);
  const openSkill = (row: RelationRow) => {
    if (!ready || !onEditSkill || kind === 'skill') return;
    leave(() => onEditSkill(row.skillKey));
  };
  const write = async (
    action: () => Promise<unknown>, afterSuccess: () => void, message: string,
    readbackExpectation?: () => GrantReadbackExpectation | undefined
  ) => {
    if (!ready || activeWrite.current === scope) return;
    activeWrite.current = scope;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (currentScope.current !== scope) return;
      const expected = readbackExpectation?.();
      const readback = await load();
      if (!readback) return;
      if (currentScope.current !== scope) return;
      if (expected && !grantReadbackMatches(readback.buildGrants, expected)) {
        setError('独立回读未返回与本次写入一致的技能授予，原草稿已保留；不会重复提交。');
        return;
      }
      afterSuccess();
      setNotice(message);
    } catch (cause) {
      if (currentScope.current === scope) {
        const expected = readbackExpectation?.();
        if (expected && buildWriteResultIsUncertain(cause)) {
          uncertainBuildGrant.current = { expectation: expected, afterSuccess, message };
          setUncertainGrantPending(true);
          setError('新增授予的写入结果不明，正在按系统、可选项和技能重新读取；不会重复提交。');
          await load();
        } else {
          setError(getErrorMessage(cause));
        }
      }
    } finally {
      if (currentScope.current === scope) {
        activeWrite.current = null;
        setSaving(false);
      }
    }
  };
  const removeSortDraft = (identity: string) => {
    setSortEdits(previous => { const next = { ...previous }; delete next[identity]; return next; });
    setGrantEdits(previous => { const next = { ...previous }; delete next[identity]; return next; });
  };

  const addRelation = (ownerKind: SkillRelationOwnerKind, options: SkillRelationOption[]) => {
    if (!selectedGameId || !targetKey || !ready) return;
    const draft = drafts[ownerKind];
    let sortOrder: number;
    try {
      if (ownerKind !== 'buildOption' && !options.some(option => option.key === draft.selectedKey)) throw new Error('请选择一个可用且尚未挂载的对象。');
      if (kind === 'skill' && data?.skillStatus !== 'ENABLED') throw new Error('当前技能已停用，不能新增挂载。');
      sortOrder = parseSkillRelationSortOrder(draft.sortOrder);
    } catch (cause) {
      setError(getErrorMessage(cause));
      return;
    }
    const ownerKey = kind === 'skill' ? draft.selectedKey : targetKey;
    const skillKey = kind === 'skill' ? targetKey : draft.selectedKey;
    if (ownerKind !== 'buildOption') {
      void write(
        () => ownerKind === 'character'
          ? createCharacterSkillRelation(apiBaseUrl, selectedGameId, { characterKey: ownerKey, skillKey, sortOrder })
          : createEquipmentSkillRelation(apiBaseUrl, selectedGameId, { equipmentKey: ownerKey, skillKey, sortOrder }),
        () => setDrafts(previous => ({ ...previous, [ownerKind]: emptySkillRelationDraft() })),
        '技能挂载已添加。'
      );
      return;
    }
    const systemKey = kind === 'skill' ? draft.systemKey : target?.systemKey;
    const option = kind === 'skill' ? optionCatalog.find(item => item.key === ownerKey && item.systemKey === systemKey) : null;
    const mode = kind === 'buildOption' ? target?.configurationMode : data?.systems.find(system => system.systemKey === systemKey)?.configurationMode;
    const maxRank = kind === 'buildOption' ? target?.maxRank : option?.maxRank;
    const skillOption = data?.skillOptions.find(item => item.key === skillKey);
    if (!systemKey || !mode || !maxRank || (kind === 'skill' && !option)) {
      setError('请选择当前构筑系统中的可选项。');
      return;
    }
    const grantErrors = validateGrantDraft({
      activationRank: draft.activationRank, skillLevelMode: draft.skillLevelMode, fixedSkillLevel: draft.fixedSkillLevel,
      sortOrder: draft.sortOrder, maxRank, mode, skillMaxLevel: kind === 'skill' ? data?.skillMaxLevel ?? null : skillOption?.maxLevel ?? null
    });
    if (Object.keys(grantErrors).length) { setError(Object.values(grantErrors)[0] ?? '技能授予不合法。'); return; }
    const body = {
      systemKey, optionKey: ownerKey, skillKey, activationRank: Number(draft.activationRank),
      skillLevelMode: draft.skillLevelMode, fixedSkillLevel: draft.skillLevelMode === 'FIXED' ? Number(draft.fixedSkillLevel) : null, sortOrder
    };
    void write(
      () => createBuildOptionSkillRelation(apiBaseUrl, selectedGameId, body),
      () => setDrafts(previous => ({ ...previous, buildOption: emptySkillRelationDraft() })),
      '技能授予已添加并回读确认。',
      () => ({ kind: 'present', grant: body })
    );
  };

  const grantBody = async (row: RelationRow, sortOrder: number): Promise<UpdateBuildOptionSkillRelationRequest> => {
    if (row.skillStatus !== 'ENABLED') {
      return { activationRank: row.activationRank ?? 1, skillLevelMode: row.skillLevelMode ?? 'FIXED', fixedSkillLevel: row.fixedSkillLevel ?? null, sortOrder };
    }
    const edit = grantEdits[row.identity];
    const activationRank = edit?.activationRank ?? String(row.activationRank ?? '');
    const skillLevelMode = edit?.skillLevelMode ?? row.skillLevelMode ?? 'FIXED';
    const fixedSkillLevel = edit?.fixedSkillLevel ?? (row.fixedSkillLevel == null ? '' : String(row.fixedSkillLevel));
    if (!selectedGameId || !row.systemKey) throw new Error('构筑可选项缺少所属构筑系统。');
    let maxRank = kind === 'buildOption' ? target?.maxRank : optionCatalog.find(item => item.systemKey === row.systemKey && item.key === row.ownerKey)?.maxRank;
    if (maxRank === undefined) maxRank = (await getBuildOption(apiBaseUrl, selectedGameId, row.systemKey, row.ownerKey)).data.maxRank;
    const mode: BuildConfigurationMode | undefined = kind === 'buildOption'
      ? target?.configurationMode
      : data?.systems.find(system => system.systemKey === row.systemKey)?.configurationMode;
    if (!mode) throw new Error('构筑系统配置方式未返回。');
    let skillMaxLevel = kind === 'skill' ? data?.skillMaxLevel ?? null : data?.skillOptions.find(item => item.key === row.skillKey)?.maxLevel ?? null;
    if (skillMaxLevel === null) skillMaxLevel = (await getSkill(apiBaseUrl, selectedGameId, row.skillKey)).data.maxLevel;
    const grantErrors = validateGrantDraft({ activationRank, skillLevelMode, fixedSkillLevel, sortOrder: String(sortOrder), maxRank, mode, skillMaxLevel });
    if (Object.keys(grantErrors).length) throw new Error(Object.values(grantErrors)[0] ?? '技能授予不合法。');
    return { activationRank: Number(activationRank), skillLevelMode, fixedSkillLevel: skillLevelMode === 'FIXED' ? Number(fixedSkillLevel) : null, sortOrder };
  };

  const saveSort = (row: RelationRow) => {
    if (!selectedGameId) return;
    let sortOrder: number;
    try { sortOrder = parseSkillRelationSortOrder(sortEdits[row.identity] ?? String(row.sortOrder)); }
    catch (cause) { setError(getErrorMessage(cause)); return; }
    let expected: GrantReadbackExpectation | undefined;
    void write(async () => {
      if (row.kind === 'character') return updateCharacterSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey, { sortOrder });
      if (row.kind === 'equipment') return updateEquipmentSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey, { sortOrder });
      const body = await grantBody(row, sortOrder);
      expected = { kind: 'present', grant: { systemKey: row.systemKey ?? '', optionKey: row.ownerKey, skillKey: row.skillKey, ...body } };
      return updateBuildOptionSkillRelation(apiBaseUrl, selectedGameId, row.systemKey ?? '', row.ownerKey, row.skillKey, body);
    }, () => removeSortDraft(row.identity), row.kind === 'buildOption' ? '技能授予已保存。' : '挂载顺序已保存。',
    row.kind === 'buildOption' ? () => expected : undefined);
  };

  const removeRelation = (row: RelationRow) => {
    if (!selectedGameId) return;
    const expected = row.kind === 'buildOption' ? () => ({
      kind: 'absent' as const,
      identity: { systemKey: row.systemKey ?? '', optionKey: row.ownerKey, skillKey: row.skillKey }
    }) : undefined;
    void write(
      () => row.kind === 'character'
        ? deleteCharacterSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey)
        : row.kind === 'equipment'
          ? deleteEquipmentSkillRelation(apiBaseUrl, selectedGameId, row.ownerKey, row.skillKey)
          : deleteBuildOptionSkillRelation(apiBaseUrl, selectedGameId, row.systemKey ?? '', row.ownerKey, row.skillKey),
      () => removeSortDraft(row.identity), row.kind === 'buildOption' ? '技能授予已移除。' : '技能挂载已移除。', expected
    );
  };

  const renderSection = (ownerKind: SkillRelationOwnerKind) => {
    const ownerLabel = ownerKind === 'character' ? '角色' : ownerKind === 'equipment' ? '装备' : '构筑可选项';
    const rows: RelationRow[] = ownerKind === 'character'
      ? (data?.characters ?? []).map(item => ({
        identity: skillRelationIdentity(ownerKind, item.characterKey, item.skillKey),
        kind: ownerKind, ownerKey: item.characterKey, skillKey: item.skillKey,
        name: kind === 'skill' ? item.characterName : item.skillName,
        key: kind === 'skill' ? item.characterKey : item.skillKey,
        skillStatus: item.skillStatus, sortOrder: item.sortOrder
      }))
      : ownerKind === 'equipment' ? (data?.equipment ?? []).map(item => ({
        identity: skillRelationIdentity(ownerKind, item.equipmentKey, item.skillKey),
        kind: ownerKind, ownerKey: item.equipmentKey, skillKey: item.skillKey,
        name: kind === 'skill' ? item.equipmentName : item.skillName,
        key: kind === 'skill' ? item.equipmentKey : item.skillKey,
        skillStatus: item.skillStatus, sortOrder: item.sortOrder
      })) : (data?.buildGrants ?? []).map(item => ({
        identity: skillRelationIdentity(ownerKind, item.optionKey, item.skillKey, item.systemKey),
        kind: ownerKind, ownerKey: item.optionKey, skillKey: item.skillKey,
        name: kind === 'skill' ? item.optionName : item.skillName,
        key: kind === 'skill' ? item.optionKey : item.skillKey,
        skillStatus: item.skillStatus, sortOrder: item.sortOrder, systemKey: item.systemKey,
        activationRank: item.activationRank, skillLevelMode: item.skillLevelMode, fixedSkillLevel: item.fixedSkillLevel
      }));
    const draft = drafts[ownerKind];
    const existingKeys = ownerKind === 'buildOption' && kind === 'skill'
      ? rows.filter(row => row.systemKey === draft.systemKey).map(row => row.key)
      : rows.map(row => row.key);
    const options = availableSkillRelationOptions(
      kind === 'skill'
        ? ownerKind === 'character' ? data?.characterOptions ?? [] : ownerKind === 'equipment' ? data?.equipmentOptions ?? [] : optionCatalog
        : data?.skillOptions ?? [],
      existingKeys
    );
    const canAdd = ready && (kind !== 'skill' || data?.skillStatus === 'ENABLED');
    const selectedMode = ownerKind !== 'buildOption' ? undefined : kind === 'buildOption'
      ? target?.configurationMode
      : data?.systems.find(system => system.systemKey === draft.systemKey)?.configurationMode;
    const columns: TableColumnProps[] = [
      {
        title: kind === 'skill' ? `${ownerLabel}名称` : '技能名称',
        render: (_value, row: RelationRow) => ownerKind === 'buildOption' && kind === 'skill' ? <div>
          <div>{row.name}（{row.key}）</div>
          <Typography.Text type="secondary">{systemLabel(data?.systems ?? [], row.systemKey)}</Typography.Text>
        </div> : `${row.name}`
      },
      ...(ownerKind === 'buildOption' && kind !== 'skill' ? [] : [{ title: '稳定标识', dataIndex: 'key' }]),
      ...(ownerKind === 'buildOption' ? [
        { title: '生效投入等级', width: 140, render: (_value: unknown, row: RelationRow) => grantField(row, 'activationRank') },
        { title: '技能等级方式', width: 180, render: (_value: unknown, row: RelationRow) => grantField(row, 'mode') },
        { title: '固定技能等级', width: 140, render: (_value: unknown, row: RelationRow) => grantField(row, 'fixed') }
      ] : []),
      {
        title: '技能状态', width: 105,
        render: (_value, row: RelationRow) => row.skillStatus === 'ENABLED' ? <Tag color="green">启用</Tag> : <Tag color="gray">已停用</Tag>
      },
      {
        title: '排序', width: 140,
        render: (_value, row: RelationRow) => (
          <Input aria-label={`${row.name}排序`} value={sortEdits[row.identity] ?? String(row.sortOrder)} disabled={!ready}
            onChange={value => setSortEdits(previous => {
              const next = { ...previous };
              if (value === String(row.sortOrder)) delete next[row.identity];
              else next[row.identity] = value;
              return next;
            })} />
        )
      },
      {
        title: '操作', width: onEditSkill && kind !== 'skill' ? 280 : 180,
        render: (_value, row: RelationRow) => (
          <Space size="mini">
            {onEditSkill && kind !== 'skill' ? <Button size="mini" type="primary" disabled={!ready} onClick={() => openSkill(row)}>录入技能</Button> : null}
            <Button size="mini" disabled={!ready || (sortEdits[row.identity] === undefined && grantEdits[row.identity] === undefined)} onClick={() => saveSort(row)}>
              {ownerKind === 'buildOption' && row.skillStatus === 'ENABLED' ? '保存授予' : '保存排序'}
            </Button>
            <Button size="mini" status="danger" disabled={!ready} onClick={() => removeRelation(row)}>移除</Button>
          </Space>
        )
      }
    ];
    return (
      <section key={ownerKind} aria-label={ownerKind === 'buildOption' ? '构筑可选项挂载' : `${ownerLabel}挂载`} style={{ marginBottom: 20 }}>
        {kind === 'skill' ? <Typography.Title heading={6}>{ownerLabel}挂载</Typography.Title> : null}
        {ownerKind === 'buildOption' ? <Typography.Paragraph type="secondary">停用技能的既有授予仍可看到，只能保持授予内容并调整顺序，或解除授予。</Typography.Paragraph> : null}
        <Space wrap style={{ marginBottom: 12 }}>
          {ownerKind === 'buildOption' && kind === 'skill' ? <Select aria-label="选择构筑系统" placeholder="选择构筑系统" style={{ width: 280 }} showSearch allowClear disabled={!canAdd}
            value={draft.systemKey || undefined}
            options={(data?.systems ?? []).map(system => ({ value: system.systemKey, label: `${system.name} · ${system.systemKey}` }))}
            onChange={value => setDrafts(previous => ({ ...previous, buildOption: { ...emptySkillRelationDraft(), systemKey: value ?? '', sortOrder: previous.buildOption.sortOrder } }))} /> : null}
          <Select
            aria-label={ownerKind === 'buildOption' ? (kind === 'skill' ? '选择构筑可选项' : '选择构筑可选项技能') : kind === 'skill' ? `选择挂载${ownerLabel}` : `选择${ownerLabel}技能`}
            placeholder={ownerKind === 'buildOption' && kind === 'skill' ? '选择可选项' : kind === 'skill' ? `选择${ownerLabel}` : '选择启用技能'}
            style={{ width: 370 }} showSearch allowClear disabled={!canAdd || (ownerKind === 'buildOption' && kind === 'skill' && !draft.systemKey)}
            filterOption={(input, option) => {
              const candidate = options.find(item => item.key === option.props.value);
              return candidate ? skillRelationOptionMatches(candidate, input) : false;
            }}
            value={draft.selectedKey || undefined}
            onChange={value => setDrafts(previous => ({ ...previous, [ownerKind]: { ...previous[ownerKind], selectedKey: value ?? '' } }))}
            options={options.map(option => ({ value: option.key, label: `${option.name} · ${option.key} · ${option.status === null ? '可用' : '启用'}` }))} />
          {ownerKind === 'buildOption' ? <>
            <Input aria-label="生效投入等级" addBefore="生效等级" style={{ width: 180 }} value={draft.activationRank} disabled={!canAdd}
              onChange={activationRank => setDrafts(previous => ({ ...previous, buildOption: { ...previous.buildOption, activationRank } }))} />
            <Select aria-label="技能等级方式" style={{ width: 220 }} disabled={!canAdd || selectedMode === 'SLOT_SELECTION'} value={draft.skillLevelMode}
              options={(selectedMode === 'SLOT_SELECTION' ? ['FIXED'] as const : BUILD_SKILL_LEVEL_MODES).map(value => ({ value, label: BUILD_SKILL_LEVEL_MODE_LABELS[value] }))}
              onChange={(skillLevelMode: BuildSkillLevelMode) => setDrafts(previous => ({ ...previous, buildOption: { ...previous.buildOption, skillLevelMode, fixedSkillLevel: skillLevelMode === 'SAME_AS_OPTION' ? '' : previous.buildOption.fixedSkillLevel || '1' } }))} />
            {draft.skillLevelMode === 'FIXED' ? <Input aria-label="固定技能等级" addBefore="固定等级" style={{ width: 180 }} value={draft.fixedSkillLevel} disabled={!canAdd}
              onChange={fixedSkillLevel => setDrafts(previous => ({ ...previous, buildOption: { ...previous.buildOption, fixedSkillLevel } }))} /> : <Typography.Text type="secondary">技能等级随可选项投入等级</Typography.Text>}
          </> : null}
          <Input aria-label={`${ownerLabel}新增排序`} addBefore="排序" style={{ width: 160 }} value={draft.sortOrder} disabled={!canAdd}
            onChange={value => setDrafts(previous => ({ ...previous, [ownerKind]: { ...previous[ownerKind], sortOrder: value } }))} />
          <Button type="primary" disabled={!canAdd || !draft.selectedKey || (ownerKind === 'buildOption' && kind === 'skill' && !draft.systemKey)} onClick={() => addRelation(ownerKind, options)}>
            {ownerKind === 'buildOption' ? '添加构筑可选项授予' : `添加${ownerLabel}挂载`}
          </Button>
        </Space>
        <Table className="data-table-shell" loading={loading} columns={columns} data={rows} rowKey="identity" pagination={false} noDataElement={<Empty description={ownerKind === 'buildOption' ? '暂无技能授予' : '暂无技能挂载'} />} />
      </section>
    );
  };

  const grantField = (row: RelationRow, field: 'activationRank' | 'mode' | 'fixed') => {
    const disabled = !ready || row.skillStatus !== 'ENABLED';
    const edit = grantEdits[row.identity];
    const mode = edit?.skillLevelMode ?? row.skillLevelMode ?? 'FIXED';
    const patch = (update: Partial<GrantEdit>) => setGrantEdits(previous => ({
      ...previous,
      [row.identity]: {
        activationRank: edit?.activationRank ?? String(row.activationRank ?? ''),
        skillLevelMode: edit?.skillLevelMode ?? row.skillLevelMode ?? 'FIXED',
        fixedSkillLevel: edit?.fixedSkillLevel ?? (row.fixedSkillLevel == null ? '' : String(row.fixedSkillLevel)),
        ...update
      }
    }));
    if (field === 'activationRank') return <Input aria-label={`${row.name}生效投入等级`} disabled={disabled} value={edit?.activationRank ?? String(row.activationRank ?? '')} onChange={activationRank => patch({ activationRank })} />;
    if (field === 'mode') {
      const rowMode = kind === 'buildOption'
        ? target?.configurationMode
        : data?.systems.find(system => system.systemKey === row.systemKey)?.configurationMode;
      return <Select aria-label={`${row.name}技能等级方式`} disabled={disabled || rowMode === 'SLOT_SELECTION'} value={mode}
        options={(rowMode === 'SLOT_SELECTION' ? ['FIXED'] as const : BUILD_SKILL_LEVEL_MODES).map(value => ({ value, label: BUILD_SKILL_LEVEL_MODE_LABELS[value] }))} onChange={(skillLevelMode: BuildSkillLevelMode) => patch({ skillLevelMode, fixedSkillLevel: skillLevelMode === 'SAME_AS_OPTION' ? '' : edit?.fixedSkillLevel || '1' })} />;
    }
    return mode === 'FIXED' ? <Input aria-label={`${row.name}固定技能等级`} disabled={disabled} value={edit?.fixedSkillLevel ?? (row.fixedSkillLevel == null ? '' : String(row.fixedSkillLevel))} onChange={fixedSkillLevel => patch({ fixedSkillLevel })} /> : <Typography.Text type="secondary">随投入等级</Typography.Text>;
  };

  return (
    <Modal title={`${kind === 'skill' ? '挂载对象' : '关联技能'}${target ? ` · ${target.name}` : ''}`} visible={visible && target !== null}
      style={{ width: 'calc(100vw - 80px)', maxWidth: 1280 }} maskClosable={false} onCancel={close} footer={<Button onClick={close} disabled={saving}>关闭</Button>}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button loading={loading} disabled={saving || !selectedGameId} onClick={() => void load()}>刷新</Button>
      </div>
      {<Alert type="warning" content="请先配置管理令牌。" style={{ marginBottom: 12 }} />}
      {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
      {notice ? <Alert type="success" content={notice} style={{ marginBottom: 12 }} /> : null}
      {data?.skillStatus === 'DISABLED' ? <Alert type="warning" content="当前技能已停用，已有挂载仍可调整顺序或移除，不能新增挂载。" style={{ marginBottom: 12 }} /> : null}
      {kind === 'character' || kind === 'skill' ? renderSection('character') : null}
      {kind === 'equipment' || kind === 'skill' ? renderSection('equipment') : null}
      {kind === 'buildOption' || kind === 'skill' ? renderSection('buildOption') : null}
    </Modal>
  );
}

function systemLabel(systems: BuildSystem[], systemKey: string | undefined): string {
  const system = systems.find(item => item.systemKey === systemKey);
  return system ? `系统 ${system.name}（${system.systemKey}）` : `系统 ${systemKey ?? ''}（名称未返回）`;
}
