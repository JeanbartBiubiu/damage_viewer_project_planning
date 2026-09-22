import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import { getAttribute } from '../../../services/attributeClient';
import { getSkillEffect } from '../../../services/skillEffectClient';
import type { AuthoringCheckReference } from '../../../types/characterAuthoringCheck';
import { loadAuthoringReferenceNames, referenceNameLabel, referenceSource, referenceTarget } from './authoringReferenceNames';

vi.mock('../../../services/attributeClient', () => ({ getAttribute: vi.fn() }));
vi.mock('../../../services/skillEffectClient', () => ({ getSkillEffect: vi.fn() }));
const context = { apiBaseUrl: 'http://example.invalid', gameId: 'game', token: 'test' };
const ref = (patch: Partial<AuthoringCheckReference> = {}): AuthoringCheckReference => ({
  sourceType: 'EFFECT', sourceSkillKey: 'q', sourceKey: 'hit', fieldPath: 'results[0].value',
  targetType: 'ATTRIBUTE', targetKey: 'ad', targetSkillKey: null, targetSubKey: null,
  ...patch
} as AuthoringCheckReference);
const response = (data: unknown) => ({ data, status: 200, etag: null });

beforeEach(() => { vi.resetAllMocks(); });

describe('录入检查引用名称', () => {
  it('来源和子结果共用一次详情，保留子项名称、稳定键与父对象停用状态', async () => {
    vi.mocked(getSkillEffect).mockResolvedValue(response({ name: '命中', status: 'DISABLED', results: [
      { resultKey: 'damage', name: '物理伤害' }
    ] }) as Awaited<ReturnType<typeof getSkillEffect>>);
    const row = ref({ targetType: 'RESULT', targetSkillKey: 'q', targetKey: 'hit', targetSubKey: 'damage' });
    const names = await loadAuthoringReferenceNames([row, row], context, () => true);
    expect(getSkillEffect).toHaveBeenCalledTimes(1);
    expect(referenceNameLabel(referenceSource(row), names)).toBe('命中（hit）（已停用）');
    expect(referenceNameLabel(referenceTarget(row), names)).toBe('物理伤害（hit/damage）（已停用）');
  });

  it('目录404与加载失败分别显示，成功部分不被整批失败覆盖', async () => {
    vi.mocked(getSkillEffect).mockResolvedValue(response({ name: '命中' }) as Awaited<ReturnType<typeof getSkillEffect>>);
    vi.mocked(getAttribute).mockImplementation(async (_api, _game, key) => {
      throw new ApiRequestError('failed', key === 'gone' ? 404 : 503);
    });
    const rows = [ref({ targetKey: 'gone' }), ref({ targetKey: 'offline' })];
    const names = await loadAuthoringReferenceNames(rows, context, () => true);
    expect(referenceNameLabel(referenceSource(rows[0]!), names)).toBe('命中（hit）');
    expect(referenceNameLabel(referenceTarget(rows[0]!), names)).toBe('目录缺失（gone）');
    expect(referenceNameLabel(referenceTarget(rows[1]!), names)).toBe('名称加载失败（offline）');
  });

  it('子项缺失不冒充父对象名称，重复子键报加载失败', async () => {
    vi.mocked(getSkillEffect).mockResolvedValue(response({ name: '命中', results: [
      { resultKey: 'duplicate', name: '第一项' }, { resultKey: 'duplicate', name: '第二项' }
    ] }) as Awaited<ReturnType<typeof getSkillEffect>>);
    const rows = ['gone', 'duplicate'].map(key => ref({ targetType: 'RESULT', targetSkillKey: 'q', targetKey: 'hit', targetSubKey: key }));
    const names = await loadAuthoringReferenceNames(rows, context, () => true);
    expect(referenceNameLabel(referenceTarget(rows[0]!), names)).toBe('目录缺失（hit/gone）');
    expect(referenceNameLabel(referenceTarget(rows[1]!), names)).toBe('名称加载失败（hit/duplicate）');
  });

  it('最多四个目录请求并行，上下文失效后停止发出排队请求', async () => {
    let current = true;
    let active = 0;
    let maxActive = 0;
    const release: (() => void)[] = [];
    vi.mocked(getSkillEffect).mockResolvedValue(response({ name: '命中' }) as Awaited<ReturnType<typeof getSkillEffect>>);
    vi.mocked(getAttribute).mockImplementation(async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise<void>(resolve => release.push(resolve));
      active--;
      return response({ name: '属性' }) as Awaited<ReturnType<typeof getAttribute>>;
    });
    const pending = loadAuthoringReferenceNames(Array.from({ length: 20 }, (_, i) => ref({ targetKey: `a${i}` })), context, () => current);
    await vi.waitFor(() => expect(release).toHaveLength(4));
    current = false;
    release.forEach(resolve => resolve());
    await pending;
    expect(maxActive).toBe(4);
    expect(getAttribute).toHaveBeenCalledTimes(4);
  });
});
