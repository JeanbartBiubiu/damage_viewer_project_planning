import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSkillEffects, SkillEffectProtocolError } from './skillEffectClient';
import { listSkillTriggerRules, SkillTriggerRuleProtocolError } from './skillTriggerRuleClient';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const clients = [
  { name: '技能效果', load: listSkillEffects, error: SkillEffectProtocolError },
  { name: '触发规则', load: listSkillTriggerRules, error: SkillTriggerRuleProtocolError }
] as const;

describe.each(clients)('$name列表响应边界', ({ load, error }) => {
  for (const development of [false, true]) {
    describe(development ? '开发环境' : '生产环境', () => {
      it.each([null, {}, 'invalid', [null], [{ name: '不完整摘要' }]])('拒绝非法响应，不把它报告为空列表：%j', async body => {
        vi.stubEnv('DEV', development);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })));
        await expect(load('http://localhost:8080', 'demo', 'skill')).rejects.toBeInstanceOf(error);
      });

      it('保留合法空列表', async () => {
        vi.stubEnv('DEV', development);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })));
        expect((await load('http://localhost:8080', 'demo', 'skill')).data).toEqual([]);
      });
    });
  }
});
