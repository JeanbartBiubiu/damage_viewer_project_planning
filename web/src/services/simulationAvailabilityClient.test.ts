import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulationAvailabilityEntry, SimulationAvailabilityResponse } from '../types/simulationAvailability';
import {
  getSimulationAvailability, parseSimulationAvailabilityResponse, SIMULATION_AVAILABILITY_IDENTITY, simulationAvailabilityPath
} from './simulationAvailabilityClient';

const entry = (key: string, equipment = false): SimulationAvailabilityEntry => ({
  key, status: 'READY', contentDigest: 'a'.repeat(64), issues: [], excludedSkillSources: [], verification: {
    ...SIMULATION_AVAILABILITY_IDENTITY, externalDigest: 'b'.repeat(64), matched: true, evidenceRefs: ['formal-run/scenario.json'],
    requiredCoverage: { scenario: 'one-way-combat-analysis-v1', sides: ['source', 'target'], characterLevels: [1, 2, 3],
      skills: [{ skillKey: 'actual_skill', levels: [1, 2] }], levelValidation: 'each-declared-level', allRequiredSourcesEnabled: true,
      sourceActiveStartedAndCompleted: true, relevantPassivesTriggered: true, equipmentMode: equipment ? 'single-item' : 'none' }
  }
});
const sample = (gameId = 'demo'): SimulationAvailabilityResponse => ({
  gameId, profile: 'combat-analysis-v1', digestVersion: 'simulation-availability-v1', scopeDigest: 'c'.repeat(64), sharedDigest: 'd'.repeat(64),
  characters: [entry('hero')], equipment: [entry('item', true)]
});

afterEach(() => vi.unstubAllGlobals());

describe('混合战斗计算可用性只读目录', () => {
  it('读取携带正式引擎和适配版本，复用基址、令牌、取消信号且不缓存', async () => {
    const response = sample();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200, headers: { ETag: 'directory-current' } }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    expect(await getSimulationAvailability('http://api.test/prefix', 'demo', 'local-test', controller.signal))
      .toEqual({ data: response, status: 200, etag: 'directory-current' });
    const [address, options] = fetchMock.mock.calls[0]!;
    const url = new URL(address);
    expect(url.origin + url.pathname).toBe('http://api.test/api/admin/games/demo/simulation-availability');
    expect(url.searchParams.get('wasmSha256')).toBe(SIMULATION_AVAILABILITY_IDENTITY.wasmSha256);
    expect(url.searchParams.get('adapterVersion')).toBe(SIMULATION_AVAILABILITY_IDENTITY.adapterVersion);
    expect(options.signal).toBe(controller.signal);
    expect(options.cache).toBe('no-store');
    expect(options.headers.get('Authorization')).toBe('Bearer local-test');
    expect(options.body).toBeUndefined();
    expect(simulationAvailabilityPath('a/b')).toContain('/games/a%2Fb/simulation-availability?');
  });

  it('原样保留全部已就绪和未就绪项，非READY允许缺当前覆盖但不造证明', () => {
    const response = sample();
    response.characters[0] = { ...response.characters[0]!, status: 'CONFIGURATION_INCOMPLETE',
      issues: [{ code: 'MISSING_PROGRAM', skillKey: 'actual_skill', fieldPath: 'triggerRules', message: '缺少完整技能程序。' }],
      verification: { ...response.characters[0]!.verification, requiredCoverage: null, matched: false, evidenceRefs: [] } };
    response.equipment[0] = { ...response.equipment[0]!, status: 'OUT_OF_SCOPE',
      verification: { ...response.equipment[0]!.verification, requiredCoverage: null, matched: false, evidenceRefs: [] } };
    expect(parseSimulationAvailabilityResponse(response, 'demo')).toEqual(response);
    response.characters[0]!.status = 'UNVERIFIED';
    expect(parseSimulationAvailabilityResponse(response, 'demo').characters[0]!.status).toBe('UNVERIFIED');
    response.characters[0]!.status = 'ENGINE_UNSUPPORTED';
    expect(parseSimulationAvailabilityResponse(response, 'demo').characters[0]!.status).toBe('ENGINE_UNSUPPORTED');
  });

  it.each([
    ['不同游戏', (value: SimulationAvailabilityResponse) => { value.gameId = 'other'; }],
    ['错误场景', (value: SimulationAvailabilityResponse) => { Object.assign(value, { profile: 'basic-attack' }); }],
    ['旧摘要版本', (value: SimulationAvailabilityResponse) => { Object.assign(value, { digestVersion: 'old' }); }],
    ['范围摘要缺失', (value: SimulationAvailabilityResponse) => { Object.assign(value, { scopeDigest: undefined }); }],
    ['摘要非法', (value: SimulationAvailabilityResponse) => { value.sharedDigest = 'same-as-old-data'; }],
    ['角色重复', (value: SimulationAvailabilityResponse) => { value.characters.push(value.characters[0]!); }],
    ['装备重复', (value: SimulationAvailabilityResponse) => { value.equipment.push(value.equipment[0]!); }],
    ['未知状态', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!, { status: 'AVAILABLE' }); }],
    ['旧完成标记', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!, { ready: true }); }],
    ['证明字段缺失', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!, { verification: undefined }); }],
    ['排除来源缺失', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!, { excludedSkillSources: undefined }); }],
    ['排除无依据', (value: SimulationAvailabilityResponse) => { value.characters[0]!.excludedSkillSources = [{ skillKey: 'outside', reason: '' }]; }],
    ['排除重复', (value: SimulationAvailabilityResponse) => { value.characters[0]!.excludedSkillSources = Array.from({ length: 2 }, () => ({ skillKey: 'outside', reason: '已有范围依据' })); }],
    ['验证与排除相矛盾', (value: SimulationAvailabilityResponse) => { value.characters[0]!.excludedSkillSources = [{ skillKey: 'actual_skill', reason: '范围外' }]; }],
    ['证明格式缺失', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!, { verification: null }); }],
    ['旧引擎', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.wasmSha256 = '0'.repeat(64); }],
    ['旧适配', (value: SimulationAvailabilityResponse) => { value.equipment[0]!.verification.adapterVersion = 'old-adapter'; }],
    ['外部摘要缺失', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.externalDigest = ''; }],
    ['未匹配证明', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.matched = false; }],
    ['缺少证据', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.evidenceRefs = []; }],
    ['空证据', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.evidenceRefs = [' ']; }],
    ['重复证据', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.evidenceRefs = ['same', 'same']; }],
    ['仍有缺口', (value: SimulationAvailabilityResponse) => { value.characters[0]!.issues = [{ code: 'GAP', skillKey: null, fieldPath: null, message: '尚未完成' }]; }],
    ['问题缺少说明', (value: SimulationAvailabilityResponse) => { value.characters[0]!.issues = [{ code: 'GAP', skillKey: null, fieldPath: null, message: '' }]; }],
    ['就绪却无覆盖', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.requiredCoverage = null; }],
    ['覆盖类型不符', (value: SimulationAvailabilityResponse) => { value.equipment[0]!.verification.requiredCoverage!.equipmentMode = 'none'; }],
    ['范围外却有覆盖', (value: SimulationAvailabilityResponse) => { value.characters[0]!.status = 'OUT_OF_SCOPE'; }],
    ['只核验攻击方', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!.verification.requiredCoverage!, { sides: ['source'] }); }],
    ['旧场景覆盖', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!.verification.requiredCoverage!, { scenario: 'single-skill' }); }],
    ['缺等级', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.requiredCoverage!.characterLevels = []; }],
    ['等级重复', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.requiredCoverage!.characterLevels = [1, 1]; }],
    ['等级遗漏', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.requiredCoverage!.characterLevels = [1, 3]; }],
    ['技能等级未完整', (value: SimulationAvailabilityResponse) => { value.characters[0]!.verification.requiredCoverage!.skills[0]!.levels = [2]; }],
    ['技能重复', (value: SimulationAvailabilityResponse) => { const skills = value.characters[0]!.verification.requiredCoverage!.skills; skills.push(skills[0]!); }],
    ['关闭来源覆盖', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!.verification.requiredCoverage!, { allRequiredSourcesEnabled: false }); }],
    ['只开始未终结', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!.verification.requiredCoverage!, { sourceActiveStartedAndCompleted: false }); }],
    ['未触发被动', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!.verification.requiredCoverage!, { relevantPassivesTriggered: false }); }],
    ['未知覆盖字段', (value: SimulationAvailabilityResponse) => { Object.assign(value.characters[0]!.verification.requiredCoverage!, { guessedFutureCoverage: true }); }]
  ])('%s拒绝整份目录，不能回退成全部可选', (_, mutate) => {
    const value = sample();
    mutate(value);
    expect(() => parseSimulationAvailabilityResponse(value, 'demo')).toThrow('计算可用性目录响应不合法');
  });

  it('目录为空合法但不从旧数据生成可用项', () => {
    const response = { ...sample(), characters: [], equipment: [] };
    expect(parseSimulationAvailabilityResponse(response, 'demo')).toEqual(response);
    expect(() => parseSimulationAvailabilityResponse({ characters: [{ key: 'hero', ready: true }] }, 'demo')).toThrow();
  });

  it('非READY也拒绝外游戏引擎身份，避免错误目录复用', () => {
    const response = sample();
    response.characters[0]!.status = 'UNVERIFIED';
    response.characters[0]!.verification.wasmSha256 = '0'.repeat(64);
    expect(() => parseSimulationAvailabilityResponse(response, 'demo')).toThrow('wasmSha256');
  });

  it('即使宿主迟到返回成功，已取消请求也不接收目录', async () => {
    let deliver!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })));
    const controller = new AbortController();
    const pending = getSimulationAvailability('http://api.test', 'demo', 'local-test', controller.signal);
    controller.abort();
    deliver(new Response(JSON.stringify(sample()), { status: 200 }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('读取或鉴权失败保留统一API错误，不返回空目录或旧白名单', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'forbidden', message: '不可读取' } }), { status: 403 })));
    await expect(getSimulationAvailability('http://api.test', 'demo', 'local-test')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});
