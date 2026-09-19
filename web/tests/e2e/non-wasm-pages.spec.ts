import { formulaValue, type NumericValue } from '../../src/types/numericValue';
/**
 * Deterministic browser acceptance for non-calculation data management pages.
 * All Backend responses are route mocks; this file does not claim live database evidence.
 */
import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
  type TestInfo
} from '@playwright/test';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';
const MOCK_API_BASE = 'http://127.0.0.1:19080';
const GAME_ID = 'demo';
const GAME_NAME = 'Demo Arena';
const ADMIN_TOKEN = 'non-wasm-e2e-token';

type Json = Record<string, unknown>;

type AttributeRow = {
  gameId: string;
  attributeKey: string;
  name: string;
  valueType: 'DECIMAL' | 'INTEGER';
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type CharacterRow = {
  gameId: string;
  characterKey: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type EquipmentRow = {
  gameId: string;
  equipmentKey: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type ImageRow = {
  gameId: string;
  imageKey: string;
  name: string;
  description: string | null;
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type SkillCategoryRow = {
  gameId: string;
  skillCategoryKey: string;
  name: string;
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type DamageTypeRow = {
  gameId: string;
  damageTypeKey: string;
  name: string;
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type ModifierZoneRow = {
  gameId: string;
  modifierZoneKey: string;
  name: string;
  domain: 'ATTRIBUTE' | 'DAMAGE' | 'HEALING';
  calculationMode: 'FLAT_ADD' | 'RATIO_ADD';
  applicationStage: 'ATTRIBUTE_FLAT' | 'ATTRIBUTE_PERCENT' | 'DAMAGE_PRE_DEFENSE' | 'DAMAGE_POST_DEFENSE' | 'HEALING_RESULT';
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type StatusRow = {
  statusKind: 'STUN' | 'MOVEMENT_SLOW';
  gameId: string;
  statusKey: string;
  name: string;
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type SkillRow = {
  gameId: string;
  skillKey: string;
  name: string;
  description: string | null;
  maxLevel: number;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  skillCategoryKeys: string[];
  createdAt: string;
  updatedAt: string;
};

type SkillParameterRow = {
  gameId: string;
  skillKey: string;
  parameterKey: string;
  name: string;
  valueType: 'INTEGER' | 'DECIMAL';
  valueMode: 'FIXED' | 'SKILL_LEVEL' | 'CHARACTER_LEVEL' | 'RUNTIME_INPUT';
  fixedValue: number | null;
  levelValues: Record<string, number> | null;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type SkillFormulaRow = {
  gameId: string;
  skillKey: string;
  formulaKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  expression: Json;
  createdAt: string;
  updatedAt: string;
};

type SkillEffectValueRuleRow = {
  formulaKey: string;
  fixedMultiplier: number;
  fixedMinValue: number | null;
  fixedMaxValue: number | null;
};

type SkillEffectResultRow = {
  resultKey: string;
  name: string;
  resultType: string;
  target: 'SOURCE' | 'TARGET';
  description: string | null;
  sortOrder: number;
  spellShieldBlockScope: 'SKILL' | 'EFFECT' | 'DAMAGE_INSTANCE' | 'RESULT' | null;
  valueRule: SkillEffectValueRuleRow | null;
  detail: Json;
  lifecycleBehavior: Json | null;
};

type SkillEffectRow = {
  gameId: string;
  skillKey: string;
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  lifecycle: Json | null;
  results: SkillEffectResultRow[];
  createdAt: string;
  updatedAt: string;
};

type SkillInternalStateRow = {
  gameId: string;
  skillKey: string;
  stateKey: string;
  name: string;
  stateType: string;
  scope: 'SKILL' | 'TARGET';
  description: string | null;
  sortOrder: number;
  detail: Json;
  createdAt: string;
  updatedAt: string;
};

type SkillProcessMomentRow = {
  momentType: string;
  stepKey: string | null;
};

type SkillProcessStepRow = {
  stepKey: string;
  name: string;
  stepType: string;
  description: string | null;
  sortOrder: number;
  detail: Json;
};

type SkillProcessEffectBindingRow = {
  bindingKey: string;
  effectKey: string;
  moment: SkillProcessMomentRow;
  sortOrder: number;
};

type SkillProcessStateOperationRow = {
  operationKey: string;
  name: string;
  stateKey: string;
  operation: string;
  value: NumericValue | null;
  optionKey: string | null;
  moment: SkillProcessMomentRow;
  sortOrder: number;
};

type SkillProcessRow = {
  gameId: string;
  skillKey: string;
  processKey: string;
  name: string;
  activationType: string;
  description: string | null;
  sortOrder: number;
  cooldown: { durationValue: NumericValue | null; startMoment: SkillProcessMomentRow } | null;
  steps: SkillProcessStepRow[];
  effectBindings: SkillProcessEffectBindingRow[];
  stateOperations: SkillProcessStateOperationRow[];
  createdAt: string;
  updatedAt: string;
};

type SkillTriggerRuleStored = {
  gameId: string;
  skillKey: string;
  ruleKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  eventSource: Json;
  conditionGroups: Json[];
  actions: Json[];
  perTargetCooldown: Json | null;
  maxTriggersPerProcess: Json | null;
  createdAt: string;
  updatedAt: string;
};

type TriggerRuleWriteFailure = 'unprotected-cycle' | 'not-found' | 'invalid-binding' | null;

type WriteFailure = 'validation' | 'duplicate' | 'not-found' | 'network' | 'lifecycle-in-use' | 'lifecycle-field' | 'shape-in-use' | null;

type CapturedWrite = {
  method: string;
  path: string;
  body: Json;
};

const CREATED_AT = '2026-08-22T09:00:00Z';
const UPDATED_AT = '2026-08-22T10:00:00Z';

function attribute(
  attributeKey: string,
  name: string,
  overrides: Partial<AttributeRow> = {}
): AttributeRow {
  return {
    gameId: GAME_ID,
    attributeKey,
    name,
    valueType: 'DECIMAL',
    minValue: 0,
    maxValue: null,
    description: null,
    status: 'ENABLED',
    sortOrder: 100,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides
  };
}

class MockApi {
  attributes: AttributeRow[] = [];
  characters: CharacterRow[] = [];
  characterAttributes: Record<string, Record<string, Record<string, number>>> = {};
  equipment: EquipmentRow[] = [];
  images: ImageRow[] = [];
  equipmentAttributes: Record<string, Record<string, number>> = {};
  skillCategories: SkillCategoryRow[] = [];
  damageTypes: DamageTypeRow[] = [];
  modifierZones: ModifierZoneRow[] = [];
  statuses: StatusRow[] = [];
  skills: SkillRow[] = [];
  skillParameters: SkillParameterRow[] = [];
  skillFormulas: SkillFormulaRow[] = [];
  skillEffects: SkillEffectRow[] = [];
  skillInternalStates: SkillInternalStateRow[] = [];
  skillProcesses: SkillProcessRow[] = [];
  skillTriggerRules: SkillTriggerRuleStored[] = [];
  skillCategoryListFailure = false;
  skillListFailure = false;
  skillFormulaListFailure = false;
  skillInternalStateListFailure = false;
  skillProcessListFailure = false;
  skillEffectListFailure = false;
  damageTypeListFailure = false;
  attributeListFailure = false;
  statusListFailure = false;
  statusWriteFailure: WriteFailure = null;
  effectWriteFailure: WriteFailure = null;
  effectWriteFieldIssues: Array<{ field: string; code: string; message: string }> = [];
  skillEffectGetFailureKeys = new Set<string>();
  internalStateWriteFailure: WriteFailure = null;
  processWriteFailure: WriteFailure = null;
  triggerRuleWriteFailure: TriggerRuleWriteFailure = null;
  triggerRuleWriteHold: Promise<void> | null = null;
  parameterDeleteConflictKeys = new Set<string>();
  internalStateDeleteConflictKeys = new Set<string>();
  minLevel = 1;
  maxLevel = 2;
  writeFailure: WriteFailure = null;
  imageWriteFailure: 'validation' | 'duplicate' | null = null;
  imageClock = 0;
  imageAdminListRequests = 0;
  listQueries: Array<{ keyword: string | null; status: string | null }> = [];
  writes: CapturedWrite[] = [];
  unmockedRequests: string[] = [];

  async install(page: Page): Promise<void> {
    await page.route('**/api/**', async (route) => {
      await this.handle(route);
    });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.href.startsWith(MOCK_API_BASE)) {
      this.unmockedRequests.push(`${request.method()} ${url.href}`);
      await route.abort('failed');
      return;
    }

    try {
      await this.dispatch(route, request, url);
    } catch (error) {
      this.unmockedRequests.push(`${request.method()} ${url.pathname}: ${String(error)}`);
      await this.error(route, 500, '500.MOCK', String(error));
    }
  }

  private async dispatch(route: Route, request: Request, url: URL): Promise<void> {
    const method = request.method().toUpperCase();
    const path = decodeURIComponent(url.pathname);

    if (method === 'GET' && path === '/api/games') {
      await this.json(route, 200, [{ gameId: GAME_ID, gameName: GAME_NAME, representativeImageKey: null }]);
      return;
    }

    if (method === 'GET' && path === `/api/admin/games/${GAME_ID}/representative-image`) {
      await this.json(route, 200, { image: null });
      return;
    }

    // 当前业务表格仅读取所属对象的代表图片；限定六类合法路径，不接管其他请求。
    const objectRepresentative = path.match(new RegExp(
      `^/api/admin/games/${GAME_ID}/(characters|attributes|equipment|skills|statuses)/([^/]+)/representative-image$`
    ));
    if (method === 'GET' && objectRepresentative) {
      const [, kind, key] = objectRepresentative;
      const sources = {
        characters: { exists: this.characters.some(item => item.characterKey === key), code: '404.CHARACTER_NOT_FOUND', name: '角色' },
        attributes: { exists: this.attributes.some(item => item.attributeKey === key), code: '404.ATTRIBUTE_NOT_FOUND', name: '属性' },
        equipment: { exists: this.equipment.some(item => item.equipmentKey === key), code: '404.EQUIPMENT_NOT_FOUND', name: '装备' },
        skills: { exists: this.skills.some(item => item.skillKey === key), code: '404.SKILL_NOT_FOUND', name: '技能' },
        statuses: { exists: this.statuses.some(item => item.statusKey === key), code: '404.STATUS_NOT_FOUND', name: '状态' }
      };
      const source = sources[kind as keyof typeof sources];
      if (!source.exists) await this.error(route, 404, source.code, `${source.name}不存在`);
      else await this.json(route, 200, { image: null });
      return;
    }

    const effectRepresentative = path.match(new RegExp(
      `^/api/admin/games/${GAME_ID}/skills/([^/]+)/effects/([^/]+)/representative-image$`
    ));
    if (method === 'GET' && effectRepresentative) {
      const [, skillKey, effectKey] = effectRepresentative;
      if (!this.skills.some(item => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
      } else if (!this.skillEffects.some(item => item.skillKey === skillKey && item.effectKey === effectKey)) {
        await this.error(route, 404, '404.SKILL_EFFECT_NOT_FOUND', '技能效果不存在');
      } else {
        await this.json(route, 200, { image: null });
      }
      return;
    }

    if (method === 'GET' && path === `/api/games/${GAME_ID}/images`) {
      const updatedAfter = url.searchParams.get('updatedAfter');
      const images = this.images
        .filter((item) => !updatedAfter || item.updatedAt > updatedAfter)
        .map((item) => ({
          imageKey: item.imageKey,
          enabled: item.enabled,
          imageBase64: item.enabled ? item.imageBase64 : null,
          updatedAt: item.updatedAt
        }));
      await this.json(route, 200, { gameId: GAME_ID, images });
      return;
    }

    const adminImagesPath = `/api/admin/games/${GAME_ID}/images`;
    if (path === adminImagesPath) {
      if (method === 'GET') {
        this.imageAdminListRequests += 1;
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const enabled = url.searchParams.get('enabled');
        const items = this.images.filter((item) => (
          (!keyword
            || item.imageKey.toLocaleLowerCase().includes(keyword)
            || item.name.toLocaleLowerCase().includes(keyword))
          && (enabled === null || item.enabled === (enabled === 'true'))
        ));
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (this.imageWriteFailure === 'validation') {
          await this.error(route, 400, '400.VALIDATION_FAILED', '服务端图片名称校验失败', {
            fieldIssues: [{ field: 'name', code: 'INVALID', message: '服务端图片名称校验失败' }]
          });
          return;
        }
        if (this.imageWriteFailure === 'duplicate') {
          await this.error(route, 409, '409.IMAGE_KEY_EXISTS', '图片标识已存在', {
            fieldIssues: [{ field: 'imageKey', code: 'CONFLICT', message: '图片标识已存在' }]
          });
          return;
        }
        const imageBase64 = String(body.imageBase64);
        const metadata = this.readImageMetadata(imageBase64);
        const timestamp = this.nextImageTimestamp();
        const row: ImageRow = {
          gameId: GAME_ID,
          imageKey: String(body.imageKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          imageBase64,
          ...metadata,
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        this.images.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    if (path.startsWith(`${adminImagesPath}/`)) {
      const imageKey = path.slice(adminImagesPath.length + 1);
      const index = this.images.findIndex((item) => item.imageKey === imageKey);
      if (index < 0) {
        await this.error(route, 404, '404.IMAGE_NOT_FOUND', '图片不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, this.images[index]);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (this.imageWriteFailure === 'validation') {
          await this.error(route, 400, '400.VALIDATION_FAILED', '服务端图片名称校验失败', {
            fieldIssues: [{ field: 'name', code: 'INVALID', message: '服务端图片名称校验失败' }]
          });
          return;
        }
        const current = this.images[index]!;
        const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : current.imageBase64;
        const metadata = typeof body.imageBase64 === 'string'
          ? this.readImageMetadata(imageBase64)
          : {
              mimeType: current.mimeType,
              byteSize: current.byteSize,
              width: current.width,
              height: current.height
            };
        const row: ImageRow = {
          ...current,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          enabled: Boolean(body.enabled),
          imageBase64,
          ...metadata,
          updatedAt: this.nextImageTimestamp()
        };
        this.images[index] = row;
        await this.json(route, 200, row);
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/level-config`) {
      if (method === 'GET') {
        await this.json(route, 200, {
          gameId: GAME_ID,
          minLevel: this.minLevel,
          maxLevel: this.maxLevel
        });
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        this.minLevel = Number(body.minLevel);
        this.maxLevel = Number(body.maxLevel);
        for (const characterKey of Object.keys(this.characterAttributes)) {
          const current = this.characterAttributes[characterKey] ?? {};
          const next: Record<string, Record<string, number>> = {};
          for (let level = this.minLevel; level <= this.maxLevel; level += 1) {
            next[String(level)] = Object.fromEntries(
              this.attributes.map((item) => [
                item.attributeKey,
                current[String(level)]?.[item.attributeKey] ?? 0
              ])
            );
          }
          this.characterAttributes[characterKey] = next;
        }
        await this.json(route, 200, {
          gameId: GAME_ID,
          minLevel: this.minLevel,
          maxLevel: this.maxLevel
        });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/characters`) {
      if (method === 'GET') {
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const items = this.characters.filter((item) =>
          !keyword
          || item.characterKey.toLocaleLowerCase().includes(keyword)
          || item.name.toLocaleLowerCase().includes(keyword)
        );
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: CharacterRow = {
          gameId: GAME_ID,
          characterKey: String(body.characterKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.characters.push(row);
        this.characterAttributes[row.characterKey] = {};
        for (let level = this.minLevel; level <= this.maxLevel; level += 1) {
          this.characterAttributes[row.characterKey]![String(level)] = {};
        }
        await this.json(route, 201, row);
        return;
      }
    }

    const characterAttributes = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/characters/([^/]+)/attributes$`)
    );
    if (characterAttributes) {
      const characterKey = characterAttributes[1]!;
      if (method === 'GET') {
        await this.json(route, 200, {
          characterKey,
          minLevel: this.minLevel,
          maxLevel: this.maxLevel,
          levelValues: this.characterAttributes[characterKey] ?? {}
        });
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        this.characterAttributes[characterKey] = body.levelValues as Record<string, Record<string, number>>;
        await this.json(route, 200, {
          characterKey,
          minLevel: this.minLevel,
          maxLevel: this.maxLevel,
          levelValues: this.characterAttributes[characterKey]
        });
        return;
      }
    }

    const characterDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/characters/([^/]+)$`)
    );
    if (characterDetail) {
      const characterKey = characterDetail[1]!;
      const existing = this.characters.find((item) => item.characterKey === characterKey);
      if (!existing) {
        await this.error(route, 404, '404.CHARACTER_NOT_FOUND', '角色不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: CharacterRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.characters = this.characters.map((item) => item.characterKey === characterKey ? next : item);
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.characters = this.characters.filter((item) => item.characterKey !== characterKey);
        delete this.characterAttributes[characterKey];
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/equipment`) {
      if (method === 'GET') {
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const items = this.equipment.filter((item) =>
          !keyword
          || item.equipmentKey.toLocaleLowerCase().includes(keyword)
          || item.name.toLocaleLowerCase().includes(keyword)
        );
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: EquipmentRow = {
          gameId: GAME_ID,
          equipmentKey: String(body.equipmentKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.equipment.push(row);
        this.equipmentAttributes[row.equipmentKey] = {};
        await this.json(route, 201, row);
        return;
      }
    }

    const equipmentAttributes = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/equipment/([^/]+)/attributes$`)
    );
    if (equipmentAttributes) {
      const equipmentKey = equipmentAttributes[1]!;
      if (method === 'GET') {
        await this.json(route, 200, {
          equipmentKey,
          attributeValues: this.equipmentAttributes[equipmentKey] ?? {}
        });
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        this.equipmentAttributes[equipmentKey] = body.attributeValues as Record<string, number>;
        await this.json(route, 200, {
          equipmentKey,
          attributeValues: this.equipmentAttributes[equipmentKey]
        });
        return;
      }
    }

    const equipmentDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/equipment/([^/]+)$`)
    );
    if (equipmentDetail) {
      const equipmentKey = equipmentDetail[1]!;
      const existing = this.equipment.find((item) => item.equipmentKey === equipmentKey);
      if (!existing) {
        await this.error(route, 404, '404.EQUIPMENT_NOT_FOUND', '装备不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: EquipmentRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.equipment = this.equipment.map((item) => item.equipmentKey === equipmentKey ? next : item);
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.equipment = this.equipment.filter((item) => item.equipmentKey !== equipmentKey);
        delete this.equipmentAttributes[equipmentKey];
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/skill-categories`) {
      if (method === 'GET') {
        if (this.skillCategoryListFailure) {
          await this.error(route, 503, '503.SKILL_CATEGORY_LIST_UNAVAILABLE', '技能分类读取失败');
          return;
        }
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const status = url.searchParams.get('status');
        const items = this.skillCategories.filter((item) => {
          const keywordMatches = !keyword
            || item.skillCategoryKey.toLocaleLowerCase().includes(keyword)
            || item.name.toLocaleLowerCase().includes(keyword);
          return keywordMatches && (!status || item.status === status);
        });
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: SkillCategoryRow = {
          gameId: GAME_ID,
          skillCategoryKey: String(body.skillCategoryKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.skillCategories.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const skillCategoryDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skill-categories/([^/]+)$`)
    );
    if (skillCategoryDetail) {
      const key = skillCategoryDetail[1]!;
      const existing = this.skillCategories.find((item) => item.skillCategoryKey === key);
      if (!existing) {
        await this.error(route, 404, '404.SKILL_CATEGORY_NOT_FOUND', '技能分类不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: SkillCategoryRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.skillCategories = this.skillCategories.map((item) =>
          item.skillCategoryKey === key ? next : item
        );
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.skillCategories = this.skillCategories.filter((item) => item.skillCategoryKey !== key);
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/skills`) {
      if (method === 'GET') {
        if (this.skillListFailure) {
          await this.error(route, 503, '503.SKILL_LIST_UNAVAILABLE', '技能读取失败');
          return;
        }
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const status = url.searchParams.get('status');
        const items = this.skills.filter((item) => {
          const keywordMatches = !keyword
            || item.skillKey.toLocaleLowerCase().includes(keyword)
            || item.name.toLocaleLowerCase().includes(keyword);
          return keywordMatches && (!status || item.status === status);
        });
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: SkillRow = {
          gameId: GAME_ID,
          skillKey: String(body.skillKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          maxLevel: Number(body.maxLevel),
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          skillCategoryKeys: Array.isArray(body.skillCategoryKeys)
            ? body.skillCategoryKeys.map(String)
            : [],
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.skills.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const skillDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)$`)
    );
    if (skillDetail) {
      const key = skillDetail[1]!;
      const existing = this.skills.find((item) => item.skillKey === key);
      if (!existing) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: SkillRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          maxLevel: Number(body.maxLevel),
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          skillCategoryKeys: Array.isArray(body.skillCategoryKeys)
            ? body.skillCategoryKeys.map(String)
            : [],
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.skills = this.skills.map((item) => item.skillKey === key ? next : item);
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.skills = this.skills.filter((item) => item.skillKey !== key);
        this.skillParameters = this.skillParameters.filter((item) => item.skillKey !== key);
        this.skillFormulas = this.skillFormulas.filter((item) => item.skillKey !== key);
        this.skillEffects = this.skillEffects.filter((item) => item.skillKey !== key);
        this.skillInternalStates = this.skillInternalStates.filter((item) => item.skillKey !== key);
        this.skillProcesses = this.skillProcesses.filter((item) => item.skillKey !== key);
        this.skillTriggerRules = this.skillTriggerRules.filter((item) => item.skillKey !== key);
        await route.fulfill({ status: 204 });
        return;
      }
    }

    const skillParametersList = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/parameters$`)
    );
    if (skillParametersList) {
      const skillKey = skillParametersList[1]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        const items = this.skillParameters.filter((item) => item.skillKey === skillKey);
        await this.json(route, 200, items);
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: SkillParameterRow = {
          gameId: GAME_ID,
          skillKey,
          parameterKey: String(body.parameterKey),
          name: String(body.name),
          valueType: body.valueType === 'INTEGER' ? 'INTEGER' : 'DECIMAL',
          valueMode: body.valueMode as SkillParameterRow['valueMode'],
          fixedValue: typeof body.fixedValue === 'number' ? body.fixedValue : null,
          levelValues: body.levelValues && typeof body.levelValues === 'object'
            ? body.levelValues as Record<string, number>
            : null,
          description: typeof body.description === 'string' ? body.description : null,
          sortOrder: Number(body.sortOrder),
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.skillParameters.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const skillParameterDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/parameters/([^/]+)$`)
    );
    if (skillParameterDetail) {
      const skillKey = skillParameterDetail[1]!;
      const parameterKey = skillParameterDetail[2]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      const existing = this.skillParameters.find((item) => (
        item.skillKey === skillKey && item.parameterKey === parameterKey
      ));
      if (!existing) {
        await this.error(route, 404, '404.SKILL_PARAMETER_NOT_FOUND', '技能参数不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: SkillParameterRow = {
          ...existing,
          name: String(body.name),
          valueType: body.valueType === 'INTEGER' ? 'INTEGER' : 'DECIMAL',
          valueMode: body.valueMode as SkillParameterRow['valueMode'],
          fixedValue: typeof body.fixedValue === 'number' ? body.fixedValue : null,
          levelValues: body.levelValues && typeof body.levelValues === 'object'
            ? body.levelValues as Record<string, number>
            : null,
          description: typeof body.description === 'string' ? body.description : null,
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.skillParameters = this.skillParameters.map((item) => (
          item.skillKey === skillKey && item.parameterKey === parameterKey ? next : item
        ));
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        if (this.parameterDeleteConflictKeys.has(parameterKey)) {
          await this.error(route, 409, '409.SKILL_PARAMETER_IN_USE', 'parameter in use');
          return;
        }
        this.skillParameters = this.skillParameters.filter((item) => !(
          item.skillKey === skillKey && item.parameterKey === parameterKey
        ));
        await route.fulfill({ status: 204 });
        return;
      }
    }

    const skillFormulasList = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/formulas$`)
    );
    if (skillFormulasList) {
      const skillKey = skillFormulasList[1]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        if (this.skillFormulaListFailure) {
          await this.error(route, 503, '503.SKILL_FORMULA_LIST_UNAVAILABLE', '技能公式读取失败');
          return;
        }
        const items = this.skillFormulas
          .filter((item) => item.skillKey === skillKey)
          .map(({ expression: _expression, ...summary }) => summary);
        await this.json(route, 200, items);
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: SkillFormulaRow = {
          gameId: GAME_ID,
          skillKey,
          formulaKey: String(body.formulaKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          sortOrder: Number(body.sortOrder),
          expression: body.expression as Json,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.skillFormulas.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const skillFormulaDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/formulas/([^/]+)$`)
    );
    if (skillFormulaDetail) {
      const skillKey = skillFormulaDetail[1]!;
      const formulaKey = skillFormulaDetail[2]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      const existing = this.skillFormulas.find((item) => (
        item.skillKey === skillKey && item.formulaKey === formulaKey
      ));
      if (!existing) {
        await this.error(route, 404, '404.SKILL_FORMULA_NOT_FOUND', '技能公式不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: SkillFormulaRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          sortOrder: Number(body.sortOrder),
          expression: body.expression as Json,
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.skillFormulas = this.skillFormulas.map((item) => (
          item.skillKey === skillKey && item.formulaKey === formulaKey ? next : item
        ));
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.skillFormulas = this.skillFormulas.filter((item) => !(
          item.skillKey === skillKey && item.formulaKey === formulaKey
        ));
        await route.fulfill({ status: 204 });
        return;
      }
    }

    const skillEffectsList = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/effects$`)
    );
    if (skillEffectsList) {
      const skillKey = skillEffectsList[1]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        if (this.skillEffectListFailure) {
          await this.error(route, 503, '503.SKILL_EFFECT_LIST_UNAVAILABLE', '效果读取失败');
          return;
        }
        const items = this.skillEffects
          .filter((item) => item.skillKey === skillKey)
          .map((item) => this.toSkillEffectSummary(item));
        await this.json(route, 200, items);
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyEffectWriteFailure(route)) {
          return;
        }
        if (await this.applyLifecycleWriteRules(route, skillKey, String(body.effectKey), body)) {
          return;
        }
        const row = this.buildSkillEffectRow(skillKey, String(body.effectKey), body);
        this.skillEffects.push(row);
        await this.json(route, 201, this.cloneSkillEffect(row));
        return;
      }
    }

    const skillEffectDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/effects/([^/]+)$`)
    );
    if (skillEffectDetail) {
      const skillKey = skillEffectDetail[1]!;
      const effectKey = skillEffectDetail[2]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      const existing = this.skillEffects.find((item) => (
        item.skillKey === skillKey && item.effectKey === effectKey
      ));
      if (!existing) {
        await this.error(route, 404, '404.SKILL_EFFECT_NOT_FOUND', '技能效果不存在');
        return;
      }
      if (method === 'GET') {
        if (this.skillEffectGetFailureKeys.has(effectKey)) {
          await this.error(route, 500, '500.SKILL_EFFECT_GET_FAILED', '效果详情加载失败');
          return;
        }
        await this.json(route, 200, this.cloneSkillEffect(existing));
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyEffectWriteFailure(route)) {
          return;
        }
        if (await this.applyLifecycleWriteRules(route, skillKey, existing.effectKey, body, existing)) {
          return;
        }
        const next = this.buildSkillEffectRow(skillKey, existing.effectKey, body, existing);
        this.skillEffects = this.skillEffects.map((item) => (
          item.skillKey === skillKey && item.effectKey === effectKey ? next : item
        ));
        await this.json(route, 200, this.cloneSkillEffect(next));
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        if (this.effectWriteFailure === 'lifecycle-in-use' || this.isLifecycleTargetInUse(skillKey, effectKey)) {
          await this.error(
            route,
            409,
            '409.SKILL_EFFECT_LIFECYCLE_IN_USE',
            '该效果正在被其他效果的生命周期操作引用，不能删除。'
          );
          return;
        }
        this.skillEffects = this.skillEffects.filter((item) => !(
          item.skillKey === skillKey && item.effectKey === effectKey
        ));
        await route.fulfill({ status: 204 });
        return;
      }
    }

    const skillInternalStatesList = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/internal-states$`)
    );
    if (skillInternalStatesList) {
      const skillKey = skillInternalStatesList[1]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        if (this.skillInternalStateListFailure) {
          await this.error(route, 503, '503.SKILL_INTERNAL_STATE_LIST_UNAVAILABLE', '内部状态读取失败');
          return;
        }
        const items = this.skillInternalStates
          .filter((item) => item.skillKey === skillKey)
          .map((item) => this.toSkillInternalStateSummary(item));
        await this.json(route, 200, items);
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyInternalStateWriteFailure(route)) {
          return;
        }
        const row = this.buildSkillInternalStateRow(skillKey, String(body.stateKey), body);
        this.skillInternalStates.push(row);
        await this.json(route, 201, this.cloneJson(row));
        return;
      }
    }

    const skillInternalStateDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/internal-states/([^/]+)$`)
    );
    if (skillInternalStateDetail) {
      const skillKey = skillInternalStateDetail[1]!;
      const stateKey = skillInternalStateDetail[2]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      const existing = this.skillInternalStates.find((item) => (
        item.skillKey === skillKey && item.stateKey === stateKey
      ));
      if (!existing) {
        await this.error(route, 404, '404.SKILL_INTERNAL_STATE_NOT_FOUND', '技能内部状态不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, this.cloneJson(existing));
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyInternalStateWriteFailure(route)) {
          return;
        }
        const next = this.buildSkillInternalStateRow(skillKey, existing.stateKey, body, existing);
        this.skillInternalStates = this.skillInternalStates.map((item) => (
          item.skillKey === skillKey && item.stateKey === stateKey ? next : item
        ));
        await this.json(route, 200, this.cloneJson(next));
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        if (this.internalStateDeleteConflictKeys.has(stateKey)) {
          await this.error(route, 409, '409.SKILL_INTERNAL_STATE_IN_USE', 'internal state in use');
          return;
        }
        this.skillInternalStates = this.skillInternalStates.filter((item) => !(
          item.skillKey === skillKey && item.stateKey === stateKey
        ));
        await route.fulfill({ status: 204 });
        return;
      }
    }

    const skillProcessesList = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/processes$`)
    );
    if (skillProcessesList) {
      const skillKey = skillProcessesList[1]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        if (this.skillProcessListFailure) {
          await this.error(route, 503, '503.SKILL_PROCESS_LIST_UNAVAILABLE', '技能过程读取失败');
          return;
        }
        const items = this.skillProcesses
          .filter((item) => item.skillKey === skillKey)
          .map((item) => this.toSkillProcessSummary(item));
        await this.json(route, 200, items);
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyProcessWriteFailure(route)) {
          return;
        }
        const row = this.buildSkillProcessRow(skillKey, String(body.processKey), body);
        this.skillProcesses.push(row);
        await this.json(route, 201, this.cloneJson(row));
        return;
      }
    }

    const skillProcessDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/processes/([^/]+)$`)
    );
    if (skillProcessDetail) {
      const skillKey = skillProcessDetail[1]!;
      const processKey = skillProcessDetail[2]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      const existing = this.skillProcesses.find((item) => (
        item.skillKey === skillKey && item.processKey === processKey
      ));
      if (!existing) {
        await this.error(route, 404, '404.SKILL_PROCESS_NOT_FOUND', '技能过程不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, this.cloneJson(existing));
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyProcessWriteFailure(route)) {
          return;
        }
        const next = this.buildSkillProcessRow(skillKey, existing.processKey, body, existing);
        this.skillProcesses = this.skillProcesses.map((item) => (
          item.skillKey === skillKey && item.processKey === processKey ? next : item
        ));
        await this.json(route, 200, this.cloneJson(next));
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.skillProcesses = this.skillProcesses.filter((item) => !(
          item.skillKey === skillKey && item.processKey === processKey
        ));
        await route.fulfill({ status: 204 });
        return;
      }
    }

    const skillTriggerRulesList = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/trigger-rules$`)
    );
    if (skillTriggerRulesList) {
      const skillKey = skillTriggerRulesList[1]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      if (method === 'GET') {
        const items = this.skillTriggerRules
          .filter((item) => item.skillKey === skillKey)
          .map((item) => this.toTriggerRuleSummary(item));
        await this.json(route, 200, items);
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        if (await this.applyTriggerRuleWrite(route, method, path, body)) {
          return;
        }
        const row = this.buildTriggerRule(skillKey, String(body.ruleKey), body);
        this.skillTriggerRules.push(row);
        await this.json(route, 201, this.toTriggerRuleDetail(row));
        return;
      }
    }

    const skillTriggerRuleDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/skills/([^/]+)/trigger-rules/([^/]+)$`)
    );
    if (skillTriggerRuleDetail) {
      const skillKey = skillTriggerRuleDetail[1]!;
      const ruleKey = skillTriggerRuleDetail[2]!;
      if (!this.skills.some((item) => item.skillKey === skillKey)) {
        await this.error(route, 404, '404.SKILL_NOT_FOUND', '技能不存在');
        return;
      }
      const existing = this.skillTriggerRules.find((item) => (
        item.skillKey === skillKey && item.ruleKey === ruleKey
      ));
      if (!existing) {
        await this.error(route, 404, '404.SKILL_TRIGGER_RULE_NOT_FOUND', '触发规则不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, this.toTriggerRuleDetail(existing));
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        if (await this.applyTriggerRuleWrite(route, method, path, body)) {
          return;
        }
        const next = this.buildTriggerRule(skillKey, existing.ruleKey, body, existing);
        this.skillTriggerRules = this.skillTriggerRules.map((item) => (
          item.skillKey === skillKey && item.ruleKey === ruleKey ? next : item
        ));
        await this.json(route, 200, this.toTriggerRuleDetail(next));
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.skillTriggerRules = this.skillTriggerRules.filter((item) => !(
          item.skillKey === skillKey && item.ruleKey === ruleKey
        ));
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/damage-types`) {
      if (method === 'GET') {
        if (this.damageTypeListFailure) {
          await this.error(route, 503, '503.DAMAGE_TYPE_LIST_UNAVAILABLE', '伤害类型读取失败');
          return;
        }
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const status = url.searchParams.get('status');
        const items = this.damageTypes.filter((item) => {
          const keywordMatches = !keyword
            || item.damageTypeKey.toLocaleLowerCase().includes(keyword)
            || item.name.toLocaleLowerCase().includes(keyword);
          return keywordMatches && (!status || item.status === status);
        });
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: DamageTypeRow = {
          gameId: GAME_ID,
          damageTypeKey: String(body.damageTypeKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.damageTypes.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const damageTypeDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/damage-types/([^/]+)$`)
    );
    if (damageTypeDetail) {
      const key = damageTypeDetail[1]!;
      const existing = this.damageTypes.find((item) => item.damageTypeKey === key);
      if (!existing) {
        await this.error(route, 404, '404.DAMAGE_TYPE_NOT_FOUND', '伤害类型不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: DamageTypeRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-23T11:00:00Z'
        };
        this.damageTypes = this.damageTypes.map((item) =>
          item.damageTypeKey === key ? next : item
        );
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.damageTypes = this.damageTypes.filter((item) => item.damageTypeKey !== key);
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/modifier-zones`) {
      if (method === 'GET') {
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const domain = url.searchParams.get('domain');
        const status = url.searchParams.get('status');
        const items = this.modifierZones.filter((item) => (
          (!keyword
            || item.modifierZoneKey.toLocaleLowerCase().includes(keyword)
            || item.name.toLocaleLowerCase().includes(keyword))
          && (!domain || item.domain === domain)
          && (!status || item.status === status)
        ));
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const row: ModifierZoneRow = {
          gameId: GAME_ID,
          modifierZoneKey: String(body.modifierZoneKey),
          name: String(body.name),
          domain: body.domain as ModifierZoneRow['domain'],
          calculationMode: body.calculationMode as ModifierZoneRow['calculationMode'],
          applicationStage: body.applicationStage as ModifierZoneRow['applicationStage'],
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.modifierZones.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const modifierZoneDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/modifier-zones/([^/]+)$`)
    );
    if (modifierZoneDetail) {
      const key = modifierZoneDetail[1]!;
      const existing = this.modifierZones.find((item) => item.modifierZoneKey === key);
      if (!existing) {
        await this.error(route, 404, '404.MODIFIER_ZONE_NOT_FOUND', '乘区不存在');
        return;
      }
      if (method === 'GET') {
        await this.json(route, 200, existing);
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        const next: ModifierZoneRow = {
          ...existing,
          name: String(body.name),
          domain: body.domain as ModifierZoneRow['domain'],
          calculationMode: body.calculationMode as ModifierZoneRow['calculationMode'],
          applicationStage: body.applicationStage as ModifierZoneRow['applicationStage'],
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-31T11:00:00Z'
        };
        this.modifierZones = this.modifierZones.map((item) => item.modifierZoneKey === key ? next : item);
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        this.modifierZones = this.modifierZones.filter((item) => item.modifierZoneKey !== key);
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/statuses`) {
      if (method === 'GET') {
        if (this.statusListFailure) {
          await this.error(route, 503, '503.STATUS_LIST_UNAVAILABLE', '状态读取失败');
          return;
        }
        const keyword = url.searchParams.get('keyword')?.toLocaleLowerCase() ?? '';
        const status = url.searchParams.get('status');
        this.listQueries.push({ keyword: url.searchParams.get('keyword'), status });
        const items = this.statuses.filter((item) => {
          const keywordMatches = !keyword
            || item.statusKey.toLocaleLowerCase().includes(keyword)
            || item.name.toLocaleLowerCase().includes(keyword);
          return keywordMatches && (!status || item.status === status);
        });
        await this.json(route, 200, { items, total: items.length });
        return;
      }
      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyStatusWriteFailure(route)) {
          return;
        }
        const row: StatusRow = {
          gameId: GAME_ID,
          statusKind: body.statusKind as StatusRow['statusKind'],
          statusKey: String(body.statusKey),
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT
        };
        this.statuses.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const statusDetail = path.match(
      new RegExp(`^/api/admin/games/${GAME_ID}/statuses/([^/]+)$`)
    );
    if (statusDetail) {
      const key = statusDetail[1]!;
      const existing = this.statuses.find((item) => item.statusKey === key);
      if (method === 'GET') {
        if (!existing) {
          await this.error(route, 404, '404.STATUS_NOT_FOUND', '状态不存在');
          return;
        }
        await this.json(route, 200, existing);
        return;
      }
      if (!existing) {
        await this.error(route, 404, '404.STATUS_NOT_FOUND', '状态不存在');
        return;
      }
      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyStatusWriteFailure(route)) {
          return;
        }
        const next: StatusRow = {
          ...existing,
          name: String(body.name),
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-27T11:00:00Z'
        };
        this.statuses = this.statuses.map((item) => item.statusKey === key ? next : item);
        await this.json(route, 200, next);
        return;
      }
      if (method === 'DELETE') {
        this.writes.push({ method, path, body: {} });
        if (await this.applyStatusWriteFailure(route)) {
          return;
        }
        this.statuses = this.statuses.filter((item) => item.statusKey !== key);
        await route.fulfill({ status: 204 });
        return;
      }
    }

    if (path === `/api/admin/games/${GAME_ID}/attributes`) {
      if (method === 'GET') {
        if (this.attributeListFailure) {
          await this.error(route, 503, '503.ATTRIBUTE_LIST_UNAVAILABLE', '属性读取失败');
          return;
        }
        const keyword = url.searchParams.get('keyword');
        const status = url.searchParams.get('status');
        this.listQueries.push({ keyword, status });
        const normalizedKeyword = keyword?.toLocaleLowerCase() ?? '';
        const items = this.attributes.filter((item) => {
          const keywordMatches =
            !normalizedKeyword ||
            item.attributeKey.toLocaleLowerCase().includes(normalizedKeyword) ||
            item.name.toLocaleLowerCase().includes(normalizedKeyword);
          const statusMatches = !status || item.status === status;
          return keywordMatches && statusMatches;
        });
        await this.json(route, 200, { items, total: items.length });
        return;
      }

      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyWriteFailure(route)) {
          return;
        }
        const row = attribute(String(body.attributeKey), String(body.name), {
          valueType: body.valueType === 'INTEGER' ? 'INTEGER' : 'DECIMAL',
          minValue: typeof body.minValue === 'number' ? body.minValue : null,
          maxValue: typeof body.maxValue === 'number' ? body.maxValue : null,
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder)
        });
        this.attributes.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const detail = path.match(new RegExp(`^/api/admin/games/${GAME_ID}/attributes/([^/]+)$`));
    if (detail) {
      const attributeKey = detail[1]!;
      const existing = this.attributes.find((item) => item.attributeKey === attributeKey);

      if (method === 'GET') {
        if (!existing) {
          await this.error(route, 404, '404.ATTRIBUTE_NOT_FOUND', '属性不存在');
          return;
        }
        await this.json(route, 200, existing);
        return;
      }

      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyWriteFailure(route)) {
          return;
        }
        if (!existing) {
          await this.error(route, 404, '404.ATTRIBUTE_NOT_FOUND', '属性不存在');
          return;
        }
        const next: AttributeRow = {
          ...existing,
          name: String(body.name),
          valueType: body.valueType === 'INTEGER' ? 'INTEGER' : 'DECIMAL',
          minValue: typeof body.minValue === 'number' ? body.minValue : null,
          maxValue: typeof body.maxValue === 'number' ? body.maxValue : null,
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-22T11:00:00Z'
        };
        this.attributes = this.attributes.map((item) =>
          item.attributeKey === attributeKey ? next : item
        );
        await this.json(route, 200, next);
        return;
      }
    }

    this.unmockedRequests.push(`${method} ${path}`);
    await this.error(route, 404, '404.UNMOCKED', `unmocked API ${method} ${path}`);
  }

  private toSkillEffectSummary(row: SkillEffectRow): Json {
    return {
      gameId: row.gameId,
      skillKey: row.skillKey,
      effectKey: row.effectKey,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      resultCount: row.results.length,
      lifecycleEnabled: row.lifecycle !== null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private toSkillInternalStateSummary(row: SkillInternalStateRow): Json {
    return {
      gameId: row.gameId,
      skillKey: row.skillKey,
      stateKey: row.stateKey,
      name: row.name,
      stateType: row.stateType,
      scope: row.scope,
      description: row.description,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private buildSkillInternalStateRow(
    skillKey: string,
    stateKey: string,
    body: Json,
    existing?: SkillInternalStateRow
  ): SkillInternalStateRow {
    return {
      gameId: GAME_ID,
      skillKey,
      stateKey,
      name: String(body.name),
      stateType: String(body.stateType),
      scope: body.scope === 'TARGET' ? 'TARGET' : 'SKILL',
      description: typeof body.description === 'string' ? body.description : null,
      sortOrder: Number(body.sortOrder),
      detail: body.detail && typeof body.detail === 'object' ? body.detail as Json : {},
      createdAt: existing?.createdAt ?? CREATED_AT,
      updatedAt: existing ? '2026-08-23T11:00:00Z' : UPDATED_AT
    };
  }

  private toSkillProcessSummary(row: SkillProcessRow): Json {
    return {
      gameId: row.gameId,
      skillKey: row.skillKey,
      processKey: row.processKey,
      name: row.name,
      activationType: row.activationType,
      description: row.description,
      sortOrder: row.sortOrder,
      stepCount: row.steps.length,
      effectBindingCount: row.effectBindings.length,
      stateOperationCount: row.stateOperations.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private parseProcessMoment(raw: unknown): SkillProcessMomentRow {
    const moment = raw && typeof raw === 'object' ? raw as Json : {};
    return {
      momentType: String(moment.momentType ?? 'PROCESS_START'),
      stepKey: typeof moment.stepKey === 'string' ? moment.stepKey : null
    };
  }

  private buildSkillProcessRow(
    skillKey: string,
    processKey: string,
    body: Json,
    existing?: SkillProcessRow
  ): SkillProcessRow {
    const cooldownRaw = body.cooldown && typeof body.cooldown === 'object' ? body.cooldown as Json : null;
    return {
      gameId: GAME_ID,
      skillKey,
      processKey,
      name: String(body.name),
      activationType: String(body.activationType),
      description: typeof body.description === 'string' ? body.description : null,
      sortOrder: Number(body.sortOrder),
      cooldown: cooldownRaw
        ? {
            durationValue: cooldownRaw.durationValue as NumericValue,
            startMoment: this.parseProcessMoment(cooldownRaw.startMoment)
          }
        : null,
      steps: Array.isArray(body.steps)
        ? body.steps.map((raw) => {
            const item = raw as Json;
            return {
              stepKey: String(item.stepKey),
              name: String(item.name),
              stepType: String(item.stepType),
              description: typeof item.description === 'string' ? item.description : null,
              sortOrder: Number(item.sortOrder),
              detail: item.detail && typeof item.detail === 'object' ? item.detail as Json : {}
            };
          })
        : [],
      effectBindings: Array.isArray(body.effectBindings)
        ? body.effectBindings.map((raw) => {
            const item = raw as Json;
            return {
              bindingKey: String(item.bindingKey),
              effectKey: String(item.effectKey),
              moment: this.parseProcessMoment(item.moment),
              sortOrder: Number(item.sortOrder)
            };
          })
        : [],
      stateOperations: Array.isArray(body.stateOperations)
        ? body.stateOperations.map((raw) => {
            const item = raw as Json;
            return {
              operationKey: String(item.operationKey),
              name: String(item.name),
              stateKey: String(item.stateKey),
              operation: String(item.operation),
              value: (item.value ?? null) as NumericValue | null,
              optionKey: typeof item.optionKey === 'string' ? item.optionKey : null,
              moment: this.parseProcessMoment(item.moment),
              sortOrder: Number(item.sortOrder)
            };
          })
        : [],
      createdAt: existing?.createdAt ?? CREATED_AT,
      updatedAt: existing ? '2026-08-23T11:00:00Z' : UPDATED_AT
    };
  }

  private async applyInternalStateWriteFailure(route: Route): Promise<boolean> {
    if (this.internalStateWriteFailure === null) return false;
    if (this.internalStateWriteFailure === 'network') {
      await route.abort('connectionrefused');
      return true;
    }
    if (this.internalStateWriteFailure === 'validation') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '内部状态信息不合法', {
        fieldIssues: [
          { field: 'name', code: 'FORMAT_INVALID', message: '服务端内部状态名称校验失败' },
          { field: 'detail.options[1].initial', code: 'FORMAT_INVALID', message: '必须且只能选择一个初始选项。' }
        ]
      });
      return true;
    }
    if (this.internalStateWriteFailure === 'duplicate') {
      await this.error(route, 409, '409.SKILL_INTERNAL_STATE_KEY_EXISTS', '内部状态标识已存在');
      return true;
    }
    await this.error(route, 404, '404.SKILL_INTERNAL_STATE_NOT_FOUND', '技能内部状态不存在');
    return true;
  }

  private async applyProcessWriteFailure(route: Route): Promise<boolean> {
    if (this.processWriteFailure === null) return false;
    if (this.processWriteFailure === 'network') {
      await route.abort('connectionrefused');
      return true;
    }
    if (this.processWriteFailure === 'validation') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '技能过程信息不合法', {
        fieldIssues: [
          { field: 'name', code: 'FORMAT_INVALID', message: '服务端过程名称校验失败' },
          { field: 'effectBindings[0].moment.stepKey', code: 'UNKNOWN_STEP', message: '未知步骤。' }
        ]
      });
      return true;
    }
    if (this.processWriteFailure === 'duplicate') {
      await this.error(route, 409, '409.SKILL_PROCESS_KEY_EXISTS', '过程标识已存在');
      return true;
    }
    await this.error(route, 404, '404.SKILL_PROCESS_NOT_FOUND', '技能过程不存在');
    return true;
  }

  private cloneSkillEffect(row: SkillEffectRow): SkillEffectRow {
    return JSON.parse(JSON.stringify(row)) as SkillEffectRow;
  }

  private parseEffectResults(body: Json): SkillEffectResultRow[] {
    if (!Array.isArray(body.results)) {
      return [];
    }
    return body.results.map((raw) => {
      const item = raw as Json;
      const valueRule = item.valueRule && typeof item.valueRule === 'object'
        ? item.valueRule as SkillEffectValueRuleRow
        : null;
      return {
        resultKey: String(item.resultKey),
        name: String(item.name),
        resultType: String(item.resultType),
        target: item.target === 'SOURCE' ? 'SOURCE' : 'TARGET',
        description: typeof item.description === 'string' ? item.description : null,
        sortOrder: Number(item.sortOrder),
        spellShieldBlockScope: item.spellShieldBlockScope as SkillEffectResultRow['spellShieldBlockScope'],
        valueRule,
        detail: item.detail && typeof item.detail === 'object' ? item.detail as Json : {},
        lifecycleBehavior: item.lifecycleBehavior && typeof item.lifecycleBehavior === 'object'
          ? item.lifecycleBehavior as Json
          : null
      };
    });
  }

  private parseEffectLifecycle(body: Json): Json | null {
    return body.lifecycle && typeof body.lifecycle === 'object' ? body.lifecycle as Json : null;
  }

  private isLifecycleTargetInUse(skillKey: string, effectKey: string): boolean {
    return this.skillEffects.some((item) => (
      item.skillKey === skillKey
      && item.effectKey !== effectKey
      && item.results.some((result) => (
        result.resultType === 'LIFECYCLE_OPERATION'
        && result.detail
        && typeof result.detail === 'object'
        && (result.detail as { targetEffectKey?: string }).targetEffectKey === effectKey
      ))
    ));
  }

  private findRefreshTargetConflict(skillKey: string, effectKey: string, nextLifecycle: Json | null): boolean {
    const hadDuration = this.skillEffects.some((item) => (
      item.skillKey === skillKey
      && item.effectKey === effectKey
      && item.lifecycle
      && typeof item.lifecycle === 'object'
      && Boolean((item.lifecycle as { durationValue?: NumericValue | null }).durationValue)
    ));
    const nextDuration = nextLifecycle
      && typeof nextLifecycle === 'object'
      ? (nextLifecycle as { durationValue?: NumericValue | null }).durationValue
      : null;
    if (!hadDuration || nextDuration) {
      return false;
    }
    return this.skillEffects.some((item) => (
      item.skillKey === skillKey
      && item.results.some((result) => (
        result.resultType === 'LIFECYCLE_OPERATION'
        && result.detail
        && typeof result.detail === 'object'
        && (result.detail as { targetEffectKey?: string; operation?: string }).targetEffectKey === effectKey
        && (result.detail as { operation?: string }).operation === 'REFRESH'
      ))
    ));
  }

  private async applyLifecycleWriteRules(
    route: Route,
    skillKey: string,
    effectKey: string,
    body: Json,
    existing?: SkillEffectRow
  ): Promise<boolean> {
    const nextLifecycle = this.parseEffectLifecycle(body);
    if (existing && existing.lifecycle && nextLifecycle === null && this.isLifecycleTargetInUse(skillKey, effectKey)) {
      await this.error(
        route,
        409,
        '409.SKILL_EFFECT_LIFECYCLE_IN_USE',
        '该效果正在被其他效果的生命周期操作引用，不能关闭生命周期。'
      );
      return true;
    }
    if (this.findRefreshTargetConflict(skillKey, effectKey, nextLifecycle)) {
      await this.error(route, 409, '409.SKILL_EFFECT_LIFECYCLE_IN_USE', '仍被刷新操作引用', {
        fieldIssues: [
          {
            field: 'lifecycle.durationValue',
            code: 'REFRESH_OPERATION_IN_USE',
            message: '该持续时间仍被刷新操作引用。'
          }
        ]
      });
      return true;
    }
    if (!Array.isArray(body.results)) {
      return false;
    }
    const fieldIssues: Array<{ field: string; code: string; message: string }> = [];
    body.results.forEach((raw, index) => {
      const item = raw as Json;
      if (item.resultType !== 'LIFECYCLE_OPERATION' || !item.detail || typeof item.detail !== 'object') {
        return;
      }
      const detail = item.detail as { targetEffectKey?: string; operation?: string };
      if (detail.operation !== 'REFRESH' || !detail.targetEffectKey) {
        return;
      }
      const target = this.skillEffects.find((row) => (
        row.skillKey === skillKey && row.effectKey === detail.targetEffectKey
      ));
      const targetDuration = target?.lifecycle
        && typeof target.lifecycle === 'object'
        ? (target.lifecycle as { durationValue?: NumericValue | null }).durationValue
        : null;
      if (target && !targetDuration) {
        fieldIssues.push({
          field: `results[${index}].detail.targetEffectKey`,
          code: 'TARGET_EFFECT_HAS_NO_DURATION',
          message: '目标效果没有持续时间。'
        });
      }
    });
    if (fieldIssues.length > 0) {
      await this.error(route, 400, '400.INVALID_SKILL_EFFECT_REFERENCE', '技能效果引用不合法', { fieldIssues });
      return true;
    }
    return false;
  }

  private buildSkillEffectRow(
    skillKey: string,
    effectKey: string,
    body: Json,
    existing?: SkillEffectRow
  ): SkillEffectRow {
    return {
      gameId: GAME_ID,
      skillKey,
      effectKey,
      name: String(body.name),
      description: typeof body.description === 'string' ? body.description : null,
      sortOrder: Number(body.sortOrder),
      lifecycle: this.parseEffectLifecycle(body),
      results: this.parseEffectResults(body),
      createdAt: existing?.createdAt ?? CREATED_AT,
      updatedAt: existing ? '2026-08-23T11:00:00Z' : UPDATED_AT
    };
  }

  private async applyEffectWriteFailure(route: Route): Promise<boolean> {
    if (this.effectWriteFailure === null) {
      return false;
    }
    if (this.effectWriteFailure === 'network') {
      await route.abort('connectionrefused');
      return true;
    }
    if (this.effectWriteFailure === 'validation') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '效果信息不合法', {
        fieldIssues: [
          {
            field: 'name',
            code: 'FORMAT_INVALID',
            message: '服务端效果名称校验失败'
          }
        ]
      });
      return true;
    }
    if (this.effectWriteFailure === 'lifecycle-in-use') {
      await this.error(
        route,
        409,
        '409.SKILL_EFFECT_LIFECYCLE_IN_USE',
        '该效果正在被其他效果的生命周期操作引用，不能删除。'
      );
      return true;
    }
    if (this.effectWriteFailure === 'lifecycle-field') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '效果信息不合法', {
        fieldIssues: this.effectWriteFieldIssues.length > 0
          ? this.effectWriteFieldIssues
          : [
              {
                field: 'lifecycle.durationValue',
                code: 'FORMAT_INVALID',
                message: '持续时间取值不合法'
              }
            ]
      });
      return true;
    }
    if (this.effectWriteFailure === 'duplicate') {
      await this.error(route, 409, '409.SKILL_EFFECT_KEY_EXISTS', '效果标识已存在');
      return true;
    }
    if (this.effectWriteFailure === 'shape-in-use') {
      await this.error(route, 409, '409.SKILL_EFFECT_IN_USE', '结果形状变化会使既有前序输出失效', {
        fieldIssues: [
          {
            field: 'results[0].detail.vampRules',
            code: 'TRIGGER_RULE_SHAPE_IN_USE',
            message: '该结构仍被条件与触发规则使用',
            ruleKey: 'follow_up_from_hit',
            actionKey: 'apply_follow_up',
            bindingKey: 'bind_prior_hit',
            outputKind: 'ACTUAL_HEALING'
          }
        ]
      });
      return true;
    }
    await this.error(route, 404, '404.SKILL_EFFECT_NOT_FOUND', '技能效果不存在');
    return true;
  }

  private async applyStatusWriteFailure(route: Route): Promise<boolean> {
    if (this.statusWriteFailure === null) {
      return false;
    }
    if (this.statusWriteFailure === 'network') {
      await route.abort('connectionrefused');
      return true;
    }
    if (this.statusWriteFailure === 'validation') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '状态信息不合法', {
        fieldIssues: [
          {
            field: 'name',
            code: 'FORMAT_INVALID',
            message: '服务端状态名称校验失败'
          }
        ]
      });
      return true;
    }
    if (this.statusWriteFailure === 'duplicate') {
      await this.error(route, 409, '409.STATUS_KEY_EXISTS', '状态标识已存在');
      return true;
    }
    await this.error(route, 404, '404.STATUS_NOT_FOUND', '状态不存在');
    return true;
  }

  private async applyWriteFailure(route: Route): Promise<boolean> {
    if (this.writeFailure === null) {
      return false;
    }
    if (this.writeFailure === 'network') {
      await route.abort('connectionrefused');
      return true;
    }
    if (this.writeFailure === 'validation') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '属性信息不合法', {
        fieldIssues: [
          {
            field: 'name',
            code: 'FORMAT_INVALID',
            message: '服务端属性名称校验失败'
          }
        ]
      });
      return true;
    }
    if (this.writeFailure === 'duplicate') {
      await this.error(route, 409, '409.ATTRIBUTE_KEY_EXISTS', '稳定标识已存在');
      return true;
    }
    await this.error(route, 404, '404.ATTRIBUTE_NOT_FOUND', '属性不存在');
    return true;
  }

  private toTriggerRuleSummary(row: SkillTriggerRuleStored): Json {
    const eventSource = row.eventSource;
    return {
      ruleKey: row.ruleKey,
      name: row.name,
      description: row.description,
      eventType: typeof eventSource.eventType === 'string' ? eventSource.eventType : 'SKILL_USED',
      conditionGroupCount: row.conditionGroups.length,
      actionCount: row.actions.length,
      perTargetCooldownEnabled: row.perTargetCooldown !== null,
      maxTriggersPerProcessEnabled: row.maxTriggersPerProcess !== null,
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt
    };
  }

  private toTriggerRuleDetail(row: SkillTriggerRuleStored): Json {
    return {
      ruleKey: row.ruleKey,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      eventSource: this.cloneJson(row.eventSource),
      conditionGroups: this.cloneJson(row.conditionGroups),
      actions: this.cloneJson(row.actions),
      perTargetCooldown: this.cloneJson(row.perTargetCooldown),
      maxTriggersPerProcess: this.cloneJson(row.maxTriggersPerProcess)
    };
  }

  private buildTriggerRule(
    skillKey: string,
    ruleKey: string,
    body: Json,
    existing?: SkillTriggerRuleStored
  ): SkillTriggerRuleStored {
    return {
      gameId: GAME_ID,
      skillKey,
      ruleKey,
      name: String(body.name),
      description: typeof body.description === 'string' ? body.description : null,
      sortOrder: Number(body.sortOrder),
      eventSource: body.eventSource && typeof body.eventSource === 'object'
        ? body.eventSource as Json
        : { eventType: 'SKILL_USED', detail: {} },
      conditionGroups: Array.isArray(body.conditionGroups) ? body.conditionGroups as Json[] : [],
      actions: Array.isArray(body.actions) ? body.actions as Json[] : [],
      perTargetCooldown: body.perTargetCooldown && typeof body.perTargetCooldown === 'object'
        ? body.perTargetCooldown as Json
        : null,
      maxTriggersPerProcess: body.maxTriggersPerProcess && typeof body.maxTriggersPerProcess === 'object'
        ? body.maxTriggersPerProcess as Json
        : null,
      createdAt: existing?.createdAt ?? CREATED_AT,
      updatedAt: existing ? '2026-08-30T12:00:00Z' : UPDATED_AT
    };
  }

  private async applyTriggerRuleWrite(
    route: Route,
    method: string,
    path: string,
    body: Json
  ): Promise<boolean> {
    this.writes.push({ method, path, body });
    if (this.triggerRuleWriteHold) {
      await this.triggerRuleWriteHold;
    }
    if (this.triggerRuleWriteFailure === 'unprotected-cycle') {
      const firstAction = Array.isArray(body.actions) && body.actions[0] && typeof body.actions[0] === 'object'
        ? body.actions[0] as Json
        : {};
      await this.error(
        route,
        400,
        '400.TRIGGER_RULE_CYCLE_UNGUARDED',
        '当前技能规则图存在不经过任何保护边的有向环。',
        {
          fieldIssues: [
            {
              field: 'perTargetCooldown',
              code: 'TRIGGER_RULE_CYCLE_UNGUARDED',
              message: '当前关系形成没有保护的循环'
            },
            {
              field: 'actions[0].detail.effectKey',
              code: 'TRIGGER_RULE_CYCLE_UNGUARDED',
              message: '该动作会形成无保护循环'
            }
          ],
          cyclePath: [String(body.ruleKey ?? 'low_health_shield'), 'unknown_rule'],
          ruleKey: String(body.ruleKey ?? 'low_health_shield'),
          actionKey: String(firstAction.actionKey ?? 'action_1'),
          producedEvent: { eventType: 'RESULT_AVAILABLE', effectKey: 'shield_effect' }
        }
      );
      return true;
    }
    if (this.triggerRuleWriteFailure === 'not-found') {
      await this.error(route, 404, '404.SKILL_TRIGGER_RULE_NOT_FOUND', '触发规则不存在');
      return true;
    }
    if (this.triggerRuleWriteFailure === 'invalid-binding') {
      await this.error(route, 400, '400.INVALID_RUNTIME_INPUT_BINDING', '动态输入绑定不合法', {
        fieldIssues: [
          {
            field: 'actions[1].runtimeInputBindings[0].detail.outputKind',
            code: 'OUTPUT_KIND_NOT_AVAILABLE',
            message: '当前结果不提供该输出'
          }
        ]
      });
      return true;
    }
    return false;
  }

  private nextImageTimestamp(): string {
    this.imageClock += 1;
    return new Date(Date.UTC(2026, 8, 5, 12, 0, this.imageClock)).toISOString();
  }

  private readImageMetadata(imageBase64: string): Pick<ImageRow, 'mimeType' | 'byteSize' | 'width' | 'height'> {
    const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(imageBase64);
    if (!match) throw new Error('invalid mocked image data URL');
    const bytes = Buffer.from(match[2]!, 'base64');
    if (match[1] === 'image/png' && bytes.length >= 24) {
      return {
        mimeType: 'image/png',
        byteSize: bytes.length,
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20)
      };
    }
    return { mimeType: 'image/jpeg', byteSize: bytes.length, width: 64, height: 64 };
  }

  private async body(request: Request): Promise<Json> {
    const raw = request.postData();
    return raw ? JSON.parse(raw) as Json : {};
  }

  private async json(route: Route, status: number, body: unknown): Promise<void> {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  }

  private async error(
    route: Route,
    status: number,
    code: string,
    message: string,
    details: Json = {}
  ): Promise<void> {
    await this.json(route, status, { error: { code, message, details } });
  }
}

type Diagnostics = {
  assertClean: (label: string) => void;
};

async function prepare(page: Page, mock: MockApi): Promise<Diagnostics> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mock.install(page);
  await page.addInitScript(
    ({ apiKey, tokenKey, apiBase, token }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(apiKey, apiBase);
      window.localStorage.setItem(tokenKey, token);
    },
    {
      apiKey: API_BASE_STORAGE_KEY,
      tokenKey: ADMIN_TOKEN_STORAGE_KEY,
      apiBase: MOCK_API_BASE,
      token: ADMIN_TOKEN
    }
  );
  return {
    assertClean(label: string) {
      expect(pageErrors, `${label}: uncaught page errors`).toEqual([]);
      expect(mock.unmockedRequests, `${label}: unmocked API calls`).toEqual([]);
    }
  };
}

async function pngUpload(
  page: Page,
  width: number,
  height: number,
  name = `image-${width}x${height}.png`
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate(({ width: imageWidth, height: imageHeight }) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2563eb';
    context.fillRect(0, 0, imageWidth, imageHeight);
    context.fillStyle = '#ffffff';
    context.fillRect(Math.floor(imageWidth / 4), Math.floor(imageHeight / 4), Math.max(1, Math.floor(imageWidth / 2)), Math.max(1, Math.floor(imageHeight / 2)));
    return canvas.toDataURL('image/png');
  }, { width, height });
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64')
  };
}

async function waitForGame(page: Page): Promise<void> {
  await expect(page.locator('.app-toolbar-field--game .arco-select-view-value')).toContainText(
    GAME_ID,
    { timeout: 30_000 }
  );
}

async function openAttributes(page: Page): Promise<void> {
  await page.goto('/#/attributes');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();
}

async function openCharacters(page: Page): Promise<void> {
  await page.goto('/#/characters');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('角色管理', { exact: true }).first()).toBeVisible();
}

async function openEquipment(page: Page): Promise<void> {
  await page.goto('/#/equipment');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('装备管理', { exact: true }).first()).toBeVisible();
}

async function openSkillCategories(page: Page): Promise<void> {
  await page.goto('/#/skill-categories');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('技能分类管理', { exact: true }).first()).toBeVisible();
}

async function openDamageTypes(page: Page): Promise<void> {
  await page.goto('/#/damage-types');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('伤害类型管理', { exact: true }).first()).toBeVisible();
}

async function openModifierZones(page: Page): Promise<void> {
  await page.goto('/#/modifier-zones');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('乘区管理', { exact: true }).first()).toBeVisible();
}

async function openSkills(page: Page): Promise<void> {
  await page.goto('/#/skills');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('技能管理', { exact: true }).first()).toBeVisible();
}

async function openStatuses(page: Page): Promise<void> {
  await page.goto('/#/statuses');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('状态管理', { exact: true }).first()).toBeVisible();
}

async function openGameSettings(page: Page): Promise<void> {
  await page.goto('/#/game-settings');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('游戏配置', { exact: true }).first()).toBeVisible();
}

async function openImages(page: Page): Promise<void> {
  await page.goto('/#/images');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('图片管理', { exact: true }).first()).toBeVisible();
}

function attributeRow(page: Page, attributeKey: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: attributeKey, exact: true })
  });
}

function characterRow(page: Page, characterKey: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: characterKey, exact: true })
  });
}

function equipmentRow(page: Page, equipmentKey: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: equipmentKey, exact: true })
  });
}

function imageRow(page: Page, imageKey: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: imageKey, exact: true })
  });
}

function skillCategoryRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: key, exact: true })
  });
}

function damageTypeRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: key, exact: true })
  });
}

function modifierZoneRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: key, exact: true })
  });
}

function skillRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: key, exact: true })
  });
}

function statusRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: key, exact: true })
  });
}

function visibleModal(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title });
}

const SKILL_EFFECT_FORBIDDEN_TERMS = [
  '过程',
  '条件',
  '事件',
  '计算预览',
  'Wasm'
] as const;

async function assertNoForbiddenSkillEffectTerms(scope: Locator): Promise<void> {
  for (const text of SKILL_EFFECT_FORBIDDEN_TERMS) {
    await expect(scope.getByText(text, { exact: true })).toHaveCount(0);
  }
}

async function chooseVisibleOption(page: Page, name: string | RegExp): Promise<void> {
  const option = page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(option).toBeHidden();
}

async function chooseSelectOption(
  page: Page,
  modal: Locator,
  label: string,
  optionName: string
): Promise<void> {
  const source = modal.getByLabel(label + '取值来源', { exact: true });
  if (await source.count()) {
    await source.getByText('技能公式', { exact: true }).click();
    await modal.getByLabel(label + '技能公式', { exact: true }).click();
    await chooseVisibleOption(page, new RegExp('^' + optionName + '（'));
  } else {
    await modal.getByLabel(label, { exact: true }).click();
    await chooseVisibleOption(page, optionName);
  }
}

async function clickArcoRadioByVisibleLabel(modal: Locator, label: string): Promise<void> {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const radioLabel = modal.locator('label.arco-radio', {
    hasText: new RegExp('^' + escapedLabel + '$')
  });
  await expect(radioLabel).toBeVisible();
  await radioLabel.click();
  await expect(modal.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

function seedSkillEffectCatalog(
  mock: MockApi,
  skillKey = 'varus_w',
  skillName = '枯萎箭袋'
): void {
  mock.skillCategories = [{
    gameId: GAME_ID,
    skillCategoryKey: 'active',
    name: '主动技能',
    description: null,
    status: 'ENABLED',
    sortOrder: 10,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT
  }];
  mock.skills = [
    {
      gameId: GAME_ID,
      skillKey,
      name: skillName,
      description: null,
      maxLevel: 5,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['active'],
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey: 'other_skill',
      name: '其他技能',
      description: null,
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 1,
      skillCategoryKeys: ['active'],
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey: 'retired_skill',
      name: '退役技能',
      description: null,
      maxLevel: 1,
      status: 'DISABLED',
      sortOrder: 2,
      skillCategoryKeys: ['active'],
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
  mock.skillFormulas = [
    {
      gameId: GAME_ID,
      skillKey,
      formulaKey: 'damage',
      name: '伤害公式',
      description: null,
      sortOrder: 0,
      expression: { nodeType: 'PARAMETER', parameterKey: 'base_damage' },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey,
      formulaKey: 'heal',
      name: '治疗公式',
      description: null,
      sortOrder: 1,
      expression: { nodeType: 'PARAMETER', parameterKey: 'base_heal' },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey,
      formulaKey: 'one',
      name: '一层',
      description: null,
      sortOrder: 2,
      expression: { nodeType: 'PARAMETER', parameterKey: 'one' },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey,
      formulaKey: 'poison_duration_ms',
      name: '持续时间',
      description: null,
      sortOrder: 3,
      expression: { nodeType: 'PARAMETER', parameterKey: 'poison_duration_ms' },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey,
      formulaKey: 'poison_tick_interval_ms',
      name: '周期间隔',
      description: null,
      sortOrder: 4,
      expression: { nodeType: 'PARAMETER', parameterKey: 'poison_tick_interval_ms' },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
  mock.damageTypes = [
    {
      gameId: GAME_ID,
      damageTypeKey: 'physical',
      name: '物理伤害',
      description: null,
      status: 'ENABLED',
      sortOrder: 10,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      damageTypeKey: 'magic',
      name: '魔法伤害',
      description: null,
      status: 'DISABLED',
      sortOrder: 20,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
  mock.attributes = [
    attribute('attack_damage', '攻击力'),
    attribute('mana', '法力值'),
    attribute('old_attr', '旧属性', { status: 'DISABLED' })
  ];
  mock.statuses = [
    {
      gameId: GAME_ID,
      statusKind: 'STUN',
      statusKey: 'poison',
      name: '中毒',
      description: null,
      status: 'ENABLED',
      sortOrder: 10,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      statusKind: 'STUN',
      statusKey: 'old_poison',
      name: '旧中毒',
      description: null,
      status: 'DISABLED',
      sortOrder: 20,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
  mock.modifierZones = [
    {
      gameId: GAME_ID,
      modifierZoneKey: 'attribute_ratio',
      name: '属性比例加算',
      domain: 'ATTRIBUTE',
      calculationMode: 'RATIO_ADD',
      applicationStage: 'ATTRIBUTE_PERCENT',
      description: null,
      status: 'ENABLED',
      sortOrder: 10,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      modifierZoneKey: 'damage_ratio',
      name: '伤害比例加算',
      domain: 'DAMAGE',
      calculationMode: 'RATIO_ADD',
      applicationStage: 'DAMAGE_PRE_DEFENSE',
      description: null,
      status: 'ENABLED',
      sortOrder: 20,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      modifierZoneKey: 'healing_ratio',
      name: '治疗比例加算',
      domain: 'HEALING',
      calculationMode: 'RATIO_ADD',
      applicationStage: 'HEALING_RESULT',
      description: null,
      status: 'ENABLED',
      sortOrder: 30,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
}

function valueRule(
  formulaKey: string,
  overrides: Partial<SkillEffectValueRuleRow> = {}
): SkillEffectValueRuleRow {
  return {
    value: formulaValue(formulaKey),
    fixedMultiplier: 1,
    fixedMinValue: null,
    fixedMaxValue: null,
    ...overrides
  };
}

function damageResultDetail(damageTypeKey: string): Json {
  return {
    damageTypeKey,
    deliveryKind: 'SKILL',
    originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null },
    vampRules: []
  };
}

async function openSkillEffects(page: Page, skillKey: string, skillName: string): Promise<Locator> {
  await skillRow(page, skillKey).getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = visibleModal(page, `效果与结果 - ${skillName}`);
  await expect(shell).toBeVisible();
  return shell;
}

const SKILL_PROCESS_FORBIDDEN_TERMS = [
  '生命周期',
  '外部事件',
  '动态输入',
  '暴击',
  '吸血',
  '前序结果',
  '计算预览',
  'Wasm'
] as const;

async function assertNoForbiddenSkillProcessTerms(scope: Locator): Promise<void> {
  for (const text of SKILL_PROCESS_FORBIDDEN_TERMS) {
    await expect(scope.getByText(text, { exact: true })).toHaveCount(0);
  }
}

function formulaRow(
  skillKey: string,
  formulaKey: string,
  name: string,
  sortOrder: number
): SkillFormulaRow {
  return {
    gameId: GAME_ID,
    skillKey,
    formulaKey,
    name,
    description: null,
    sortOrder,
    expression: { nodeType: 'PARAMETER', parameterKey: formulaKey },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT
  };
}

function seedSkillProcessCatalog(mock: MockApi, skillKey = 'varus_w', skillName = '枯萎箭袋'): void {
  seedSkillEffectCatalog(mock, skillKey, skillName);
  mock.skillFormulas = [
    ...mock.skillFormulas,
    formulaRow(skillKey, 'zero', '零', 10),
    formulaRow(skillKey, 'focus_max_stacks', '专注上限', 11),
    formulaRow(skillKey, 'max_ammo', '最大弹药', 12),
    formulaRow(skillKey, 'ammo_recovery_ms', '弹药恢复', 13),
    formulaRow(skillKey, 'internal_cooldown_ms', '内部冷却时长', 14),
    formulaRow(skillKey, 'cooldown_ms', '冷却时长', 15),
    formulaRow(skillKey, 'impact_delay_ms', '延迟', 16),
    formulaRow(skillKey, 'hit_count', '段数', 17),
    formulaRow(skillKey, 'tick_count', '周期次数', 18),
    formulaRow(skillKey, 'tick_interval_ms', '周期间隔', 19),
    formulaRow(skillKey, 'channel_duration_ms', '引导时长', 20),
    formulaRow(skillKey, 'channel_hit_count', '引导次数', 21),
    formulaRow(skillKey, 'minimum_charge_ms', '最短蓄力', 22),
    formulaRow(skillKey, 'maximum_charge_ms', '最长蓄力', 23),
    formulaRow(skillKey, 'recast_window_ms', '重施窗口', 24),
    formulaRow(skillKey, 'maximum_recasts', '最大重施', 25),
    formulaRow(skillKey, 'empowered_attack_window_ms', '强化窗口', 26),
    formulaRow(skillKey, 'focus_cost', '专注消耗', 27)
  ];
  mock.skillEffects = [
    {
      gameId: GAME_ID,
      skillKey,
      effectKey: 'on_hit_results',
      name: '命中结果',
      description: null,
      sortOrder: 10,
      lifecycle: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: [{
        resultKey: 'damage',
        name: '造成物理伤害',
        resultType: 'DAMAGE',
        target: 'TARGET',
        description: null,
        sortOrder: 10,
        spellShieldBlockScope: null,
        valueRule: valueRule('damage'),
        detail: damageResultDetail('physical'),
        lifecycleBehavior: null
      }]
    },
    {
      gameId: GAME_ID,
      skillKey,
      effectKey: 'mana_cost',
      name: '法力消耗',
      description: null,
      sortOrder: 20,
      lifecycle: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: [{
        resultKey: 'consume_mana',
        name: '扣除法力',
        resultType: 'RESOURCE_CHANGE',
        target: 'SOURCE',
        description: null,
        sortOrder: 10,
        spellShieldBlockScope: null,
        valueRule: valueRule('heal'),
        detail: { attributeKey: 'mana', operation: 'CONSUME' },
        lifecycleBehavior: null
      }]
    }
  ];
}

async function openSkillProcesses(page: Page, skillKey: string, skillName: string): Promise<Locator> {
  await skillRow(page, skillKey).getByRole('button', { name: '过程与内部状态', exact: true }).click();
  const shell = visibleModal(page, `过程与内部状态 - ${skillName}`);
  await expect(shell).toBeVisible();
  return shell;
}

async function openSkillTriggers(page: Page, skillKey: string, skillName: string): Promise<Locator> {
  await skillRow(page, skillKey).getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = visibleModal(page, `条件与触发 - ${skillName}`);
  await expect(shell).toBeVisible();
  return shell;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const STAGE_76_FORBIDDEN_OUTPUT_TERMS = [
  '实际治疗',
  '是否被法术护盾阻挡（0/1）',
  '乘区加算',
  '乘区因子',
  '最终修正值',
  'MODIFIER_ZONE_SUM',
  'MODIFIER_ZONE_FACTOR',
  'FINAL_MODIFIED_VALUE',
  'ZONE_ADDEND',
  'FREE_OUTPUT',
  'PERSISTENT'
] as const;

function seedSkillTriggerCatalog(mock: MockApi, skillKey = 'varus_w', skillName = '枯萎箭袋'): void {
  seedSkillProcessCatalog(mock, skillKey, skillName);
  mock.attributes = [
    ...mock.attributes,
    attribute('hp', '生命值')
  ];
  mock.skillParameters = [
    {
      gameId: GAME_ID,
      skillKey,
      parameterKey: 'prior_hit_value',
      name: '前序命中值',
      valueType: 'DECIMAL',
      valueMode: 'RUNTIME_INPUT',
      fixedValue: null,
      levelValues: null,
      description: null,
      sortOrder: 0,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    },
    {
      gameId: GAME_ID,
      skillKey,
      parameterKey: 'low_health_ratio',
      name: '低生命比例',
      valueType: 'DECIMAL',
      valueMode: 'FIXED',
      fixedValue: 0.3,
      levelValues: null,
      description: null,
      sortOrder: 1,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
  mock.skillFormulas = [
    ...mock.skillFormulas,
    formulaRow(skillKey, 'hp_threshold', '低生命阈值', 40),
    {
      gameId: GAME_ID,
      skillKey,
      formulaKey: 'follow_up',
      name: '追加伤害公式',
      description: null,
      sortOrder: 41,
      expression: { nodeType: 'PARAMETER', parameterKey: 'prior_hit_value' },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }
  ];
  mock.skillFormulas = mock.skillFormulas.map((item) => (
    item.formulaKey === 'hp_threshold'
      ? { ...item, expression: { nodeType: 'PARAMETER', parameterKey: 'low_health_ratio' } }
      : item
  ));
  mock.skillEffects = [
    ...mock.skillEffects,
    {
      gameId: GAME_ID,
      skillKey,
      effectKey: 'shield_effect',
      name: '低生命护盾',
      description: null,
      sortOrder: 30,
      lifecycle: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: [{
        resultKey: 'apply_shield',
        name: '施加护盾',
        resultType: 'NORMAL_SHIELD',
        target: 'SOURCE',
        description: null,
        sortOrder: 10,
        spellShieldBlockScope: null,
        valueRule: valueRule('heal'),
        detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' },
        lifecycleBehavior: null
      }]
    },
    {
      gameId: GAME_ID,
      skillKey,
      effectKey: 'follow_up_hit',
      name: '追加伤害',
      description: null,
      sortOrder: 40,
      lifecycle: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: [{
        resultKey: 'scaled_hit',
        name: '追加打击',
        resultType: 'DAMAGE',
        target: 'TARGET',
        description: null,
        sortOrder: 10,
        spellShieldBlockScope: null,
        valueRule: valueRule('follow_up'),
        detail: damageResultDetail('physical'),
        lifecycleBehavior: null
      }]
    },
    {
      gameId: GAME_ID,
      skillKey,
      effectKey: 'focus_mark',
      name: '专注标记',
      description: null,
      sortOrder: 50,
      lifecycle: {
        durationValue: formulaValue("poison_duration_ms"),
        maxStacksValue: formulaValue("one"),
        applicationStacksValue: formulaValue("one"),
        instanceScope: 'TARGET',
        reapplicationStackMode: 'INCREASE',
        reapplicationDurationMode: 'REFRESH_ALL',
        expiryMode: 'ALL_AT_ONCE',
        periodicIntervalValue: null,
        firstPeriodicExecution: null
      },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: [{
        resultKey: 'apply_mark',
        name: '施加标记',
        resultType: 'STATUS_OPERATION',
        target: 'TARGET',
        description: null,
        sortOrder: 10,
        spellShieldBlockScope: null,
        valueRule: null,
        detail: { statusKey: 'poison', operation: 'APPLY' },
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: null,
          stackValueMode: null,
          reapplicationValueMode: null,
          periodicExecutionMode: null
        }
      }]
    }
  ];
  mock.skillInternalStates = [{
    gameId: GAME_ID,
    skillKey,
    stateKey: 'focus_stacks',
    name: '专注层数',
    stateType: 'COUNTER',
    scope: 'SKILL',
    description: null,
    sortOrder: 10,
    detail: { initialValue: formulaValue("zero"), maxValue: formulaValue("focus_max_stacks") },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT
  }];
  mock.skillProcesses = [{
    gameId: GAME_ID,
    skillKey,
    processKey: 'primary_cast',
    name: '主要施放过程',
    activationType: 'ACTIVE',
    description: null,
    sortOrder: 10,
    cooldown: null,
    steps: [{
      stepKey: 'hit',
      name: '命中',
      stepType: 'IMMEDIATE',
      description: null,
      sortOrder: 0,
      detail: {}
    }],
    effectBindings: [],
    stateOperations: [],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT
  }];
}

async function chooseTriggerEventType(page: Page, modal: Locator, optionName: string): Promise<void> {
  const trigger = modal.getByLabel('事件类型', { exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const textbox = trigger.getByRole('textbox');
  if (await textbox.count()) {
    await textbox.fill(optionName);
  }
  await chooseVisibleOption(page, optionName);
  const confirm = page.getByRole('dialog').filter({ hasText: /将清除|将关闭该保护/ });
  const prompted = await confirm.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
  if (prompted) {
    await confirm.getByRole('button', { name: '确定', exact: true }).click();
  }
  await expect(trigger).toContainText(optionName);
}

async function fillExecuteEffectAction(
  page: Page,
  actionModal: Locator,
  values: { key?: string; name: string; effectName: string }
): Promise<void> {
  await expect(actionModal).toBeVisible();
  if (values.key) {
    await actionModal.getByLabel('动作标识', { exact: true }).fill(values.key);
  }
  await actionModal.getByLabel('动作名称', { exact: true }).fill(values.name);
  await chooseSelectOption(page, actionModal, '目标效果', values.effectName);
  await expect(actionModal.getByRole('button', { name: '确定', exact: true })).toBeEnabled();
  await actionModal.getByRole('button', { name: '确定', exact: true }).click();
  await expect(actionModal).toBeHidden();
}

async function bindPriorActionResult(
  page: Page,
  bindingModal: Locator,
  values: { sourceAction: string; sourceResult: string; output: string }
): Promise<void> {
  await chooseSelectOption(page, bindingModal, '来源种类', '更早动作结果');
  await chooseSelectOption(page, bindingModal, '来源动作', values.sourceAction);
  await chooseSelectOption(page, bindingModal, '来源结果', values.sourceResult);
  await chooseSelectOption(page, bindingModal, '结果输出', values.output);
}

async function closeVisibleDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function fillValueRule(
  page: Page,
  modal: Locator,
  formulaName: string,
  label = '数值'
): Promise<void> {
  await chooseSelectOption(page, modal, label, formulaName);
}

async function saveOpenModal(modal: Locator): Promise<void> {
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(modal).toBeHidden();
}

async function closeEditorByOutsideOrEscape(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name === 'Desktop Chrome') {
    await page
      .locator('.arco-modal-wrapper:visible')
      .filter({ has: page.locator('.arco-modal:visible') })
      .last()
      .click({ position: { x: 8, y: 8 } });
    return;
  }
  await page.keyboard.press('Escape');
}

async function fillCreateDraft(
  page: Page,
  values: { key: string; name: string; description?: string }
): Promise<Locator> {
  await page.getByRole('button', { name: '新增属性' }).click();
  const modal = visibleModal(page, '新增属性');
  await expect(modal).toBeVisible();
  await modal.getByLabel('稳定标识').fill(values.key);
  await modal.getByLabel('属性名称').fill(values.name);
  if (values.description !== undefined) {
    await modal.getByLabel('说明').fill(values.description);
  }
  return modal;
}

test.describe('character management without Wasm', () => {
  test('updates the level range on the standalone game settings page', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openGameSettings(page);
    await expect(page.getByLabel('最小等级', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('最大等级', { exact: true })).toHaveValue('2');
    await page.getByLabel('最大等级', { exact: true }).fill('3');
    await page.getByRole('button', { name: '保存等级范围', exact: true }).click();
    const confirmModal = visibleModal(page, '确认调整等级范围');
    await confirmModal.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page.getByText('等级范围已保存。', { exact: true })).toBeVisible();
    expect(mock.minLevel).toBe(1);
    expect(mock.maxLevel).toBe(3);
    diagnostics.assertClean('standalone game settings');
  });

  test('creates, edits, replaces the level map and hard deletes a character', async ({ page }) => {
    const mock = new MockApi();
    mock.attributes = [
      attribute('move_speed', '移动速度'),
      attribute('hp', '生命值')
    ];
    const diagnostics = await prepare(page, mock);

    await openCharacters(page);
    await expect(page.getByText('暂无角色', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增角色', exact: true }).click();
    const createModal = visibleModal(page, '新增角色');
    await createModal.getByLabel('角色标识', { exact: true }).fill('ashe');
    await createModal.getByLabel('角色名称', { exact: true }).fill('艾希');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(characterRow(page, 'ashe')).toContainText('艾希');

    await characterRow(page, 'ashe').getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑角色');
    await expect(editModal.getByLabel('角色标识', { exact: true })).toBeDisabled();
    await editModal.getByLabel('角色名称', { exact: true }).fill('寒冰射手');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(characterRow(page, 'ashe')).toContainText('寒冰射手');

    await characterRow(page, 'ashe').getByRole('button', { name: '等级属性', exact: true }).click();
    const attributesModal = visibleModal(page, '等级属性 - 寒冰射手');
    await expect(attributesModal.getByText('0 个属性已配置 / 2 个属性未配置')).toBeVisible();
    await expect(attributesModal.getByRole('cell', { name: '—', exact: true }).first()).toBeVisible();
    await attributesModal.getByRole('row').filter({ hasText: 'move_speed' })
      .getByRole('button', { name: '设置', exact: true }).click();
    const rowEditor = visibleModal(page, '设置属性 - 移动速度');
    await rowEditor.getByText('每级递增', { exact: true }).click();
    await rowEditor.getByLabel('Lv1 数值', { exact: true }).fill('300');
    await rowEditor.getByLabel('每级增量', { exact: true }).fill('25');
    await rowEditor.getByRole('button', { name: '应用', exact: true }).click();
    await expect(attributesModal.getByText('+25 / level', { exact: true })).toBeVisible();
    await expect(attributesModal.getByRole('cell', { name: '300', exact: true })).toBeVisible();
    await expect(attributesModal.getByRole('cell', { name: '325', exact: true })).toBeVisible();

    await attributesModal.getByText('只显示已配置', { exact: true }).click();
    await expect(attributesModal.getByText('生命值', { exact: true })).toHaveCount(0);
    await attributesModal.getByText('只显示已配置', { exact: true }).click();
    await attributesModal.getByLabel('搜索属性', { exact: true }).fill('生命值');
    await expect(attributesModal.getByText('生命值', { exact: true })).toBeVisible();
    await expect(attributesModal.getByText('移动速度', { exact: true })).toHaveCount(0);
    await attributesModal.getByLabel('搜索属性', { exact: true }).fill('');

    await attributesModal.getByRole('button', { name: '+ 添加属性', exact: true }).click();
    const addEditor = visibleModal(page, '设置属性 - 生命值');
    await addEditor.getByLabel('Lv1 数值', { exact: true }).fill('500');
    await addEditor.getByRole('button', { name: '应用', exact: true }).click();
    await expect(attributesModal.getByText('2 个属性已配置 / 0 个属性未配置')).toBeVisible();
    await attributesModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('角色「寒冰射手」的等级属性已保存。')).toBeVisible();
    await expect(attributesModal).toBeHidden();
    expect(mock.characterAttributes.ashe).toEqual({
      '1': { move_speed: 300, hp: 500 },
      '2': { move_speed: 325, hp: 500 }
    });
    await characterRow(page, 'ashe').getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除角色');
    await expect(deleteModal.getByText('确定删除角色「寒冰射手」吗？')).toBeVisible();
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(characterRow(page, 'ashe')).toHaveCount(0);
    expect(mock.characterAttributes.ashe).toBeUndefined();
    diagnostics.assertClean('character CRUD and level map');
  });
});

test.describe('equipment management without Wasm', () => {
  test('creates, edits, replaces direct attributes and hard deletes equipment', async ({ page }) => {
    const mock = new MockApi();
    mock.attributes = [
      attribute('armor_pen_percent', '百分比护甲穿透'),
      attribute('hp', '生命值')
    ];
    const diagnostics = await prepare(page, mock);

    await openEquipment(page);
    await expect(page.getByText('暂无装备', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增装备', exact: true }).click();
    const createModal = visibleModal(page, '新增装备');
    await createModal.getByLabel('装备标识', { exact: true }).fill('long_sword');
    await createModal.getByLabel('装备名称', { exact: true }).fill('长剑');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(equipmentRow(page, 'long_sword')).toContainText('长剑');

    await equipmentRow(page, 'long_sword').getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑装备');
    await expect(editModal.getByLabel('装备标识', { exact: true })).toBeDisabled();
    await editModal.getByLabel('装备名称', { exact: true }).fill('长剑改');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(equipmentRow(page, 'long_sword')).toContainText('长剑改');

    await equipmentRow(page, 'long_sword').getByRole('button', { name: '装备属性', exact: true }).click();
    const attributesModal = visibleModal(page, '装备属性 - 长剑改');
    await expect(attributesModal.getByText('0 个属性已配置 / 2 个属性未配置')).toBeVisible();
    await attributesModal.getByRole('row').filter({ hasText: 'armor_pen_percent' })
      .getByRole('button', { name: '设置', exact: true }).click();
    const valueEditor = visibleModal(page, '设置属性 - 百分比护甲穿透');
    await valueEditor.getByLabel('属性数值', { exact: true }).fill('30');
    await valueEditor.getByRole('button', { name: '应用', exact: true }).click();
    await expect(attributesModal.getByRole('cell', { name: '30', exact: true })).toBeVisible();
    await attributesModal.getByText('只显示已配置', { exact: true }).click();
    await expect(attributesModal.getByText('生命值', { exact: true })).toHaveCount(0);
    await attributesModal.getByText('只显示已配置', { exact: true }).click();
    await attributesModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('装备「长剑改」的属性已保存。')).toBeVisible();
    await expect(attributesModal).toBeHidden();
    expect(mock.equipmentAttributes.long_sword).toEqual({ armor_pen_percent: 30 });

    await equipmentRow(page, 'long_sword').getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除装备');
    await expect(deleteModal.getByText('确定删除装备「长剑改」吗？')).toBeVisible();
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(equipmentRow(page, 'long_sword')).toHaveCount(0);
    expect(mock.equipmentAttributes.long_sword).toBeUndefined();
    diagnostics.assertClean('equipment CRUD and direct attributes');
  });
});

test.describe('skill category and damage type management without Wasm', () => {
  test('manages flat skill categories with stable status filtering', async ({ page }, testInfo) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openSkillCategories(page);
    await expect(page.getByText('暂无技能分类', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增技能分类', exact: true }).click();
    const createModal = visibleModal(page, '新增技能分类');
    await createModal.getByLabel('技能分类标识', { exact: true }).fill('active');
    await createModal.getByLabel('技能分类名称', { exact: true }).fill('主动技能');
    await createModal.getByLabel('排序', { exact: true }).fill('10');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(skillCategoryRow(page, 'active')).toContainText('主动技能');

    await skillCategoryRow(page, 'active').getByRole('button', { name: '查看', exact: true }).click();
    const viewModal = visibleModal(page, '查看技能分类');
    await expect(viewModal).toBeVisible();
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();

    await skillCategoryRow(page, 'active').getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑技能分类');
    await expect(editModal.getByLabel('技能分类标识', { exact: true })).toBeDisabled();
    await editModal.getByLabel('技能分类名称', { exact: true }).fill('主动技能改');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    await expect(skillCategoryRow(page, 'active')).toContainText('主动技能改');

    await skillCategoryRow(page, 'active').getByRole('button', { name: '停用', exact: true }).click();
    const disableModal = visibleModal(page, '停用技能分类');
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    await expect(disableModal).toBeHidden();
    await expect(skillCategoryRow(page, 'active')).toContainText('停用');

    const statusFilter = page.getByLabel('技能分类状态筛选');
    await statusFilter.getByText('停用', { exact: true }).click();
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(statusFilter.getByRole('radio', { name: '停用' })).toBeChecked();
    await expect(skillCategoryRow(page, 'active')).toBeVisible();

    await skillCategoryRow(page, 'active').getByRole('button', { name: '启用', exact: true }).click();
    const enableModal = visibleModal(page, '启用技能分类');
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    await expect(enableModal).toBeHidden();
    await expect(skillCategoryRow(page, 'active')).toHaveCount(0);

    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(skillCategoryRow(page, 'active')).toBeVisible();
    await skillCategoryRow(page, 'active').getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除技能分类');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(skillCategoryRow(page, 'active')).toHaveCount(0);
    diagnostics.assertClean('flat skill category management');
  });

  test('manages damage types independently', async ({ page }, testInfo) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openDamageTypes(page);
    await expect(page.getByText('暂无伤害类型', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增伤害类型', exact: true }).click();
    const createModal = visibleModal(page, '新增伤害类型');
    await createModal.getByLabel('伤害类型标识', { exact: true }).fill('physical');
    await createModal.getByLabel('伤害类型名称', { exact: true }).fill('物理伤害');
    await createModal.getByLabel('排序', { exact: true }).fill('10');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(damageTypeRow(page, 'physical')).toContainText('物理伤害');

    await damageTypeRow(page, 'physical').getByRole('button', { name: '查看', exact: true }).click();
    const viewModal = visibleModal(page, '查看伤害类型');
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();

    await damageTypeRow(page, 'physical').getByRole('button', { name: '停用', exact: true }).click();
    const disableModal = visibleModal(page, '停用伤害类型');
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    await expect(damageTypeRow(page, 'physical')).toContainText('停用');

    await damageTypeRow(page, 'physical').getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除伤害类型');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(damageTypeRow(page, 'physical')).toHaveCount(0);
    diagnostics.assertClean('damage type management');
  });

  test('manages modifier zones independently', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openModifierZones(page);
    await expect(page.getByText('暂无乘区', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新增乘区', exact: true }).click();
    const createModal = visibleModal(page, '新增乘区');
    await createModal.getByLabel('乘区标识', { exact: true }).fill('damage_pre_defense');
    await createModal.getByLabel('乘区名称', { exact: true }).fill('伤害前修正');
    await chooseSelectOption(page, createModal, '乘区作用域', '伤害');
    await chooseSelectOption(page, createModal, '乘区计算方式', '比例加算');
    await chooseSelectOption(page, createModal, '乘区应用阶段', '防御计算前伤害');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(modifierZoneRow(page, 'damage_pre_defense')).toContainText('伤害前修正');

    await modifierZoneRow(page, 'damage_pre_defense').getByRole('button', { name: '停用', exact: true }).click();
    const disableModal = visibleModal(page, '停用乘区');
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    await expect(disableModal).toBeHidden();
    await expect(modifierZoneRow(page, 'damage_pre_defense')).toContainText('停用');
    diagnostics.assertClean('modifier zone management');
  });
});

test.describe('status management without Wasm', () => {
  test('manages flat statuses with stable filtering, refresh and retained drafts', async ({ page }, testInfo) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openStatuses(page);
    await expect(page.getByText('暂无状态', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '启停状态', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增状态', exact: true }).click();
    const createModal = visibleModal(page, '新增状态');
    await createModal.getByLabel('状态种类', { exact: true }).click();
    await page.getByRole('option', { name: '眩晕', exact: true }).click();
    await createModal.getByLabel('状态标识', { exact: true }).fill('stun');
    await createModal.getByLabel('状态名称', { exact: true }).fill('眩晕');
    await createModal.getByLabel('说明', { exact: true }).fill('控制类状态');
    await createModal.getByLabel('排序', { exact: true }).fill('10');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(statusRow(page, 'stun')).toContainText('眩晕');
    expect(mock.statuses[0]?.status).toBe('ENABLED');
    expect(mock.writes[0]?.body).not.toHaveProperty('category');

    await page.getByRole('button', { name: '刷新', exact: true }).last().click();
    await expect(statusRow(page, 'stun')).toContainText('眩晕');
    await expect(statusRow(page, 'stun')).toContainText('控制类状态');

    await statusRow(page, 'stun').getByRole('button', { name: '查看', exact: true }).click();
    const viewModal = visibleModal(page, '查看状态');
    await expect(viewModal).toBeVisible();
    await expect(viewModal.getByLabel('状态标识', { exact: true })).toBeDisabled();
    await expect(viewModal.getByText(/启停状态：启用/)).toBeVisible();
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();

    await statusRow(page, 'stun').getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑状态');
    await expect(editModal.getByLabel('状态标识', { exact: true })).toBeDisabled();
    await expect(editModal.getByText('启停状态')).toHaveCount(0);
    await editModal.getByLabel('状态名称', { exact: true }).fill('眩晕改');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    await expect(statusRow(page, 'stun')).toContainText('眩晕改');
    const editWrite = mock.writes.find((item) => item.method === 'PUT');
    expect(editWrite?.body).not.toHaveProperty('statusKey');
    expect(editWrite?.body.status).toBe('ENABLED');

    await page.getByRole('button', { name: '新增状态', exact: true }).click();
    const outsideCloseModal = visibleModal(page, '新增状态');
    await outsideCloseModal.getByLabel('状态名称', { exact: true }).fill('未保存状态');
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(outsideCloseModal).toBeHidden();
    expect(mock.statuses).toHaveLength(1);

    mock.statusWriteFailure = 'validation';
    await page.getByRole('button', { name: '新增状态', exact: true }).click();
    const failedModal = visibleModal(page, '新增状态');
    await failedModal.getByLabel('状态种类', { exact: true }).click();
    await page.getByRole('option', { name: '普通移动减速', exact: true }).click();
    await failedModal.getByLabel('状态标识', { exact: true }).fill('slow');
    await failedModal.getByLabel('状态名称', { exact: true }).fill('减速草稿');
    await failedModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(failedModal.getByText('服务端状态名称校验失败')).toBeVisible();
    await expect(failedModal.getByLabel('状态标识', { exact: true })).toHaveValue('slow');
    await expect(failedModal.getByLabel('状态名称', { exact: true })).toHaveValue('减速草稿');
    mock.statusWriteFailure = 'duplicate';
    await failedModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(failedModal.getByText(/409\.STATUS_KEY_EXISTS/)).toBeVisible();
    await expect(failedModal.getByLabel('状态名称', { exact: true })).toHaveValue('减速草稿');
    await failedModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(failedModal).toBeHidden();
    mock.statusWriteFailure = null;
    expect(mock.statuses).toHaveLength(1);

    await statusRow(page, 'stun').getByRole('button', { name: '停用', exact: true }).click();
    const disableModal = visibleModal(page, '停用状态');
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    await expect(disableModal).toBeHidden();
    await expect(statusRow(page, 'stun')).toContainText('停用');

    const statusFilter = page.getByLabel('状态筛选', { exact: true });
    await statusFilter.getByText('停用', { exact: true }).click();
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(statusFilter.getByRole('radio', { name: '停用' })).toBeChecked();
    await expect(statusRow(page, 'stun')).toBeVisible();
    await expect.poll(() => mock.listQueries.at(-1)?.status).toBe('DISABLED');

    await page.getByRole('button', { name: '刷新', exact: true }).last().click();
    await expect(statusFilter.getByRole('radio', { name: '停用' })).toBeChecked();

    await statusRow(page, 'stun').getByRole('button', { name: '启用', exact: true }).click();
    const enableModal = visibleModal(page, '启用状态');
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    await expect(enableModal).toBeHidden();
    await expect(statusRow(page, 'stun')).toHaveCount(0);

    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(statusFilter.getByRole('radio', { name: '全部' })).toBeChecked();
    await expect(statusRow(page, 'stun')).toBeVisible();
    await statusRow(page, 'stun').getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除状态');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(statusRow(page, 'stun')).toHaveCount(0);
    await expect(page.getByText('暂无状态', { exact: true })).toBeVisible();
    diagnostics.assertClean('flat status management');
  });
});

test.describe('skill management without Wasm', () => {
  test('paginates skills locally and preserves editing position while recovering an empty last page', async ({ page }) => {
    const mock = new MockApi();
    mock.skills = Array.from({ length: 51 }, (_, i) => ({
      gameId: GAME_ID, skillKey: `paged_${String(i + 1).padStart(3, '0')}`,
      name: `分页技能${i + 1}`, description: null, maxLevel: 5,
      status: 'ENABLED', sortOrder: i, skillCategoryKeys: [],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }));
    const diagnostics = await prepare(page, mock);
    let listReads = 0;
    const imageReads = new Set<string>();
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/skills`) listReads += 1;
      const match = path.match(/\/skills\/(paged_\d+)\/representative-image$/);
      if (match) imageReads.add(match[1]);
    });
    await openSkills(page);
    const rows = page.locator('main tbody tr');
    await expect(rows).toHaveCount(25);
    await expect(skillRow(page, 'paged_025')).toBeVisible();
    await expect(skillRow(page, 'paged_026')).toHaveCount(0);
    expect(imageReads.has('paged_026')).toBe(false);
    const beforeFlip = listReads;

    await page.getByLabel('第 3 页', { exact: true }).click();
    await expect(rows).toHaveCount(1);
    await skillRow(page, 'paged_051').getByRole('button', { name: '编辑', exact: true }).click();
    const editor = visibleModal(page, '编辑技能');
    await expect(editor.getByLabel('技能标识', { exact: true })).toHaveValue('paged_051');
    expect(listReads).toBe(beforeFlip);
    await editor.getByLabel('说明', { exact: true }).fill('编辑后留在第三页');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByLabel('第 3 页', { exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(skillRow(page, 'paged_051')).toBeVisible();
    expect(mock.skills[50].description).toBe('编辑后留在第三页');

    await skillRow(page, 'paged_051').getByRole('button', { name: '删除', exact: true }).click();
    await visibleModal(page, '删除技能').getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.getByLabel('第 2 页', { exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(rows).toHaveCount(25);
    await expect(skillRow(page, 'paged_050')).toBeVisible();

    await page.getByLabel('技能关键词', { exact: true }).fill('paged_001');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByLabel('第 1 页', { exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(skillRow(page, 'paged_001')).toBeVisible();
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(rows).toHaveCount(25);
    const beforeResize = listReads;
    await page.locator('.arco-pagination-option').getByRole('combobox').click();
    await page.getByRole('option', { name: '50 条/页', exact: true }).click();
    await expect(rows).toHaveCount(50);
    expect(listReads).toBe(beforeResize);
    diagnostics.assertClean('local skill pagination, editing and last-page deletion');
  });

  for (const action of ['查看', '编辑'] as const) test(`技能主体最新详情：${action}不使用旧列表字段`, async ({ page }) => {
    const mock = new MockApi();
    mock.skills = [{
      gameId: GAME_ID, skillKey: 'fresh_skill', name: '列表中的技能', description: '列表旧说明',
      maxLevel: 1, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: [],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    mock.skillCategories = [{
      gameId: GAME_ID, skillCategoryKey: 'retained', name: '已保留分类', description: null,
      status: 'DISABLED', sortOrder: 0, createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);
    const detail = createDeferred();
    await page.route('**/skills/fresh_skill', async (route) => {
      if (route.request().method() === 'GET') await detail.promise;
      await route.fallback();
    });
    await openSkills(page);
    await expect(skillRow(page, 'fresh_skill')).toContainText('列表中的技能');
    mock.skills[0] = { ...mock.skills[0]!, name: '最新技能', description: '接口更正后的说明', maxLevel: 5, skillCategoryKeys: ['retained'] };
    await skillRow(page, 'fresh_skill').getByRole('button', { name: action, exact: true }).click();
    const editor = visibleModal(page, `${action}技能`);
    try {
      await expect(editor.getByText('正在加载技能详情…', { exact: true })).toBeVisible();
      await expect(editor.getByLabel('说明', { exact: true })).toHaveCount(0);
      if (action === '编辑') await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    } finally {
      detail.resolve();
    }
    await expect(editor.getByLabel('技能名称', { exact: true })).toHaveValue('最新技能');
    await expect(editor.getByLabel('说明', { exact: true })).toHaveValue('接口更正后的说明');
    await expect(editor.getByLabel('最高等级', { exact: true })).toHaveValue('5');
    await expect(editor.getByLabel('技能分类', { exact: true })).toContainText('已保留分类（已停用）');
    if (action === '编辑') {
      await editor.getByLabel('最高等级', { exact: true }).fill('3');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      const confirmation = visibleModal(page, '确认缩小最高等级');
      await expect(confirmation).toContainText('高于 Lv3 的技能等级参数值将被删除');
      await confirmation.getByRole('button', { name: '取消', exact: true }).click();
      await editor.getByLabel('最高等级', { exact: true }).fill('5');
      await editor.getByLabel('排序', { exact: true }).fill('20');
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor).toBeHidden();
      expect(mock.skills[0]).toMatchObject({ description: '接口更正后的说明', name: '最新技能', maxLevel: 5, skillCategoryKeys: ['retained'], sortOrder: 20 });
      expect(mock.writes).toHaveLength(1);
    } else {
      expect(mock.writes).toHaveLength(0);
    }
    diagnostics.assertClean('skill editor loads current detail');
  });

  test('技能主体最新详情：失败可重试且关闭后忽略迟到响应', async ({ page }) => {
    const mock = new MockApi();
    mock.skills = [{
      gameId: GAME_ID, skillKey: 'retry_skill', name: '重试技能', description: '旧内容',
      maxLevel: 5, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: [],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    await prepare(page, mock);
    const late = createDeferred();
    const lateDelivered = createDeferred();
    let detailPhase: 'failed' | 'late' | 'current' = 'failed';
    let lateReads = 0;
    await page.route('**/skills/retry_skill', async (route) => {
      if (detailPhase === 'failed') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: '503.UNAVAILABLE', message: '技能详情暂时不可用' } }) });
      } else if (detailPhase === 'late') {
        lateReads += 1;
        const oldBody = JSON.stringify(mock.skills[0]);
        await late.promise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: oldBody });
        lateDelivered.resolve();
      } else {
        await route.fallback();
      }
    });
    await openSkills(page);
    await skillRow(page, 'retry_skill').getByRole('button', { name: '编辑', exact: true }).click();
    const editor = visibleModal(page, '编辑技能');
    await expect(editor.getByText(/技能详情暂时不可用/)).toBeVisible();
    await expect(editor.getByLabel('技能名称', { exact: true })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    detailPhase = 'late';
    await editor.getByRole('button', { name: '重试', exact: true }).click();
    try {
      await expect(editor.getByText('正在加载技能详情…', { exact: true })).toBeVisible();
      await expect.poll(() => lateReads).toBe(1);
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      await expect(editor).toBeHidden();
      mock.skills[0] = { ...mock.skills[0]!, description: '重开后的最新内容' };
      detailPhase = 'current';
      await skillRow(page, 'retry_skill').getByRole('button', { name: '编辑', exact: true }).click();
      await expect(editor.getByLabel('说明', { exact: true })).toHaveValue('重开后的最新内容');
    } finally {
      late.resolve();
    }
    await lateDelivered.promise;
    await expect(editor.getByLabel('说明', { exact: true })).toHaveValue('重开后的最新内容');
    await editor.getByLabel('说明', { exact: true }).fill('未保存草稿');
    await expect(editor.getByLabel('说明', { exact: true })).toHaveValue('未保存草稿');
    expect(lateReads).toBe(1);
    expect(mock.writes).toHaveLength(0);
  });

  test('技能主体最新详情：启停保留列表加载后的字段更正', async ({ page }) => {
    const mock = new MockApi();
    mock.skills = [{
      gameId: GAME_ID, skillKey: 'status_fresh', name: '状态技能', description: '旧说明',
      maxLevel: 1, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: [],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);
    await openSkills(page);
    await expect(skillRow(page, 'status_fresh')).toBeVisible();
    const fresh = { ...mock.skills[0]!, description: '外部更正', maxLevel: 5, sortOrder: 30 };
    mock.skills[0] = fresh;
    await skillRow(page, 'status_fresh').getByRole('button', { name: '停用', exact: true }).click();
    const confirmation = visibleModal(page, '停用技能');
    await confirmation.getByRole('button', { name: '停用', exact: true }).click();
    await expect(confirmation).toBeHidden();
    expect(mock.skills[0]).toMatchObject({ ...fresh, status: 'DISABLED', updatedAt: '2026-08-23T11:00:00Z' });
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0]!.body).toEqual({ name: fresh.name, description: fresh.description, maxLevel: fresh.maxLevel,
      status: 'DISABLED', sortOrder: fresh.sortOrder, skillCategoryKeys: fresh.skillCategoryKeys });
    diagnostics.assertClean('status changes preserve current skill fields');
  });

  test('技能主体最新详情：切换连接后不提交旧启停请求', async ({ page }) => {
    const mock = new MockApi();
    mock.skills = [{
      gameId: GAME_ID, skillKey: 'status_cancel', name: '取消旧请求', description: null,
      maxLevel: 5, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: [],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);
    const detail = createDeferred();
    const delivered = createDeferred();
    let waiting = false;
    await page.route('**/skills/status_cancel', async (route) => {
      if (route.request().method() === 'GET') {
        waiting = true;
        await detail.promise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.skills[0]) });
        delivered.resolve();
      } else {
        await route.fallback();
      }
    });
    await openSkills(page);
    await skillRow(page, 'status_cancel').getByRole('button', { name: '停用', exact: true }).click();
    const confirmation = visibleModal(page, '停用技能');
    await confirmation.getByRole('button', { name: '停用', exact: true }).click();
    try {
      await expect.poll(() => waiting).toBe(true);
      // 模拟外壳在详情读取期间切换连接，确认旧请求不会继续提交。
      await page.getByPlaceholder('粘贴 Admin JWT', { exact: true }).evaluate((input) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'changed-test-token');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), ADMIN_TOKEN_STORAGE_KEY)).toBe('changed-test-token');
      diagnostics.assertClean('connection change before pending detail completes');
      await expect(confirmation).toBeHidden();
    } finally {
      detail.resolve();
    }
    await delivered.promise;
    await expect(skillRow(page, 'status_cancel').getByRole('button', { name: '停用', exact: true })).toBeEnabled();
    expect(mock.writes).toHaveLength(0);
    expect(mock.skills[0]!.status).toBe('ENABLED');
    diagnostics.assertClean('obsolete status request cannot write');
  });

  test('starts each skill editor session without the previous skill categories', async ({ page }) => {
    const mock = new MockApi();
    mock.skillCategories = [
      { gameId: GAME_ID, skillCategoryKey: 'passive', name: '被动技能', description: null,
        status: 'ENABLED', sortOrder: 0, createdAt: CREATED_AT, updatedAt: UPDATED_AT },
      { gameId: GAME_ID, skillCategoryKey: 'basic', name: '普通技能', description: null,
        status: 'ENABLED', sortOrder: 1, createdAt: CREATED_AT, updatedAt: UPDATED_AT }
    ];
    const diagnostics = await prepare(page, mock);
    await openSkills(page);
    await expect(page.getByText('暂无技能', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增技能', exact: true }).click();
    const passive = visibleModal(page, '新增技能');
    await passive.getByLabel('技能标识', { exact: true }).fill('entry_p');
    await passive.getByLabel('技能名称', { exact: true }).fill('录入被动');
    await passive.getByLabel('排序', { exact: true }).fill('37');
    await passive.getByLabel('技能分类', { exact: true }).click();
    await page.getByRole('option', { name: '被动技能', exact: true }).click();
    await passive.getByRole('button', { name: '保存', exact: true }).click();
    await expect(passive).toBeHidden();
    expect(mock.skills.find((skill) => skill.skillKey === 'entry_p')?.skillCategoryKeys).toEqual(['passive']);

    await page.getByRole('button', { name: '新增技能', exact: true }).click();
    const basic = visibleModal(page, '新增技能');
    await expect(basic.getByLabel('技能标识', { exact: true })).toHaveValue('');
    await expect(basic.getByLabel('技能名称', { exact: true })).toHaveValue('');
    await expect(basic.getByLabel('最高等级', { exact: true })).toHaveValue('1');
    await expect(basic.getByLabel('排序', { exact: true })).toHaveValue('0');
    await expect(basic.getByLabel('技能分类', { exact: true })).not.toContainText('被动技能');
    await basic.getByLabel('技能标识', { exact: true }).fill('entry_q');
    await basic.getByLabel('技能名称', { exact: true }).fill('录入普通技能');
    await basic.getByLabel('最高等级', { exact: true }).fill('5');
    await basic.getByLabel('技能分类', { exact: true }).click();
    await page.getByRole('option', { name: '普通技能', exact: true }).click();
    await basic.getByRole('button', { name: '保存', exact: true }).click();
    await expect(basic).toBeHidden();
    expect(mock.skills.find((skill) => skill.skillKey === 'entry_q')?.skillCategoryKeys).toEqual(['basic']);
    await expect(skillRow(page, 'entry_q')).toContainText('普通技能');
    await expect(skillRow(page, 'entry_q')).not.toContainText('被动技能');

    await skillRow(page, 'entry_p').getByRole('button', { name: '编辑', exact: true }).click();
    const firstEdit = visibleModal(page, '编辑技能');
    await expect(firstEdit.getByLabel('技能标识', { exact: true })).toHaveValue('entry_p');
    await firstEdit.getByRole('button', { name: '取消', exact: true }).click();
    await skillRow(page, 'entry_q').getByRole('button', { name: '编辑', exact: true }).click();
    const secondEdit = visibleModal(page, '编辑技能');
    await expect(secondEdit.getByLabel('技能标识', { exact: true })).toHaveValue('entry_q');
    await expect(secondEdit.getByLabel('技能分类', { exact: true })).toContainText('普通技能');
    await expect(secondEdit.getByLabel('技能分类', { exact: true })).not.toContainText('被动技能');
    diagnostics.assertClean('consecutive skill editor sessions');
  });

  test('manages skill basics, multiple categories and stable status filtering', async ({ page }, testInfo) => {
    const mock = new MockApi();
    mock.skillCategories = [
      {
        gameId: GAME_ID,
        skillCategoryKey: 'active',
        name: '主动技能',
        description: null,
        status: 'ENABLED',
        sortOrder: 10,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT
      },
      {
        gameId: GAME_ID,
        skillCategoryKey: 'single_target',
        name: '单体技能',
        description: null,
        status: 'ENABLED',
        sortOrder: 20,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT
      }
    ];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    await expect(page.getByText('暂无技能', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增技能', exact: true }).click();
    const createModal = visibleModal(page, '新增技能');
    await createModal.getByLabel('技能标识', { exact: true }).fill('ezreal_q');
    await createModal.getByLabel('技能名称', { exact: true }).fill('秘术射击');
    await createModal.getByLabel('最高等级', { exact: true }).fill('5');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(skillRow(page, 'ezreal_q')).toContainText('秘术射击');
    await expect(skillRow(page, 'ezreal_q').getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(1);
    await expect(skillRow(page, 'ezreal_q').getByRole('button', { name: '过程与内部状态', exact: true })).toHaveCount(1);
    expect(await page.locator('a[href="#/skill-effects"]').count()).toBe(0);
    expect(await page.locator('a[href="#/effects"]').count()).toBe(0);
    expect(await page.locator('a[href="#/skill-processes"]').count()).toBe(0);
    expect(mock.skills[0]?.skillCategoryKeys).toEqual([]);

    await skillRow(page, 'ezreal_q').getByRole('button', { name: '查看', exact: true }).click();
    const viewModal = visibleModal(page, '查看技能');
    await expect(viewModal).toBeVisible();
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();

    await skillRow(page, 'ezreal_q').getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑技能');
    await expect(editModal.getByLabel('技能标识', { exact: true })).toBeDisabled();
    await editModal.getByLabel('技能分类', { exact: true }).click();
    await page.locator('.arco-select-option:visible').filter({ hasText: '主动技能' }).click();
    await page.locator('.arco-select-option:visible').filter({ hasText: '单体技能' }).click();
    await page.keyboard.press('Escape');
    await editModal.getByLabel('说明', { exact: true }).fill('命中第一个目标');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    await expect(skillRow(page, 'ezreal_q')).toContainText('主动技能');
    await expect(skillRow(page, 'ezreal_q')).toContainText('单体技能');
    expect(mock.skills[0]?.skillCategoryKeys).toEqual(['active', 'single_target']);

    mock.skillCategories[0]!.status = 'DISABLED';
    await page.getByRole('button', { name: '刷新', exact: true }).last().click();
    await expect(skillRow(page, 'ezreal_q')).toContainText('主动技能（已停用）');

    await skillRow(page, 'ezreal_q').getByRole('button', { name: '编辑', exact: true }).click();
    const disabledCategoryModal = visibleModal(page, '编辑技能');
    await expect(disabledCategoryModal.getByText('主动技能（已停用）', { exact: true })).toBeVisible();
    await disabledCategoryModal.getByLabel('技能名称', { exact: true }).fill('秘术射击改');
    await disabledCategoryModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(disabledCategoryModal).toBeHidden();
    expect(mock.skills[0]?.skillCategoryKeys).toEqual(['active', 'single_target']);
    await expect(skillRow(page, 'ezreal_q')).toContainText('秘术射击改');

    await page.getByRole('button', { name: '新增技能', exact: true }).click();
    const outsideCloseModal = visibleModal(page, '新增技能');
    await outsideCloseModal.getByLabel('技能名称', { exact: true }).fill('未保存技能');
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(outsideCloseModal).toBeHidden();
    expect(mock.skills).toHaveLength(1);

    await skillRow(page, 'ezreal_q').getByRole('button', { name: '停用', exact: true }).click();
    const disableModal = visibleModal(page, '停用技能');
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    await expect(disableModal).toBeHidden();
    await expect(skillRow(page, 'ezreal_q')).toContainText('停用');
    expect(mock.skills[0]?.skillCategoryKeys).toEqual(['active', 'single_target']);

    const statusFilter = page.getByLabel('技能状态筛选');
    await statusFilter.getByText('停用', { exact: true }).click();
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(statusFilter.getByRole('radio', { name: '停用' })).toBeChecked();
    await expect(skillRow(page, 'ezreal_q')).toBeVisible();

    await skillRow(page, 'ezreal_q').getByRole('button', { name: '启用', exact: true }).click();
    const enableModal = visibleModal(page, '启用技能');
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    await expect(enableModal).toBeHidden();
    await expect(skillRow(page, 'ezreal_q')).toHaveCount(0);

    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(skillRow(page, 'ezreal_q')).toBeVisible();
    await skillRow(page, 'ezreal_q').getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除技能');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(skillRow(page, 'ezreal_q')).toHaveCount(0);
    expect(mock.skillCategories).toHaveLength(2);
    diagnostics.assertClean('skill basic management');
  });

  test('keeps safe operations available while the category directory is unavailable', async ({ page }) => {
    const mock = new MockApi();
    mock.skillCategories = [{
      gameId: GAME_ID,
      skillCategoryKey: 'active',
      name: '主动技能',
      description: null,
      status: 'ENABLED',
      sortOrder: 10,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    mock.skills = [{
      gameId: GAME_ID,
      skillKey: 'safe_skill',
      name: '安全操作测试',
      description: null,
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['active'],
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    mock.skillCategoryListFailure = true;
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const row = skillRow(page, 'safe_skill');
    await expect(row).toContainText('active');
    await expect(page.getByRole('button', { name: '新增技能', exact: true })).toBeDisabled();
    await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
    await expect(row.getByRole('button', { name: '查看', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '参数与公式', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '效果与结果', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '过程与内部状态', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '停用', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '删除', exact: true })).toBeEnabled();

    mock.skillCategoryListFailure = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(row).toContainText('主动技能');
    await expect(page.getByRole('button', { name: '新增技能', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeEnabled();
    diagnostics.assertClean('skill category directory failure protection');
  });

  test('manages skill parameters and formulas from the skills page entry', async ({ page }, testInfo) => {
    testInfo.setTimeout(90_000);
    const mock = new MockApi();
    mock.attributes = [
      attribute('hp', '生命值', { status: 'ENABLED' }),
      attribute('attack_damage', '攻击力', { status: 'ENABLED' })
    ];
    mock.skillCategories = [{
      gameId: GAME_ID,
      skillCategoryKey: 'active',
      name: '主动技能',
      description: null,
      status: 'ENABLED',
      sortOrder: 10,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    mock.skills = [{
      gameId: GAME_ID,
      skillKey: 'varus_w',
      name: '枯萎箭袋',
      description: null,
      maxLevel: 5,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['active'],
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    mock.parameterDeleteConflictKeys.add('missing_health_ratio');
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    await skillRow(page, 'varus_w').getByRole('button', { name: '参数与公式', exact: true }).click();
    const shell = visibleModal(page, '参数与公式 - 枯萎箭袋');
    await expect(shell).toBeVisible();

    await shell.getByRole('button', { name: '新增参数', exact: true }).click();
    const runtimeModal = visibleModal(page, '新增参数');
    await runtimeModal.getByLabel('稳定标识').fill('current_stacks');
    await runtimeModal.getByLabel('参数名称').fill('当前层数');
    await runtimeModal.getByLabel('数值类型').getByText('整数', { exact: true }).click();
    await runtimeModal.getByLabel('取值方式').getByText('计算时传入', { exact: true }).click();
    await expect(runtimeModal.getByRole('spinbutton', { name: '固定值' })).toHaveCount(0);
    await expect(runtimeModal.getByRole('spinbutton', { name: '等级1数值' })).toHaveCount(0);
    await runtimeModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(runtimeModal).toBeHidden();
    await expect(shell).toBeVisible();
    expect(mock.skillParameters.some((item) => (
      item.parameterKey === 'current_stacks'
      && item.valueMode === 'RUNTIME_INPUT'
      && item.fixedValue === null
      && item.levelValues === null
    ))).toBe(true);

    await shell.getByRole('button', { name: '新增参数', exact: true }).click();
    const levelModal = visibleModal(page, '新增参数');
    await levelModal.getByLabel('稳定标识').fill('base_damage');
    await levelModal.getByLabel('参数名称').fill('基础伤害');
    await levelModal.getByLabel('取值方式').getByText('按技能等级', { exact: true }).click();
    await levelModal.getByLabel('等差起始值').fill('20');
    await levelModal.getByLabel('每级增加值').fill('25');
    await levelModal.getByRole('button', { name: '等差递增', exact: true }).click();
    await levelModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(levelModal).toBeHidden();
    const baseDamage = mock.skillParameters.find((item) => item.parameterKey === 'base_damage');
    expect(baseDamage?.valueMode).toBe('SKILL_LEVEL');
    expect(baseDamage?.levelValues).toEqual({
      '1': 20,
      '2': 45,
      '3': 70,
      '4': 95,
      '5': 120
    });

    await shell.getByRole('button', { name: '新增参数', exact: true }).click();
    const ratioModal = visibleModal(page, '新增参数');
    await ratioModal.getByLabel('稳定标识').fill('missing_health_ratio');
    await ratioModal.getByLabel('参数名称').fill('已损失生命值系数');
    await ratioModal.getByRole('spinbutton', { name: '固定值' }).fill('0.15');
    await ratioModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(ratioModal).toBeHidden();

    await shell.getByRole('tab', { name: '技能公式' }).click();
    await shell.getByRole('button', { name: '新增公式', exact: true }).click();
    const formulaModal = visibleModal(page, '新增公式');
    await expect(formulaModal.getByText('加载中…')).toBeHidden({ timeout: 15_000 });
    await formulaModal.getByLabel('稳定标识').fill('missing_health_damage');
    await formulaModal.getByLabel('公式名称').fill('已损失生命值伤害');
    await formulaModal.getByLabel('expression节点类型').getByText('运算', { exact: true }).click();
    await formulaModal.getByLabel('expression运算').click();
    await page.getByRole('option', { name: '乘', exact: true }).click();
    await formulaModal.getByLabel('expression.operands[0]节点类型').getByText('属性', { exact: true }).click();
    await formulaModal.getByLabel('expression.operands[0]属性对象').getByText('目标', { exact: true }).click();
    await formulaModal.getByRole('combobox', { name: 'expression.operands[0]属性', exact: true }).click();
    await page.getByRole('option', { name: '生命值（hp）', exact: true }).click();
    await formulaModal.getByRole('combobox', { name: 'expression.operands[0]属性取值方式', exact: true }).click();
    await page.getByRole('option', { name: '已损失值', exact: true }).click();
    await formulaModal.getByLabel('expression.operands[1]节点类型').getByText('技能参数', { exact: true }).click();
    await formulaModal.getByRole('combobox', { name: 'expression.operands[1]技能参数', exact: true }).click();
    await page.getByRole('option', { name: '已损失生命值系数（missing_health_ratio）', exact: true }).click();
    await expect(formulaModal.getByText('目标.生命值.已损失值 × 已损失生命值系数')).toBeVisible();
    await formulaModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(formulaModal).toBeHidden();
    await expect(shell).toBeVisible();
    expect(mock.skillFormulas[0]?.expression).toEqual({
      nodeType: 'OPERATION',
      operation: 'MULTIPLY',
      operands: [
        {
          nodeType: 'ATTRIBUTE',
          attributeOwner: 'TARGET',
          attributeKey: 'hp',
          attributeValueKind: 'MISSING'
        },
        {
          nodeType: 'PARAMETER',
          parameterKey: 'missing_health_ratio'
        }
      ]
    });

    await shell.getByRole('tab', { name: '技能参数' }).click();
    const ratioRow = shell.locator('tr', { hasText: 'missing_health_ratio' });
    await ratioRow.getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除参数');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(deleteModal.getByText('该参数正在被技能公式或条件与触发规则使用，不能删除')).toBeVisible();
    expect(mock.skillParameters.some((item) => item.parameterKey === 'missing_health_ratio')).toBe(true);

    await deleteModal.getByRole('button', { name: '取消', exact: true }).click();
    await shell.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(shell).toBeHidden();
    diagnostics.assertClean('skill parameter and formula management');
  });

  test('manages skill effects and results from the skills page entry', async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    await expect(skillRow(page, 'varus_w').getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(1);
    expect(await page.locator('a[href="#/skill-effects"]').count()).toBe(0);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await expect(shell.getByText('暂无效果', { exact: true })).toBeVisible();
    await assertNoForbiddenSkillEffectTerms(page.locator('.app-main'));
    await assertNoForbiddenSkillEffectTerms(shell);

    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await expect(createModal).toBeVisible();
    await createModal.getByLabel('效果标识', { exact: true }).fill('on_hit_results');
    await createModal.getByLabel('效果名称', { exact: true }).fill('命中结果');
    await createModal.getByLabel('排序', { exact: true }).fill('10');
    await expect(createModal.getByText('暂无结果', { exact: true })).toBeVisible();

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const damageModal = visibleModal(page, '新增结果');
    await expect(damageModal.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await damageModal.getByLabel('结果标识', { exact: true }).fill('physical_hit');
    await damageModal.getByLabel('结果名称', { exact: true }).fill('造成物理伤害');
    await expect(damageModal.getByLabel('结果种类', { exact: true })).toContainText('伤害');
    await fillValueRule(page, damageModal, '伤害公式');
    await chooseSelectOption(page, damageModal, '伤害类型', '物理伤害');
    await saveOpenModal(damageModal);
    await expect(createModal.locator('tr', { hasText: 'physical_hit' })).toBeVisible();

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const healModal = visibleModal(page, '新增结果');
    await healModal.getByLabel('结果标识', { exact: true }).fill('self_heal');
    await healModal.getByLabel('结果名称', { exact: true }).fill('自我治疗');
    await chooseSelectOption(page, healModal, '结果种类', '直接治疗');
    await clickArcoRadioByVisibleLabel(healModal, '施法者');
    await expect(healModal.getByLabel('伤害类型', { exact: true })).toHaveCount(0);
    await fillValueRule(page, healModal, '治疗公式');
    await saveOpenModal(healModal);

    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(shell.getByText('效果「命中结果」已保存。', { exact: true })).toBeVisible();
    await expect(shell.locator('tr', { hasText: 'on_hit_results' }).getByRole('cell', { name: '2', exact: true })).toBeVisible();
    const createWrite = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/effects'));
    expect(createWrite?.body).toMatchObject({
      effectKey: 'on_hit_results',
      name: '命中结果',
      description: null,
      sortOrder: 10,
      lifecycle: null
    });
    expect(createWrite?.body.results).toEqual([
      {
        resultKey: 'physical_hit',
        name: '造成物理伤害',
        resultType: 'DAMAGE',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: valueRule('damage'),
        detail: damageResultDetail('physical')
      },
      {
        resultKey: 'self_heal',
        name: '自我治疗',
        resultType: 'DIRECT_HEAL',
        target: 'SOURCE',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: valueRule('heal'),
        detail: {}
      }
    ]);

    await shell.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(shell.locator('tr', { hasText: 'on_hit_results' })).toContainText('命中结果');
    await expect(shell.locator('tr', { hasText: 'on_hit_results' }).getByRole('cell', { name: '2', exact: true })).toBeVisible();

    await shell.locator('tr', { hasText: 'on_hit_results' }).getByRole('button', { name: '查看', exact: true }).click();
    const viewModal = visibleModal(page, '查看效果');
    await expect(viewModal.getByLabel('效果标识', { exact: true })).toBeDisabled();
    await expect(viewModal.getByLabel('效果名称', { exact: true })).toBeDisabled();
    await expect(viewModal.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
    await expect(viewModal.getByRole('button', { name: '新增结果', exact: true })).toHaveCount(0);
    await expect(viewModal.locator('tr', { hasText: 'physical_hit' })).toBeVisible();
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();
    await expect(shell).toBeVisible();

    await shell.locator('tr', { hasText: 'on_hit_results' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑效果');
    await expect(editModal.getByLabel('效果标识', { exact: true })).toBeDisabled();
    await expect(editModal.locator('tr', { hasText: 'physical_hit' })).toBeVisible();
    await editModal.locator('tr', { hasText: 'self_heal' }).getByRole('button', { name: '删除', exact: true }).click();
    await expect(editModal.locator('tr', { hasText: 'self_heal' })).toHaveCount(0);
    await expect(editModal.locator('tr', { hasText: 'physical_hit' })).toBeVisible();

    await editModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const statusModal = visibleModal(page, '新增结果');
    await statusModal.getByLabel('结果标识', { exact: true }).fill('apply_poison');
    await statusModal.getByLabel('结果名称', { exact: true }).fill('施加中毒');
    await chooseSelectOption(page, statusModal, '结果种类', '状态操作');
    await expect(statusModal.getByLabel('数值', { exact: true })).toHaveCount(0);
    await expect(statusModal.getByLabel('固定倍率', { exact: true })).toHaveCount(0);
    await chooseSelectOption(page, statusModal, '状态', '中毒');
    await clickArcoRadioByVisibleLabel(statusModal, '施加');
    await saveOpenModal(statusModal);

    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    const updateWrite = mock.writes.filter((item) => item.method === 'PUT' && item.path.endsWith('/effects/on_hit_results')).at(-1);
    expect(updateWrite?.body).not.toHaveProperty('effectKey');
    expect((updateWrite?.body.results as SkillEffectResultRow[]).map((item) => item.resultKey)).toEqual([
      'apply_poison',
      'physical_hit'
    ]);
    expect((updateWrite?.body.results as SkillEffectResultRow[]).find((item) => item.resultKey === 'apply_poison')).toEqual({
      resultKey: 'apply_poison',
      name: '施加中毒',
      resultType: 'STATUS_OPERATION',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: null,
      detail: { statusKey: 'poison', operation: 'APPLY' }
    });
    await expect(shell.locator('tr', { hasText: 'on_hit_results' }).getByRole('cell', { name: '2', exact: true })).toBeVisible();

    await shell.locator('tr', { hasText: 'on_hit_results' }).getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除效果');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(shell.getByText('效果「命中结果」已删除。', { exact: true })).toBeVisible();
    await expect(shell.getByText('暂无效果', { exact: true })).toBeVisible();
    expect(mock.skillEffects).toHaveLength(0);
    diagnostics.assertClean('skill effect and result management');
  });

  test('creates and selects a modifier zone inside a continuous result', async ({ page }) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const effectModal = visibleModal(page, '新增效果');
    await effectModal.getByLabel('效果标识', { exact: true }).fill('damage_modifier_effect');
    await effectModal.getByLabel('效果名称', { exact: true }).fill('伤害修正效果');
    await effectModal.getByLabel('生命周期', { exact: true }).click();
    await chooseSelectOption(page, effectModal, '最大层数取值', '一层');
    await chooseSelectOption(page, effectModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, effectModal, '实例范围', '按来源与承受对象');
    await chooseSelectOption(page, effectModal, '重复层数', '保留层数');

    await effectModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const resultModal = visibleModal(page, '新增结果');
    await resultModal.getByLabel('结果标识', { exact: true }).fill('damage_reduction');
    await resultModal.getByLabel('结果名称', { exact: true }).fill('受到伤害降低');
    await chooseSelectOption(page, resultModal, '结果种类', '伤害修正');
    await chooseSelectOption(page, resultModal, '修正比例公式', '伤害公式');
    await expect(resultModal.getByLabel('乘区', { exact: true })).toBeVisible();
    await resultModal.getByRole('button', { name: '新增乘区', exact: true }).click();

    const zoneModal = visibleModal(page, '新增乘区');
    await zoneModal.getByLabel('乘区标识', { exact: true }).fill('damage_pre_defense');
    await zoneModal.getByLabel('乘区名称', { exact: true }).fill('伤害前修正');
    await expect(zoneModal.getByLabel('乘区作用域', { exact: true })).toContainText('伤害');
    await chooseSelectOption(page, zoneModal, '乘区计算方式', '比例加算');
    await chooseSelectOption(page, zoneModal, '乘区应用阶段', '防御计算前伤害');
    await zoneModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(zoneModal).toBeHidden();
    await expect(resultModal.getByLabel('乘区', { exact: true })).toContainText('伤害前修正');
    await saveOpenModal(resultModal);
    await effectModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(effectModal).toBeHidden();

    const write = mock.writes.find((item) => (
      item.method === 'POST' && item.path.endsWith('/effects')
    ));
    expect((write?.body.results as SkillEffectResultRow[])[0]?.detail).toMatchObject({
      modifierZoneKey: 'damage_pre_defense'
    });
    diagnostics.assertClean('inline modifier zone creation');
  });

  test('covers seven result editors and omits the value rule for cooldown reset', async ({ page }) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await createModal.getByLabel('效果标识', { exact: true }).fill('mixed_results');
    await createModal.getByLabel('效果名称', { exact: true }).fill('混合结果');

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const resultModal = visibleModal(page, '新增结果');
    await expect(resultModal.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('伤害类型', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('属性', { exact: true })).toHaveCount(0);
    await expect(resultModal.getByLabel('状态', { exact: true })).toHaveCount(0);
    await assertNoForbiddenSkillEffectTerms(resultModal);

    await chooseSelectOption(page, resultModal, '结果种类', '直接治疗');
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('伤害类型', { exact: true })).toHaveCount(0);

    await chooseSelectOption(page, resultModal, '结果种类', '普通护盾');
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('伤害类型', { exact: true })).toHaveCount(0);

    await chooseSelectOption(page, resultModal, '结果种类', '属性变化');
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('属性', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('属性变化操作', { exact: true })).toBeVisible();

    await chooseSelectOption(page, resultModal, '结果种类', '资源变化');
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('资源属性', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('资源变化操作', { exact: true })).toBeVisible();

    await chooseSelectOption(page, resultModal, '结果种类', '冷却变化');
    await expect(resultModal.getByLabel('技能范围', { exact: true })).toBeVisible();
    await expect(resultModal.getByRole('combobox', { name: '指定技能', exact: true })).toHaveCount(0);
    await expect(resultModal.getByRole('combobox', { name: '指定技能分类', exact: true })).toHaveCount(0);
    await expect(resultModal.getByLabel('冷却变化操作', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByText('变化量按毫秒解释')).toBeVisible();
    await clickArcoRadioByVisibleLabel(resultModal, '指定技能');
    await expect(resultModal.getByRole('combobox', { name: '指定技能', exact: true })).toBeVisible();
    await clickArcoRadioByVisibleLabel(resultModal, '指定技能分类');
    await expect(resultModal.getByRole('combobox', { name: '指定技能分类', exact: true })).toBeVisible();
    await expect(resultModal.getByRole('button', { name: '新增技能分类', exact: true })).toBeVisible();
    await clickArcoRadioByVisibleLabel(resultModal, '全部技能');
    await expect(resultModal.getByRole('combobox', { name: '指定技能', exact: true })).toHaveCount(0);
    await clickArcoRadioByVisibleLabel(resultModal, '重置为可用');
    await expect(resultModal.getByLabel('数值', { exact: true })).toHaveCount(0);
    await expect(resultModal.getByLabel('固定倍率', { exact: true })).toHaveCount(0);
    await clickArcoRadioByVisibleLabel(resultModal, '增加');
    await expect(resultModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(resultModal.getByText('变化量按毫秒解释')).toBeVisible();

    await chooseSelectOption(page, resultModal, '结果种类', '状态操作');
    await expect(resultModal.getByLabel('状态', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('状态操作', { exact: true })).toBeVisible();
    await expect(resultModal.getByLabel('数值', { exact: true })).toHaveCount(0);
    await expect(resultModal.getByLabel('固定倍率', { exact: true })).toHaveCount(0);
    await expect(resultModal.getByLabel('伤害类型', { exact: true })).toHaveCount(0);
    await resultModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(resultModal).toBeHidden();

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const resetModal = visibleModal(page, '新增结果');
    await resetModal.getByLabel('结果标识', { exact: true }).fill('reset_cd');
    await resetModal.getByLabel('结果名称', { exact: true }).fill('重置冷却');
    await chooseSelectOption(page, resetModal, '结果种类', '冷却变化');
    await clickArcoRadioByVisibleLabel(resetModal, '指定技能');
    await resetModal.getByRole('combobox', { name: '指定技能', exact: true }).click();
    await page.getByRole('option', { name: '枯萎箭袋', exact: true }).click();
    await page.getByRole('option', { name: '其他技能', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(resetModal.getByRole('combobox', { name: '指定技能', exact: true })).toContainText('枯萎箭袋');
    await expect(resetModal.getByRole('combobox', { name: '指定技能', exact: true })).toContainText('其他技能');
    await clickArcoRadioByVisibleLabel(resetModal, '重置为可用');
    await expect(resetModal.getByLabel('数值', { exact: true })).toHaveCount(0);
    await saveOpenModal(resetModal);

    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    const createWrite = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/effects'));
    const results = createWrite?.body.results as SkillEffectResultRow[];
    expect(results.find((item) => item.resultKey === 'reset_cd')).toEqual({
      resultKey: 'reset_cd',
      name: '重置冷却',
      resultType: 'COOLDOWN_CHANGE',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: null,
      detail: {
        affectedSkillScope: {
          mode: 'SKILLS',
          skillKeys: ['varus_w', 'other_skill'],
          skillCategoryKeys: []
        },
        operation: 'RESET'
      }
    });
    diagnostics.assertClean('seven result editors and omitted cooldown reset value rule');
  });

  test('authors skill haste and shared skill scopes including inline category create', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    mock.skillFormulas = [
      ...mock.skillFormulas,
      {
        gameId: GAME_ID,
        skillKey: 'varus_w',
        formulaKey: 'skill_haste_180',
        name: '技能急速180',
        description: null,
        sortOrder: 20,
        expression: { nodeType: 'PARAMETER', parameterKey: 'skill_haste_180' },
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT
      }
    ];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const effectModal = visibleModal(page, '新增效果');
    await effectModal.getByLabel('效果标识', { exact: true }).fill('haste_pack');
    await effectModal.getByLabel('效果名称', { exact: true }).fill('急速效果');
    await effectModal.getByLabel('生命周期', { exact: true }).click();
    await chooseSelectOption(page, effectModal, '最大层数取值', '一层');
    await chooseSelectOption(page, effectModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, effectModal, '实例范围', '按来源与承受对象');
    await chooseSelectOption(page, effectModal, '重复层数', '保留层数');

    await effectModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const hasteModal = visibleModal(page, '新增结果');
    await hasteModal.getByLabel('结果标识', { exact: true }).fill('displacement_haste');
    await hasteModal.getByLabel('结果名称', { exact: true }).fill('位移急速');
    await chooseSelectOption(page, hasteModal, '结果种类', '技能急速修正');
    await expect(hasteModal.getByLabel('技能急速操作', { exact: true })).toBeVisible();
    await expect(hasteModal.getByLabel('技能范围', { exact: true })).toBeVisible();
    await expect(hasteModal.getByLabel('数值', { exact: true })).toBeVisible();
    await expect(hasteModal.getByLabel('乘区', { exact: true })).toHaveCount(0);
    await expect(hasteModal.getByLabel('法术护盾阻挡粒度', { exact: true })).toHaveCount(0);
    await fillValueRule(page, hasteModal, '技能急速180');
    await clickArcoRadioByVisibleLabel(hasteModal, '指定技能分类');
    await hasteModal.getByRole('button', { name: '新增技能分类', exact: true }).click();
    const categoryModal = visibleModal(page, '新增技能分类');
    await categoryModal.getByLabel('技能分类标识', { exact: true }).fill('displacement');
    await categoryModal.getByLabel('技能分类名称', { exact: true }).fill('位移');
    await categoryModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(categoryModal).toBeHidden();
    await expect(hasteModal.getByRole('combobox', { name: '指定技能分类', exact: true })).toContainText('位移');
    await saveOpenModal(hasteModal);
    await expect(effectModal).toBeVisible();
    await expect(effectModal.getByText('技能急速修正')).toBeVisible();
    await expect(effectModal.getByText('增加 · 技能急速180 · 位移')).toBeVisible();
    await expect(effectModal.getByText('增加', { exact: true })).toBeVisible();

    await effectModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(effectModal).toBeHidden();
    const write = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/effects'));
    expect((write?.body.results as SkillEffectResultRow[])[0]).toMatchObject({
      resultKey: 'displacement_haste',
      resultType: 'SKILL_HASTE_MODIFIER',
      valueRule: { value: formulaValue("skill_haste_180"), fixedMultiplier: 1 },
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: 'SHARED',
        reapplicationValueMode: 'KEEP',
        periodicExecutionMode: null
      },
      spellShieldBlockScope: null,
      detail: {
        operation: 'INCREASE',
        affectedSkillScope: {
          mode: 'CATEGORIES',
          skillKeys: [],
          skillCategoryKeys: ['displacement']
        }
      }
    });
    expect((write?.body.results as SkillEffectResultRow[])[0]?.detail).not.toHaveProperty('affectedSkillKeys');
    diagnostics.assertClean('skill haste categories and inline skill category create');
  });

  test('authors execute and link-application results with discrete spell-shield scopes', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    mock.attributes = [...mock.attributes, attribute('hp', '生命值')];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await createModal.getByLabel('效果标识', { exact: true }).fill('execute_link_pack');
    await createModal.getByLabel('效果名称', { exact: true }).fill('斩杀与联动');

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const executeModal = visibleModal(page, '新增结果');
    await executeModal.getByLabel('结果标识', { exact: true }).fill('collect_execute');
    await executeModal.getByLabel('结果名称', { exact: true }).fill('斩杀');
    await chooseSelectOption(page, executeModal, '结果种类', '斩杀');
    await expect(executeModal.getByText('目标当前生命属性小于等于阈值时形成斩杀结果；它不是额外伤害。')).toBeVisible();
    await expect(executeModal.getByLabel('生命属性', { exact: true })).toBeVisible();
    await expect(executeModal.getByLabel('斩杀阈值取值', { exact: true })).toBeVisible();
    await expect(executeModal.getByLabel('延迟毫秒', { exact: true })).toHaveCount(0);
    await chooseSelectOption(page, executeModal, '生命属性', '生命值');
    await fillValueRule(page, executeModal, '伤害公式', '斩杀阈值取值');
    await executeModal.getByLabel('法术护盾阻挡粒度', { exact: true }).click();
    await expect(page.getByRole('option', { name: '当前伤害实例', exact: true })).toHaveCount(0);
    await chooseVisibleOption(page, '当前结果');
    await saveOpenModal(executeModal);

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const hitLinkModal = visibleModal(page, '新增结果');
    await hitLinkModal.getByLabel('结果标识', { exact: true }).fill('on_hit_link');
    await hitLinkModal.getByLabel('结果名称', { exact: true }).fill('命中联动');
    await chooseSelectOption(page, hitLinkModal, '结果种类', '命中联动应用');
    await expect(hitLinkModal.getByLabel('命中联动次数取值', { exact: true })).toBeVisible();
    await expect(hitLinkModal.getByLabel('来源技能', { exact: true })).toHaveCount(0);
    await expect(hitLinkModal.getByLabel('延迟毫秒', { exact: true })).toHaveCount(0);
    await fillValueRule(page, hitLinkModal, '一层', '命中联动次数取值');
    await saveOpenModal(hitLinkModal);

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const attackLinkModal = visibleModal(page, '新增结果');
    await attackLinkModal.getByLabel('结果标识', { exact: true }).fill('on_attack_link');
    await attackLinkModal.getByLabel('结果名称', { exact: true }).fill('攻击联动');
    await chooseSelectOption(page, attackLinkModal, '结果种类', '攻击联动应用');
    await expect(attackLinkModal.getByLabel('攻击联动次数取值', { exact: true })).toBeVisible();
    await fillValueRule(page, attackLinkModal, '一层', '攻击联动次数取值');
    await saveOpenModal(attackLinkModal);

    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    const write = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/effects'));
    expect(write?.body.results).toEqual([
      {
        resultKey: 'collect_execute',
        name: '斩杀',
        resultType: 'EXECUTE',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: 'RESULT',
        lifecycleBehavior: null,
        valueRule: valueRule('damage'),
        detail: { attributeKey: 'hp' }
      },
      {
        resultKey: 'on_attack_link',
        name: '攻击联动',
        resultType: 'ATTACK_LINK_APPLICATION',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: valueRule('one'),
        detail: {}
      },
      {
        resultKey: 'on_hit_link',
        name: '命中联动',
        resultType: 'HIT_LINK_APPLICATION',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: valueRule('one'),
        detail: {}
      }
    ]);

    await shell.locator('tr', { hasText: 'execute_link_pack' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑效果');
    await expect(editModal.locator('tr', { hasText: 'collect_execute' })).toContainText('斩杀');
    await expect(editModal.locator('tr', { hasText: 'collect_execute' })).toContainText('生命值');
    await expect(editModal.locator('tr', { hasText: 'collect_execute' })).toContainText('伤害公式');
    await expect(editModal.locator('tr', { hasText: 'on_attack_link' })).toContainText('一层');
    await expect(editModal.locator('tr', { hasText: 'on_hit_link' })).toContainText('命中联动应用');
    await expect(editModal.locator('tr', { hasText: 'on_hit_link' })).toContainText('一层');
    await editModal.getByRole('button', { name: '取消', exact: true }).click();
    diagnostics.assertClean('execute and link application results');
  });

  test('retains disabled catalog refs, blocks new disabled choices, and only stops the failed catalog result', async ({ page }) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    mock.skillEffects = [{
      gameId: GAME_ID,
      skillKey: 'varus_w',
      effectKey: 'legacy_hit',
      name: '旧命中',
      description: null,
      sortOrder: 1,
      lifecycle: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: [
        {
          resultKey: 'magic_hit',
          name: '造成魔法伤害',
          resultType: 'DAMAGE',
          target: 'TARGET',
          description: null,
          sortOrder: 0,
          spellShieldBlockScope: null,
          valueRule: valueRule('damage'),
          detail: damageResultDetail('magic'),
          lifecycleBehavior: null
        },
        {
          resultKey: 'old_status',
          name: '施加旧中毒',
          resultType: 'STATUS_OPERATION',
          target: 'TARGET',
          description: null,
          sortOrder: 1,
          spellShieldBlockScope: null,
          valueRule: null,
          detail: { statusKey: 'old_poison', operation: 'APPLY' },
          lifecycleBehavior: null
        }
      ]
    }];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.locator('tr', { hasText: 'legacy_hit' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑效果');
    await expect(editModal.locator('tr', { hasText: 'magic_hit' })).toBeVisible();

    await editModal.locator('tr', { hasText: 'magic_hit' }).getByRole('button', { name: '编辑', exact: true }).click();
    const retainedDamage = visibleModal(page, '编辑结果');
    await expect(retainedDamage.getByLabel('伤害类型', { exact: true })).toContainText('魔法伤害（已停用）');
    await retainedDamage.getByLabel('伤害类型', { exact: true }).click();
    await expect(page.getByRole('option', { name: '物理伤害', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '魔法伤害（已停用）', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: '魔法伤害（已停用）', exact: true })).toBeHidden();
    await retainedDamage.getByRole('button', { name: '取消', exact: true }).click();
    await expect(retainedDamage).toBeHidden();

    await editModal.locator('tr', { hasText: 'old_status' }).getByRole('button', { name: '查看', exact: true }).click();
    const retainedStatus = visibleModal(page, '查看结果');
    await expect(retainedStatus.getByLabel('状态', { exact: true })).toContainText('旧中毒（已停用）');
    await retainedStatus.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(retainedStatus).toBeHidden();

    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    const retainedWrite = mock.writes.filter((item) => item.method === 'PUT' && item.path.endsWith('/effects/legacy_hit')).at(-1);
    expect((retainedWrite?.body.results as SkillEffectResultRow[]).map((item) => ({
      resultKey: item.resultKey,
      damageTypeKey: item.detail.damageTypeKey,
      statusKey: item.detail.statusKey
    }))).toEqual([
      { resultKey: 'magic_hit', damageTypeKey: 'magic', statusKey: undefined },
      { resultKey: 'old_status', damageTypeKey: undefined, statusKey: 'old_poison' }
    ]);

    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await createModal.getByLabel('效果标识', { exact: true }).fill('fresh_effect');
    await createModal.getByLabel('效果名称', { exact: true }).fill('新效果');
    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const createDamage = visibleModal(page, '新增结果');
    await expect(createDamage.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await createDamage.getByLabel('伤害类型', { exact: true }).click();
    await expect(page.getByRole('option', { name: '物理伤害', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '魔法伤害', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: '魔法伤害（已停用）', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '物理伤害', exact: true }).click();

    await chooseSelectOption(page, createDamage, '结果种类', '状态操作');
    await createDamage.getByLabel('状态', { exact: true }).click();
    await expect(page.getByRole('option', { name: '中毒', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '旧中毒', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: '旧中毒（已停用）', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '中毒', exact: true }).click();

    await chooseSelectOption(page, createDamage, '结果种类', '冷却变化');
    await clickArcoRadioByVisibleLabel(createDamage, '指定技能');
    await createDamage.getByRole('combobox', { name: '指定技能', exact: true }).click();
    await expect(page.getByRole('option', { name: '其他技能', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '退役技能', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: '退役技能（已停用）', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '其他技能', exact: true }).click();
    await createDamage.getByRole('button', { name: '取消', exact: true }).click();
    await expect(createDamage).toBeHidden();

    mock.damageTypeListFailure = true;
    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const blockedDamage = visibleModal(page, '新增结果');
    await expect(blockedDamage.getByText('503.DAMAGE_TYPE_LIST_UNAVAILABLE: 伤害类型读取失败', { exact: true })).toBeVisible();
    await blockedDamage.getByLabel('结果标识', { exact: true }).fill('blocked_hit');
    await blockedDamage.getByLabel('结果名称', { exact: true }).fill('被阻断伤害');
    await fillValueRule(page, blockedDamage, '伤害公式');
    await blockedDamage.getByRole('button', { name: '保存', exact: true }).click();
    await expect(blockedDamage).toBeVisible();
    await expect(blockedDamage.getByText('请选择伤害类型。', { exact: true })).toBeVisible();

    await chooseSelectOption(page, blockedDamage, '结果种类', '直接治疗');
    await expect(blockedDamage.getByText('503.DAMAGE_TYPE_LIST_UNAVAILABLE: 伤害类型读取失败')).toHaveCount(0);
    await blockedDamage.getByLabel('结果标识', { exact: true }).fill('local_heal');
    await blockedDamage.getByLabel('结果名称', { exact: true }).fill('局部治疗');
    await fillValueRule(page, blockedDamage, '治疗公式');
    await saveOpenModal(blockedDamage);
    await expect(createModal.locator('tr', { hasText: 'local_heal' })).toBeVisible();
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    diagnostics.assertClean('disabled catalog refs and local catalog failure');
  });

  test('keeps the effect draft after save failure and discards unsaved drafts on mask or Escape', async ({ page }, testInfo) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await createModal.getByLabel('效果标识', { exact: true }).fill('draft_effect');
    await createModal.getByLabel('效果名称', { exact: true }).fill('草稿效果');
    await createModal.getByLabel('说明', { exact: true }).fill('完整聚合草稿');

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const firstResult = visibleModal(page, '新增结果');
    await firstResult.getByLabel('结果标识', { exact: true }).fill('draft_hit');
    await firstResult.getByLabel('结果名称', { exact: true }).fill('草稿伤害');
    await fillValueRule(page, firstResult, '伤害公式');
    await chooseSelectOption(page, firstResult, '伤害类型', '物理伤害');
    await saveOpenModal(firstResult);

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const secondResult = visibleModal(page, '新增结果');
    await secondResult.getByLabel('结果标识', { exact: true }).fill('draft_poison');
    await secondResult.getByLabel('结果名称', { exact: true }).fill('草稿中毒');
    await chooseSelectOption(page, secondResult, '结果种类', '状态操作');
    await chooseSelectOption(page, secondResult, '状态', '中毒');
    await saveOpenModal(secondResult);

    mock.effectWriteFailure = 'validation';
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByText('服务端效果名称校验失败', { exact: true })).toBeVisible();
    await expect(createModal.getByLabel('效果标识', { exact: true })).toHaveValue('draft_effect');
    await expect(createModal.getByLabel('效果名称', { exact: true })).toHaveValue('草稿效果');
    await expect(createModal.getByLabel('说明', { exact: true })).toHaveValue('完整聚合草稿');
    await expect(createModal.locator('tr', { hasText: 'draft_hit' })).toBeVisible();
    await expect(createModal.locator('tr', { hasText: 'draft_poison' })).toBeVisible();
    expect(mock.skillEffects).toHaveLength(0);

    mock.effectWriteFailure = 'network';
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal.getByText(/fetch|network/i)).toBeVisible();
    await expect(createModal.getByLabel('效果名称', { exact: true })).toHaveValue('草稿效果');
    await expect(createModal.locator('tr', { hasText: 'draft_poison' })).toBeVisible();

    mock.effectWriteFailure = null;
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(shell.getByText('效果「草稿效果」已保存。', { exact: true })).toBeVisible();
    await expect(shell).toBeVisible();

    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const discardEffect = visibleModal(page, '新增效果');
    await discardEffect.getByLabel('效果名称', { exact: true }).fill('将被丢弃的效果');
    await discardEffect.getByRole('button', { name: '新增结果', exact: true }).click();
    const discardResult = visibleModal(page, '新增结果');
    await discardResult.getByLabel('结果名称', { exact: true }).fill('将被丢弃的结果');
    await page.keyboard.press('Escape');
    await expect(discardResult).toBeHidden();
    await expect(discardEffect).toBeVisible();
    await expect(discardEffect.getByText('暂无结果', { exact: true })).toBeVisible();
    await expect(discardEffect.getByLabel('效果名称', { exact: true })).toHaveValue('将被丢弃的效果');

    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(discardEffect).toBeHidden();
    expect(mock.skillEffects).toHaveLength(1);

    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const reopened = visibleModal(page, '新增效果');
    await expect(reopened.getByLabel('效果名称', { exact: true })).toHaveValue('');
    await expect(reopened.getByText('暂无结果', { exact: true })).toBeVisible();
    await closeEditorByOutsideOrEscape(page, testInfo);
    diagnostics.assertClean('effect save failure retains draft and mask/escape discards');
  });

  test('creates, reopens and updates a lifecycle effect', async ({ page }) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await createModal.getByLabel('效果标识', { exact: true }).fill('toxic_trap');
    await createModal.getByLabel('效果名称', { exact: true }).fill('剧毒陷阱');
    await createModal.getByLabel('生命周期', { exact: true }).click();
    await chooseSelectOption(page, createModal, '持续时间取值', '持续时间');
    await chooseSelectOption(page, createModal, '最大层数取值', '一层');
    await chooseSelectOption(page, createModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, createModal, '实例范围', '按来源与承受对象');
    await chooseSelectOption(page, createModal, '重复层数', '保留层数');
    await chooseSelectOption(page, createModal, '重复持续', '刷新全部时间');
    await chooseSelectOption(page, createModal, '到期方式', '一次全部到期');

    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const resultModal = visibleModal(page, '新增结果');
    await resultModal.getByLabel('结果标识', { exact: true }).fill('poison_tick');
    await resultModal.getByLabel('结果名称', { exact: true }).fill('周期伤害');
    await fillValueRule(page, resultModal, '伤害公式');
    await chooseSelectOption(page, resultModal, '伤害类型', '物理伤害');
    await chooseSelectOption(page, resultModal, '生命周期时点', '每次周期');
    await clickArcoRadioByVisibleLabel(resultModal, '到当前时点重新读取');
    await clickArcoRadioByVisibleLabel(resultModal, '每个生命周期实例执行一次');
    await saveOpenModal(resultModal);

    await chooseSelectOption(page, createModal, '周期间隔取值', '周期间隔');
    await chooseSelectOption(page, createModal, '首次周期', '等待一个间隔');
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(shell.getByText('有生命周期', { exact: true })).toBeVisible();

    const createWrite = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/effects'));
    expect(createWrite?.body.lifecycle).toMatchObject({
      durationValue: formulaValue("poison_duration_ms"),
      maxStacksValue: formulaValue("one"),
      applicationStacksValue: formulaValue("one"),
      instanceScope: 'SOURCE_TARGET',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: formulaValue("poison_tick_interval_ms"),
      firstPeriodicExecution: 'AFTER_INTERVAL'
    });
    expect(createWrite?.body.results[0]).toMatchObject({
      resultType: 'DAMAGE',
      lifecycleBehavior: {
        moment: 'PERIODIC',
        valueReadMode: 'MOMENT_EVALUATION',
        stackValueMode: null,
        reapplicationValueMode: null,
        periodicExecutionMode: 'ONCE_PER_INSTANCE'
      }
    });

    await shell.locator('tr', { hasText: 'toxic_trap' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑效果');
    await expect(editModal.getByLabel('实例范围', { exact: true })).toBeDisabled();
    await chooseSelectOption(page, editModal, '重复层数', '增加层数');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    const updateWrite = mock.writes.filter((item) => item.method === 'PUT' && item.path.endsWith('/effects/toxic_trap')).at(-1);
    expect(updateWrite?.body.lifecycle).toMatchObject({
      instanceScope: 'SOURCE_TARGET',
      reapplicationStackMode: 'INCREASE'
    });
    diagnostics.assertClean('lifecycle effect create reopen and update');
  });

  test('configures persistent attribute, shield and status apply plus lifecycle operation targets', async ({ page }) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const targetModal = visibleModal(page, '新增效果');
    await targetModal.getByLabel('效果标识', { exact: true }).fill('focus_mark');
    await targetModal.getByLabel('效果名称', { exact: true }).fill('专注印记');
    await targetModal.getByLabel('生命周期', { exact: true }).click();
    await chooseSelectOption(page, targetModal, '持续时间取值', '持续时间');
    await chooseSelectOption(page, targetModal, '最大层数取值', '一层');
    await chooseSelectOption(page, targetModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, targetModal, '实例范围', '按承受对象');
    await chooseSelectOption(page, targetModal, '重复层数', '增加层数');
    await chooseSelectOption(page, targetModal, '重复持续', '刷新全部时间');
    await chooseSelectOption(page, targetModal, '到期方式', '一次全部到期');
    await targetModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const slowModal = visibleModal(page, '新增结果');
    await slowModal.getByLabel('结果标识', { exact: true }).fill('slow');
    await slowModal.getByLabel('结果名称', { exact: true }).fill('持续减速');
    await chooseSelectOption(page, slowModal, '结果种类', '属性变化');
    await fillValueRule(page, slowModal, '伤害公式');
    await chooseSelectOption(page, slowModal, '属性', '攻击力');
    await clickArcoRadioByVisibleLabel(slowModal, '减少');
    await chooseSelectOption(page, slowModal, '生命周期时点', '持续生效');
    await chooseSelectOption(page, slowModal, '乘区', '属性比例加算');
    await clickArcoRadioByVisibleLabel(slowModal, '整个实例共享数值');
    await slowModal.getByLabel('重复值方式', { exact: true }).locator('label.arco-radio', { hasText: /^覆盖$/ }).click();
    await saveOpenModal(slowModal);
    await targetModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(targetModal).toBeHidden();

    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const shieldModal = visibleModal(page, '新增效果');
    await shieldModal.getByLabel('效果标识', { exact: true }).fill('barrier');
    await shieldModal.getByLabel('效果名称', { exact: true }).fill('护盾');
    await shieldModal.getByLabel('生命周期', { exact: true }).click();
    await chooseSelectOption(page, shieldModal, '持续时间取值', '持续时间');
    await chooseSelectOption(page, shieldModal, '最大层数取值', '一层');
    await chooseSelectOption(page, shieldModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, shieldModal, '实例范围', '当前技能');
    await chooseSelectOption(page, shieldModal, '重复层数', '覆盖层数');
    await chooseSelectOption(page, shieldModal, '重复持续', '保留剩余时间');
    await chooseSelectOption(page, shieldModal, '到期方式', '逐层到期');
    await shieldModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const shieldResult = visibleModal(page, '新增结果');
    await shieldResult.getByLabel('结果标识', { exact: true }).fill('normal_shield');
    await shieldResult.getByLabel('结果名称', { exact: true }).fill('普通护盾');
    await chooseSelectOption(page, shieldResult, '结果种类', '普通护盾');
    await fillValueRule(page, shieldResult, '治疗公式');
    await chooseSelectOption(page, shieldResult, '生命周期时点', '持续生效');
    await clickArcoRadioByVisibleLabel(shieldResult, '每层分别贡献数值');
    await expect(shieldResult.getByLabel('重复值方式', { exact: true })).toHaveCount(0);
    await saveOpenModal(shieldResult);
    await shieldModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const statusResult = visibleModal(page, '新增结果');
    await statusResult.getByLabel('结果标识', { exact: true }).fill('apply_poison');
    await statusResult.getByLabel('结果名称', { exact: true }).fill('施加中毒');
    await chooseSelectOption(page, statusResult, '结果种类', '状态操作');
    await chooseSelectOption(page, statusResult, '状态', '中毒');
    await chooseSelectOption(page, statusResult, '生命周期时点', '持续生效');
    await expect(statusResult.getByLabel('层数值方式', { exact: true })).toHaveCount(0);
    await saveOpenModal(statusResult);
    await shieldModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(shieldModal).toBeHidden();

    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const opModal = visibleModal(page, '新增效果');
    await opModal.getByLabel('效果标识', { exact: true }).fill('consume_focus');
    await opModal.getByLabel('效果名称', { exact: true }).fill('消耗专注');
    await opModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const opResult = visibleModal(page, '新增结果');
    await opResult.getByLabel('结果标识', { exact: true }).fill('consume');
    await opResult.getByLabel('结果名称', { exact: true }).fill('消耗印记');
    await chooseSelectOption(page, opResult, '结果种类', '生命周期操作');
    await chooseSelectOption(page, opResult, '目标效果', '专注印记');
    await chooseSelectOption(page, opResult, '生命周期操作', '消耗');
    await fillValueRule(page, opResult, '一层');
    await expect(opResult.getByLabel('生命周期时点', { exact: true })).toHaveCount(0);
    await opResult.getByLabel('目标效果', { exact: true }).click();
    await expect(page.getByRole('option', { name: '专注印记', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '护盾', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '消耗专注', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await saveOpenModal(opResult);
    await opModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(opModal).toBeHidden();

    await shell.locator('tr', { hasText: 'focus_mark' }).getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除效果');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(deleteModal.getByText('该效果正在被其他效果的生命周期操作引用，不能删除。', { exact: true })).toBeVisible();
    await deleteModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(shell.locator('tr', { hasText: 'focus_mark' })).toBeVisible();
    diagnostics.assertClean('persistent results and lifecycle operation targets');
  });

  test('blocks illegal lifecycle combinations and keeps drafts after backend field errors', async ({ page }) => {
    const mock = new MockApi();
    seedSkillEffectCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增效果', exact: true }).click();
    const createModal = visibleModal(page, '新增效果');
    await createModal.getByLabel('效果标识', { exact: true }).fill('bad_combo');
    await createModal.getByLabel('效果名称', { exact: true }).fill('非法组合');
    await createModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const resultModal = visibleModal(page, '新增结果');
    await resultModal.getByLabel('结果标识', { exact: true }).fill('hit');
    await resultModal.getByLabel('结果名称', { exact: true }).fill('伤害');
    await fillValueRule(page, resultModal, '伤害公式');
    await chooseSelectOption(page, resultModal, '伤害类型', '物理伤害');
    await saveOpenModal(resultModal);
    await createModal.getByLabel('生命周期', { exact: true }).click();
    await expect(createModal.getByText('待配置', { exact: true })).toBeVisible();
    await expect(createModal.getByRole('button', { name: '保存', exact: true })).toBeDisabled();

    await createModal.locator('tr', { hasText: 'hit' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editResult = visibleModal(page, '编辑结果');
    await editResult.getByLabel('生命周期时点', { exact: true }).click();
    await expect(page.getByRole('option', { name: '自然结束', exact: true })).toHaveCount(0);
    await chooseVisibleOption(page, '施加时');
    await saveOpenModal(editResult);

    await chooseSelectOption(page, createModal, '最大层数取值', '一层');
    await chooseSelectOption(page, createModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, createModal, '实例范围', '当前技能');
    await chooseSelectOption(page, createModal, '重复层数', '保留层数');
    mock.effectWriteFailure = 'lifecycle-field';
    mock.effectWriteFieldIssues = [
      {
        field: 'lifecycle.durationValue',
        code: 'REFRESH_OPERATION_IN_USE',
        message: '该持续时间仍被刷新操作引用。'
      }
    ];
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByText('该持续时间仍被刷新操作引用。', { exact: true })).toBeVisible();
    await expect(createModal.getByLabel('效果名称', { exact: true })).toHaveValue('非法组合');
    await expect(createModal.locator('tr', { hasText: 'hit' })).toBeVisible();
    diagnostics.assertClean('illegal lifecycle combinations and retained field errors');
  });

  for (const target of [
    { kind: 'process', action: '查看', title: '查看过程', field: '过程名称', value: '主要施放过程', key: 'primary_cast' },
    { kind: 'process', action: '编辑', title: '编辑过程', field: '过程名称', value: '主要施放过程', key: 'primary_cast' },
    { kind: 'effect', action: '查看', title: '查看效果', field: '效果名称', value: '命中结果', key: 'on_hit_results' },
    { kind: 'effect', action: '编辑', title: '编辑效果', field: '效果名称', value: '命中结果', key: 'on_hit_results' },
    { kind: 'rule', action: '编辑', title: '编辑规则', field: '规则名称', value: '已有命中规则', key: 'existing_hit' }
  ] as const) test(`详情加载状态：${target.title}不展示可被响应覆盖的默认表单`, async ({ page }) => {
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    mock.skillTriggerRules = [{
      gameId: GAME_ID, skillKey: 'varus_w', ruleKey: 'existing_hit', name: '已有命中规则',
      description: null, sortOrder: 10,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'varus_w' } },
      conditionGroups: [], perTargetCooldown: null, maxTriggersPerProcess: null,
      actions: [{ actionKey: 'apply_damage', name: '造成伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'on_hit_results' }, runtimeInputBindings: [], resultModifiers: [] }],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);
    const hold = createDeferred();
    const collection = target.kind === 'process' ? 'processes' : target.kind === 'effect' ? 'effects' : 'trigger-rules';
    await page.route(`**/skills/varus_w/${collection}/${target.key}`, async (route) => {
      await hold.promise;
      await route.fallback();
    });
    await openSkills(page);
    const shell = target.kind === 'process'
      ? await openSkillProcesses(page, 'varus_w', '枯萎箭袋')
      : target.kind === 'effect'
        ? await openSkillEffects(page, 'varus_w', '枯萎箭袋')
        : await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    if (target.kind === 'rule') {
      await shell.getByRole('button', { name: '新增规则', exact: true }).click();
      const create = visibleModal(page, '新增规则');
      await expect(create.getByLabel('规则名称', { exact: true })).toBeVisible();
      await create.getByRole('button', { name: '取消', exact: true }).click();
      await expect(create).toBeHidden();
    }
    await shell.locator('tr', { hasText: target.key }).getByRole('button', { name: target.action, exact: true }).click();
    const editor = visibleModal(page, target.title);
    const label = target.kind === 'process' ? '过程' : target.kind === 'effect' ? '效果' : '规则';
    try {
      await expect(editor.getByText(`正在加载${label}详情…`, { exact: true })).toBeVisible();
      await expect(editor.getByLabel(target.field, { exact: true })).toHaveCount(0);
      await expect(editor.getByText('1. action_1', { exact: true })).toHaveCount(0);
      if (target.action === '编辑') await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    } finally {
      hold.resolve();
    }
    await expect(editor.getByLabel(target.field, { exact: true })).toHaveValue(target.value);
    await expect(editor.getByText(`正在加载${label}详情…`, { exact: true })).toHaveCount(0);
    expect(mock.writes).toHaveLength(0);
    diagnostics.assertClean('detail loading hides uninitialized drafts');
  });

  test('详情加载状态：失败与重试期间保持默认正文隐藏', async ({ page }) => {
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    await prepare(page, mock);
    const retry = createDeferred();
    let reads = 0;
    await page.route('**/skills/varus_w/processes/primary_cast', async (route) => {
      reads += 1;
      if (reads === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: '503.UNAVAILABLE', message: '详情暂时不可用' } }) });
      } else {
        await retry.promise;
        await route.fallback();
      }
    });
    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await shell.locator('tr', { hasText: 'primary_cast' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editor = visibleModal(page, '编辑过程');
    await expect(editor.getByText(/详情暂时不可用/)).toBeVisible();
    await expect(editor.getByLabel('过程名称', { exact: true })).toHaveCount(0);
    await editor.getByRole('button', { name: '重试', exact: true }).click();
    try {
      await expect(editor.getByText('正在加载过程详情…', { exact: true })).toBeVisible();
      await expect(editor.getByLabel('过程名称', { exact: true })).toHaveCount(0);
      await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    } finally {
      retry.resolve();
    }
    await expect(editor.getByLabel('过程名称', { exact: true })).toHaveValue('主要施放过程');
    expect(reads).toBe(2);
    expect(mock.writes).toHaveLength(0);
  });

  test('详情加载状态：结果目录未返回时不误报未知引用', async ({ page }) => {
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    const diagnostics = await prepare(page, mock);
    await openSkills(page);
    const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await shell.locator('tr', { hasText: 'mana_cost' }).getByRole('button', { name: '编辑', exact: true }).click();
    const effect = visibleModal(page, '编辑效果');
    await expect(effect.getByLabel('效果名称', { exact: true })).toHaveValue('法力消耗');
    const hold = createDeferred();
    await page.route(`**/api/admin/games/${GAME_ID}/attributes`, async (route) => {
      await hold.promise;
      await route.fallback();
    });
    await effect.getByRole('button', { name: '编辑', exact: true }).click();
    const result = visibleModal(page, '编辑结果');
    try {
      await expect(result.getByText('正在加载引用目录…', { exact: true })).toBeVisible();
      await expect(result.getByText('目录不完整，无法保存未知引用。', { exact: true })).toHaveCount(0);
      await expect(result.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    } finally {
      hold.resolve();
    }
    await expect(result.getByText('正在加载引用目录…', { exact: true })).toHaveCount(0);
    await expect(result.getByLabel('资源属性', { exact: true })).toContainText('法力值');
    await expect(result.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    expect(mock.writes).toHaveLength(0);
    diagnostics.assertClean('pending result catalog is not an unknown reference');
  });

  test('adds a process entry on the skills page without a new route', async ({ page }) => {
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    await expect(skillRow(page, 'varus_w').getByRole('button', { name: '过程与内部状态', exact: true })).toHaveCount(1);
    expect(await page.locator('a[href="#/skill-processes"]').count()).toBe(0);
    expect(await page.locator('a[href="#/internal-states"]').count()).toBe(0);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await expect(shell.getByRole('tab', { name: '技能过程' })).toBeVisible();
    await expect(shell.getByRole('tab', { name: '内部状态' })).toBeVisible();
    await expect(shell.getByText('暂无技能过程', { exact: true })).toBeVisible();
    await assertNoForbiddenSkillProcessTerms(page.locator('.app-main'));
    await assertNoForbiddenSkillProcessTerms(shell);
    diagnostics.assertClean('process entry without new route');
  });

  test('manages five internal state kinds from the skills page entry', async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    mock.internalStateDeleteConflictKeys.add('focus_stacks');
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('tab', { name: '内部状态' }).click();
    await expect(shell.getByText('暂无内部状态', { exact: true })).toBeVisible();

    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const counterModal = visibleModal(page, '新增内部状态');
    await counterModal.getByLabel('内部状态标识', { exact: true }).fill('focus_stacks');
    await counterModal.getByLabel('内部状态名称', { exact: true }).fill('专注层数');
    await expect(counterModal.getByLabel('状态种类', { exact: true })).toContainText('计数');
    await clickArcoRadioByVisibleLabel(counterModal, '按当前目标分别保存');
    await chooseSelectOption(page, counterModal, '初始值取值', '零');
    await chooseSelectOption(page, counterModal, '上限取值', '专注上限');
    await saveOpenModal(counterModal);
    await expect(shell.getByText('内部状态「专注层数」已保存。', { exact: true })).toBeVisible();

    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const ammoModal = visibleModal(page, '新增内部状态');
    await ammoModal.getByLabel('内部状态标识', { exact: true }).fill('ammo');
    await ammoModal.getByLabel('内部状态名称', { exact: true }).fill('弹药');
    await chooseSelectOption(page, ammoModal, '状态种类', '弹药');
    await expect(ammoModal.getByLabel('保存范围', { exact: true }).getByText('按当前目标分别保存')).toHaveCount(0);
    await chooseSelectOption(page, ammoModal, '初始值取值', '最大弹药');
    await chooseSelectOption(page, ammoModal, '上限取值', '最大弹药');
    await chooseSelectOption(page, ammoModal, '恢复间隔取值', '弹药恢复');
    await clickArcoRadioByVisibleLabel(ammoModal, '一次全部恢复');
    await expect(ammoModal.getByText('结果按毫秒解释')).toBeVisible();
    await saveOpenModal(ammoModal);

    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const modeModal = visibleModal(page, '新增内部状态');
    await modeModal.getByLabel('内部状态标识', { exact: true }).fill('weapon_mode');
    await modeModal.getByLabel('内部状态名称', { exact: true }).fill('武器模式');
    await chooseSelectOption(page, modeModal, '状态种类', '模式');
    await expect(modeModal.getByLabel('初始值取值', { exact: true })).toHaveCount(0);
    await modeModal.getByLabel('选项标识 1', { exact: true }).fill('minigun');
    await modeModal.getByLabel('选项名称 1', { exact: true }).fill('机枪');
    await modeModal.getByLabel('选项标识 2', { exact: true }).fill('rocket');
    await modeModal.getByLabel('选项名称 2', { exact: true }).fill('火箭');
    await modeModal.getByLabel('初始选项 1', { exact: true }).click();
    await saveOpenModal(modeModal);

    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const flagModal = visibleModal(page, '新增内部状态');
    await flagModal.getByLabel('内部状态标识', { exact: true }).fill('ready');
    await flagModal.getByLabel('内部状态名称', { exact: true }).fill('已准备');
    await chooseSelectOption(page, flagModal, '状态种类', '准备标记');
    await expect(flagModal.getByLabel('时长取值', { exact: true })).toHaveCount(0);
    await flagModal.getByLabel('初始是否启用', { exact: true }).click();
    await saveOpenModal(flagModal);

    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const cooldownModal = visibleModal(page, '新增内部状态');
    await cooldownModal.getByLabel('内部状态标识', { exact: true }).fill('internal_cd');
    await cooldownModal.getByLabel('内部状态名称', { exact: true }).fill('内部冷却');
    await chooseSelectOption(page, cooldownModal, '状态种类', '内部冷却');
    await chooseSelectOption(page, cooldownModal, '时长取值', '内部冷却时长');
    await expect(cooldownModal.getByText('结果按毫秒解释')).toBeVisible();
    await saveOpenModal(cooldownModal);

    await shell.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(shell.locator('tr', { hasText: 'focus_stacks' })).toContainText('专注层数');
    await expect(shell.locator('tr', { hasText: 'weapon_mode' })).toContainText('模式');

    await shell.locator('tr', { hasText: 'weapon_mode' }).getByRole('button', { name: '查看', exact: true }).click();
    const viewMode = visibleModal(page, '查看内部状态');
    await expect(viewMode.getByLabel('内部状态标识', { exact: true })).toBeDisabled();
    await expect(viewMode.getByLabel('选项标识 1', { exact: true })).toHaveValue('minigun');
    await expect(viewMode.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
    await closeEditorByOutsideOrEscape(page, testInfo);

    await shell.locator('tr', { hasText: 'ammo' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editAmmo = visibleModal(page, '编辑内部状态');
    await expect(editAmmo.getByLabel('内部状态标识', { exact: true })).toBeDisabled();
    await expect(editAmmo.getByLabel('状态种类', { exact: true })).toBeDisabled();
    await editAmmo.getByLabel('内部状态名称', { exact: true }).fill('弹药改');
    await saveOpenModal(editAmmo);

    const createWrite = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/internal-states') && item.body.stateKey === 'focus_stacks');
    expect(createWrite?.body).toMatchObject({
      stateKey: 'focus_stacks',
      stateType: 'COUNTER',
      scope: 'TARGET',
      detail: {
        initialValue: formulaValue("zero"),
        maxValue: formulaValue("focus_max_stacks")
      }
    });
    const modeWrite = mock.writes.find((item) => item.method === 'POST' && item.body.stateKey === 'weapon_mode');
    expect(modeWrite?.body.detail).toMatchObject({
      options: [
        { optionKey: 'minigun', name: '机枪', initial: true },
        { optionKey: 'rocket', name: '火箭', initial: false }
      ]
    });

    await shell.locator('tr', { hasText: 'focus_stacks' }).getByRole('button', { name: '删除', exact: true }).click();
    const deleteInUse = visibleModal(page, '删除内部状态');
    await deleteInUse.getByRole('button', { name: '删除', exact: true }).click();
    await expect(deleteInUse.getByText('该内部状态正在被技能过程或条件与触发规则使用，不能删除')).toBeVisible();
    await deleteInUse.getByRole('button', { name: '取消', exact: true }).click();

    await shell.locator('tr', { hasText: 'ready' }).getByRole('button', { name: '删除', exact: true }).click();
    const deleteReady = visibleModal(page, '删除内部状态');
    await deleteReady.getByRole('button', { name: '删除', exact: true }).click();
    await expect(shell.getByText('内部状态「已准备」已删除。', { exact: true })).toBeVisible();
    diagnostics.assertClean('five internal state kinds');
  });

  test('covers eight process step editors and clears hidden fields', async ({ page }) => {
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增过程', exact: true }).click();
    const createModal = visibleModal(page, '新增过程');
    await createModal.getByRole('button', { name: '新增步骤', exact: true }).click();
    const stepModal = visibleModal(page, '新增步骤');
    await expect(stepModal.getByLabel('延迟取值', { exact: true })).toHaveCount(0);

    await chooseSelectOption(page, stepModal, '步骤种类', '延迟');
    await expect(stepModal.getByLabel('延迟取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByText('时长按毫秒解释')).toBeVisible();

    await chooseSelectOption(page, stepModal, '步骤种类', '多段');
    await expect(stepModal.getByLabel('延迟取值', { exact: true })).toHaveCount(0);
    await expect(stepModal.getByLabel('执行次数取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('间隔取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByText('未来按正整数解释')).toBeVisible();

    await chooseSelectOption(page, stepModal, '步骤种类', '周期');
    await expect(stepModal.getByLabel('首次执行时机', { exact: true })).toBeVisible();

    await chooseSelectOption(page, stepModal, '步骤种类', '引导');
    await expect(stepModal.getByLabel('持续时间取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('执行次数取值', { exact: true })).toBeVisible();

    await chooseSelectOption(page, stepModal, '步骤种类', '蓄力');
    await expect(stepModal.getByLabel('最短蓄力取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('最长蓄力取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('到达最长时间是否自动释放', { exact: true })).toBeVisible();

    await chooseSelectOption(page, stepModal, '步骤种类', '重施');
    await expect(stepModal.getByLabel('重施窗口取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('最大重施次数取值', { exact: true })).toBeVisible();

    await chooseSelectOption(page, stepModal, '步骤种类', '强化下一次普通攻击');
    await expect(stepModal.getByLabel('有效窗口取值', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('消耗时点', { exact: true })).toBeVisible();
    await expect(stepModal.getByLabel('最短蓄力取值', { exact: true })).toHaveCount(0);
    await assertNoForbiddenSkillProcessTerms(stepModal);

    await stepModal.getByLabel('步骤标识', { exact: true }).fill('empowered');
    await stepModal.getByLabel('步骤名称', { exact: true }).fill('强化普攻');
    await chooseSelectOption(page, stepModal, '有效窗口取值', '强化窗口');
    await clickArcoRadioByVisibleLabel(stepModal, '攻击发起');
    await saveOpenModal(stepModal);
    await expect(createModal.locator('tr', { hasText: 'empowered' })).toContainText('强化下一次普通攻击');
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    diagnostics.assertClean('eight process step editors');
  });

  test('creates, updates and deletes a process aggregate with cooldown, bindings and operations', async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    mock.skillInternalStates = [
      {
        gameId: GAME_ID,
        skillKey: 'varus_w',
        stateKey: 'focus_stacks',
        name: '专注层数',
        stateType: 'COUNTER',
        scope: 'SKILL',
        description: null,
        sortOrder: 10,
        detail: { initialValue: formulaValue("zero"), maxValue: formulaValue("focus_max_stacks") },
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT
      },
      {
        gameId: GAME_ID,
        skillKey: 'varus_w',
        stateKey: 'weapon_mode',
        name: '武器模式',
        stateType: 'MODE',
        scope: 'SKILL',
        description: null,
        sortOrder: 20,
        detail: {
          options: [
            { optionKey: 'minigun', name: '机枪', sortOrder: 10, initial: true },
            { optionKey: 'rocket', name: '火箭', sortOrder: 20, initial: false }
          ]
        },
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT
      }
    ];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增过程', exact: true }).click();
    const createModal = visibleModal(page, '新增过程');
    await createModal.getByLabel('过程标识', { exact: true }).fill('primary_cast');
    await createModal.getByLabel('过程名称', { exact: true }).fill('主要施放过程');
    await createModal.getByLabel('排序', { exact: true }).fill('10');
    await clickArcoRadioByVisibleLabel(createModal, '配置普通冷却');
    await chooseSelectOption(page, createModal, '冷却时长取值', '冷却时长');
    await expect(createModal.getByText('时长按毫秒解释')).toBeVisible();

    await createModal.locator('tr', { hasText: '暂无步骤' }).waitFor({ state: 'hidden' }).catch(() => undefined);
    await createModal.locator('tr').filter({ hasText: '立即' }).getByRole('button', { name: '编辑', exact: true }).click();
    const hitStep = visibleModal(page, '编辑步骤');
    await hitStep.getByLabel('步骤标识', { exact: true }).fill('hit');
    await hitStep.getByLabel('步骤名称', { exact: true }).fill('命中');
    await saveOpenModal(hitStep);

    await createModal.getByRole('button', { name: '新增步骤', exact: true }).click();
    const delayStep = visibleModal(page, '新增步骤');
    await delayStep.getByLabel('步骤标识', { exact: true }).fill('delay');
    await delayStep.getByLabel('步骤名称', { exact: true }).fill('延迟');
    await chooseSelectOption(page, delayStep, '步骤种类', '延迟');
    await chooseSelectOption(page, delayStep, '延迟取值', '延迟');
    await saveOpenModal(delayStep);

    await createModal.getByRole('button', { name: '新增效果挂接', exact: true }).click();
    const hitBinding = visibleModal(page, '新增效果挂接');
    await hitBinding.getByLabel('挂接标识', { exact: true }).fill('hit_results');
    await chooseSelectOption(page, hitBinding, '效果', '命中结果');
    await chooseSelectOption(page, hitBinding, '过程时点', '步骤执行');
    await chooseSelectOption(page, hitBinding, '步骤', '命中');
    await saveOpenModal(hitBinding);

    await createModal.getByRole('button', { name: '新增效果挂接', exact: true }).click();
    const manaBinding = visibleModal(page, '新增效果挂接');
    await manaBinding.getByLabel('挂接标识', { exact: true }).fill('mana_cost');
    await chooseSelectOption(page, manaBinding, '效果', '法力消耗');
    await chooseSelectOption(page, manaBinding, '过程时点', '过程开始');
    await expect(manaBinding.getByLabel('步骤', { exact: true })).toHaveCount(0);
    await saveOpenModal(manaBinding);

    await createModal.getByRole('button', { name: '新增内部状态操作', exact: true }).click();
    const consumeOp = visibleModal(page, '新增内部状态操作');
    await consumeOp.getByLabel('操作标识', { exact: true }).fill('consume_focus');
    await consumeOp.getByLabel('操作名称', { exact: true }).fill('消耗专注层数');
    await chooseSelectOption(page, consumeOp, '内部状态', '专注层数（计数）');
    await chooseSelectOption(page, consumeOp, '操作', '消耗');
    await chooseSelectOption(page, consumeOp, '数值', '专注消耗');
    await chooseSelectOption(page, consumeOp, '过程时点', '过程开始');
    await saveOpenModal(consumeOp);

    await createModal.getByRole('button', { name: '新增内部状态操作', exact: true }).click();
    const selectOp = visibleModal(page, '新增内部状态操作');
    await selectOp.getByLabel('操作标识', { exact: true }).fill('select_rocket');
    await selectOp.getByLabel('操作名称', { exact: true }).fill('选择火箭');
    await chooseSelectOption(page, selectOp, '内部状态', '武器模式（模式）');
    await expect(selectOp.getByLabel('数值', { exact: true })).toHaveCount(0);
    await chooseSelectOption(page, selectOp, '模式选项', '火箭');
    await chooseSelectOption(page, selectOp, '过程时点', '过程完成');
    await saveOpenModal(selectOp);

    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(shell.getByText('过程「主要施放过程」已保存。', { exact: true })).toBeVisible();
    const createWrite = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/processes'));
    expect(createWrite?.body).toMatchObject({
      processKey: 'primary_cast',
      activationType: 'ACTIVE',
      cooldown: {
        durationValue: formulaValue("cooldown_ms"),
        startMoment: { momentType: 'PROCESS_START', stepKey: null }
      }
    });
    expect(createWrite?.body.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKey: 'hit', stepType: 'IMMEDIATE', detail: {} }),
      expect.objectContaining({ stepKey: 'delay', stepType: 'DELAY', detail: { delayValue: formulaValue("impact_delay_ms") } })
    ]));
    expect(createWrite?.body.effectBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bindingKey: 'hit_results',
        effectKey: 'on_hit_results',
        moment: { momentType: 'STEP_EXECUTION', stepKey: 'hit' }
      })
    ]));
    expect(createWrite?.body.stateOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationKey: 'consume_focus',
        operation: 'CONSUME',
        value: formulaValue("focus_cost"),
        optionKey: null
      }),
      expect.objectContaining({
        operationKey: 'select_rocket',
        operation: 'SELECT',
        value: null,
        optionKey: 'rocket'
      })
    ]));

    await shell.locator('tr', { hasText: 'primary_cast' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑过程');
    await expect(editModal.getByLabel('过程标识', { exact: true })).toBeDisabled();
    await editModal.locator('tr', { hasText: 'mana_cost' }).getByRole('button', { name: '删除', exact: true }).click();
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editModal).toBeHidden();
    const updateWrite = mock.writes.filter((item) => item.method === 'PUT' && item.path.endsWith('/processes/primary_cast')).at(-1);
    expect(updateWrite?.body).not.toHaveProperty('processKey');
    expect((updateWrite?.body.effectBindings as SkillProcessEffectBindingRow[]).map((item) => item.bindingKey)).not.toContain('mana_cost');

    await shell.locator('tr', { hasText: 'primary_cast' }).getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除过程');
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(shell.getByText('过程「主要施放过程」已删除。', { exact: true })).toBeVisible();
    expect(mock.skillProcesses).toHaveLength(0);
    diagnostics.assertClean('process aggregate create update delete');
  });

  test('blocks deleting a referenced step, retains failed drafts and only stops the failed catalog', async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    mock.skillInternalStates = [{
      gameId: GAME_ID,
      skillKey: 'varus_w',
      stateKey: 'ready',
      name: '已准备',
      stateType: 'FLAG',
      scope: 'SKILL',
      description: null,
      sortOrder: 10,
      detail: { initialEnabled: false },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增过程', exact: true }).click();
    const createModal = visibleModal(page, '新增过程');
    await createModal.getByLabel('过程标识', { exact: true }).fill('draft_process');
    await createModal.getByLabel('过程名称', { exact: true }).fill('草稿过程');
    await createModal.locator('tr').filter({ hasText: '立即' }).getByRole('button', { name: '编辑', exact: true }).click();
    const hitStep = visibleModal(page, '编辑步骤');
    await hitStep.getByLabel('步骤标识', { exact: true }).fill('hit');
    await hitStep.getByLabel('步骤名称', { exact: true }).fill('命中');
    await saveOpenModal(hitStep);

    await createModal.getByRole('button', { name: '新增效果挂接', exact: true }).click();
    const binding = visibleModal(page, '新增效果挂接');
    await binding.getByLabel('挂接标识', { exact: true }).fill('hit_results');
    await chooseSelectOption(page, binding, '效果', '命中结果');
    await chooseSelectOption(page, binding, '过程时点', '步骤执行');
    await chooseSelectOption(page, binding, '步骤', '命中');
    await saveOpenModal(binding);

    const stepSection = createModal.locator('section').filter({ hasText: '过程步骤' });
    await stepSection.locator('tr').filter({ hasText: 'hit' }).getByRole('button', { name: '删除', exact: true }).click();
    await expect(createModal.getByText(/无法删除步骤「命中」，仍被引用：效果挂接 hit_results/)).toBeVisible();
    await expect(stepSection.locator('tr').filter({ hasText: 'hit' })).toBeVisible();

    mock.processWriteFailure = 'validation';
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByText('服务端过程名称校验失败', { exact: true })).toBeVisible();
    await expect(createModal.getByLabel('过程名称', { exact: true })).toHaveValue('草稿过程');
    await expect(createModal.locator('tr', { hasText: 'hit_results' })).toBeVisible();
    expect(mock.skillProcesses).toHaveLength(0);

    mock.processWriteFailure = null;
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(createModal).toBeHidden();

    mock.skillFormulaListFailure = true;
    await shell.getByRole('tab', { name: '内部状态' }).click();
    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const flagCreate = visibleModal(page, '新增内部状态');
    await chooseSelectOption(page, flagCreate, '状态种类', '准备标记');
    await flagCreate.getByLabel('内部状态标识', { exact: true }).fill('ready_flag');
    await flagCreate.getByLabel('内部状态名称', { exact: true }).fill('准备标记');
    await saveOpenModal(flagCreate);
    await expect(shell.getByText('内部状态「准备标记」已保存。', { exact: true })).toBeVisible();

    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const fixedCounter = visibleModal(page, '新增内部状态');
    await fixedCounter.getByLabel('内部状态标识', { exact: true }).fill('fixed_counter');
    await fixedCounter.getByLabel('内部状态名称', { exact: true }).fill('固定数值计数');
    await fixedCounter.getByLabel('初始值取值固定数值', { exact: true }).fill('0');
    await fixedCounter.getByLabel('上限取值固定数值', { exact: true }).fill('3');
    await expect(fixedCounter.getByText(/公式读取失败/)).toHaveCount(0);
    await saveOpenModal(fixedCounter);
    expect(mock.skillInternalStates.find(state => state.stateKey === 'fixed_counter')?.detail).toEqual({ initialValue: { kind: 'FIXED', value: 0 }, maxValue: { kind: 'FIXED', value: 3 } });

    const failedFormulaRead = page.waitForResponse(response => response.url().endsWith('/skills/varus_w/formulas') && response.status() === 503);
    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const blockedCounter = visibleModal(page, '新增内部状态');
    await failedFormulaRead;
    await blockedCounter.getByLabel('内部状态标识', { exact: true }).fill('blocked_counter');
    await blockedCounter.getByLabel('内部状态名称', { exact: true }).fill('被阻断计数');
    await blockedCounter.getByLabel('上限取值固定数值', { exact: true }).fill('3');
    await blockedCounter.getByLabel('初始值取值取值来源', { exact: true }).getByText('技能公式', { exact: true }).click();
    await expect(blockedCounter.getByLabel('初始值取值技能公式', { exact: true })).toBeVisible();
    await blockedCounter.getByRole('button', { name: '保存', exact: true }).click();
    await expect(blockedCounter).toBeVisible();
    await expect(blockedCounter.getByText('取值来源不完整或数值不合法。', { exact: true })).toBeVisible();
    expect(mock.skillInternalStates.some(state => state.stateKey === 'blocked_counter')).toBe(false);
    await expect(blockedCounter.getByRole('button', { name: '重试', exact: true })).toBeVisible();
    mock.skillFormulaListFailure = false;
    const recoveredFormulaRead = page.waitForResponse(response => response.url().endsWith('/skills/varus_w/formulas') && response.status() === 200);
    await blockedCounter.getByRole('button', { name: '重试', exact: true }).click();
    await recoveredFormulaRead;
    await expect(blockedCounter.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
    await expect(blockedCounter.getByLabel('内部状态名称', { exact: true })).toHaveValue('被阻断计数');
    await expect(blockedCounter.getByLabel('上限取值固定数值', { exact: true })).toHaveValue('3');
    expect(mock.skillInternalStates.some(state => state.stateKey === 'blocked_counter')).toBe(false);
    await closeEditorByOutsideOrEscape(page, testInfo);
    diagnostics.assertClean('referenced step block, retained draft and catalog isolation');
  });

  test('keeps process and step drafts when nested parameter-formula catalog is refreshed', async ({ page }) => {
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await expect(shell.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await expect(shell.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(1);

    await shell.getByRole('button', { name: '新增过程', exact: true }).click();
    const createModal = visibleModal(page, '新增过程');
    await createModal.getByLabel('过程标识', { exact: true }).fill('draft_process');
    await createModal.getByLabel('过程名称', { exact: true }).fill('草稿过程');
    await expect(createModal.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await expect(createModal.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(1);

    await createModal.getByRole('button', { name: '新增内部状态操作', exact: true }).click();
    const operationModal = visibleModal(page, '新增内部状态操作');
    await expect(operationModal.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await expect(operationModal.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(0);
    await operationModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(operationModal).toBeHidden();

    await createModal.getByRole('button', { name: '新增步骤', exact: true }).click();
    const stepModal = visibleModal(page, '新增步骤');
    await stepModal.getByLabel('步骤标识', { exact: true }).fill('delay_step');
    await stepModal.getByLabel('步骤名称', { exact: true }).fill('延迟步骤');
    await chooseSelectOption(page, stepModal, '步骤种类', '延迟');
    await expect(stepModal.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await expect(stepModal.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(0);

    await stepModal.getByRole('button', { name: '参数与公式', exact: true }).click();
    const formulaShell = visibleModal(page, '参数与公式 - 枯萎箭袋');
    await expect(formulaShell).toBeVisible();
    await expect(stepModal).toBeVisible();
    await expect(createModal).toBeVisible();

    mock.skillFormulas.push(formulaRow('varus_w', 'nested_catalog_formula', '嵌套目录公式', 99));
    await closeVisibleDialog(formulaShell);
    await expect(stepModal).toBeVisible();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByLabel('过程名称', { exact: true })).toHaveValue('草稿过程');
    await expect(stepModal.getByLabel('步骤标识', { exact: true })).toHaveValue('delay_step');
    await expect(stepModal.getByLabel('步骤名称', { exact: true })).toHaveValue('延迟步骤');
    await expect(stepModal.getByLabel('延迟取值', { exact: true })).not.toContainText('嵌套目录公式');
    await chooseSelectOption(page, stepModal, '延迟取值', '嵌套目录公式');
    diagnostics.assertClean('nested parameter-formula catalog refresh keeps drafts');
  });

  test('keeps effect-binding drafts when nested effect catalog is refreshed', async ({ page }) => {
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增过程', exact: true }).click();
    const createModal = visibleModal(page, '新增过程');
    await createModal.getByLabel('过程标识', { exact: true }).fill('draft_binding_process');
    await createModal.getByLabel('过程名称', { exact: true }).fill('挂接草稿过程');

    await createModal.getByRole('button', { name: '新增效果挂接', exact: true }).click();
    const bindingModal = visibleModal(page, '新增效果挂接');
    await bindingModal.getByLabel('挂接标识', { exact: true }).fill('draft_binding');
    await expect(bindingModal.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(1);
    await expect(bindingModal.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(0);

    await bindingModal.getByRole('button', { name: '效果与结果', exact: true }).click();
    const effectShell = visibleModal(page, '效果与结果 - 枯萎箭袋');
    await expect(effectShell).toBeVisible();
    await expect(bindingModal).toBeVisible();
    await expect(createModal).toBeVisible();

    mock.skillEffects.push({
      gameId: GAME_ID,
      skillKey: 'varus_w',
      effectKey: 'nested_catalog_effect',
      name: '嵌套目录效果',
      description: null,
      sortOrder: 99,
      lifecycle: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      results: []
    });
    await closeVisibleDialog(effectShell);
    await expect(bindingModal).toBeVisible();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByLabel('过程名称', { exact: true })).toHaveValue('挂接草稿过程');
    await expect(bindingModal.getByLabel('挂接标识', { exact: true })).toHaveValue('draft_binding');
    await expect(bindingModal.getByLabel('效果', { exact: true })).not.toContainText('嵌套目录效果');
    await chooseSelectOption(page, bindingModal, '效果', '嵌套目录效果');
    diagnostics.assertClean('nested effect catalog refresh keeps binding drafts');
  });

  test('shows nested catalog entries on create and edit, but not in view mode', async ({ page }, testInfo) => {
    const mock = new MockApi();
    seedSkillProcessCatalog(mock);
    mock.skillInternalStates = [{
      gameId: GAME_ID,
      skillKey: 'varus_w',
      stateKey: 'focus_stacks',
      name: '专注层数',
      stateType: 'COUNTER',
      scope: 'SKILL',
      description: null,
      sortOrder: 10,
      detail: { initialValue: formulaValue("zero"), maxValue: formulaValue("focus_max_stacks") },
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    mock.skillProcesses = [{
      gameId: GAME_ID,
      skillKey: 'varus_w',
      processKey: 'primary_cast',
      name: '主要施放过程',
      activationType: 'ACTIVE',
      description: null,
      sortOrder: 10,
      cooldown: null,
      steps: [{
        stepKey: 'hit',
        name: '命中',
        stepType: 'IMMEDIATE',
        description: null,
        sortOrder: 0,
        detail: {}
      }],
      effectBindings: [{
        bindingKey: 'hit_results',
        effectKey: 'on_hit_results',
        moment: { momentType: 'STEP_EXECUTION', stepKey: 'hit' },
        sortOrder: 0
      }],
      stateOperations: [],
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
    await expect(shell.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await expect(shell.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(1);

    await shell.getByRole('tab', { name: '内部状态' }).click();
    await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
    const createState = visibleModal(page, '新增内部状态');
    await expect(createState.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await expect(createState.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(0);
    await createState.getByRole('button', { name: '取消', exact: true }).click();

    await shell.locator('tr', { hasText: 'focus_stacks' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editState = visibleModal(page, '编辑内部状态');
    await expect(editState.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(1);
    await closeEditorByOutsideOrEscape(page, testInfo);

    await shell.locator('tr', { hasText: 'focus_stacks' }).getByRole('button', { name: '查看', exact: true }).click();
    const viewState = visibleModal(page, '查看内部状态');
    await expect(viewState.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(0);
    await expect(viewState.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(0);
    await closeEditorByOutsideOrEscape(page, testInfo);

    await shell.getByRole('tab', { name: '技能过程' }).click();
    await shell.locator('tr', { hasText: 'primary_cast' }).getByRole('button', { name: '查看', exact: true }).click();
    const viewProcess = visibleModal(page, '查看过程');
    await expect(viewProcess.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(0);
    await expect(viewProcess.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(0);

    await viewProcess.locator('section').filter({ hasText: '过程步骤' }).locator('tr', { hasText: '命中' }).getByRole('button', { name: '查看', exact: true }).click();
    const viewStep = visibleModal(page, '查看步骤');
    await expect(viewStep.getByRole('button', { name: '参数与公式', exact: true })).toHaveCount(0);
    await closeEditorByOutsideOrEscape(page, testInfo);

    await viewProcess.locator('section').filter({ hasText: '效果挂接' }).locator('tr', { hasText: 'hit_results' }).getByRole('button', { name: '查看', exact: true }).click();
    const viewBinding = visibleModal(page, '查看效果挂接');
    await expect(viewBinding.getByRole('button', { name: '效果与结果', exact: true })).toHaveCount(0);
    await closeEditorByOutsideOrEscape(page, testInfo);
    diagnostics.assertClean('catalog entries hidden in view mode');
  });

  test('opens condition and trigger management from the skill row without a new route', async ({ page }, testInfo) => {
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const row = skillRow(page, 'varus_w');
    await expect(row.getByRole('button', { name: '条件与触发', exact: true })).toHaveCount(1);
    expect(await page.locator('a[href="#/skill-triggers"]').count()).toBe(0);
    expect(await page.locator('a[href="#/triggers"]').count()).toBe(0);
    expect(await page.locator('a[href="#/condition-triggers"]').count()).toBe(0);

    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await expect(shell.getByText('当前技能还没有条件与触发规则', { exact: true })).toBeVisible();

    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await expect(createModal.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(createModal).toBeHidden();
    await expect(shell).toBeVisible();

    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const dirtyModal = visibleModal(page, '新增规则');
    await dirtyModal.getByLabel('规则名称', { exact: true }).fill('未保存规则');
    await dirtyModal.getByRole('button', { name: '取消', exact: true }).click();
    const leaveConfirm = page.getByRole('dialog').filter({ hasText: '当前修改尚未保存，确定要离开吗？' });
    await expect(leaveConfirm).toBeVisible();
    await leaveConfirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dirtyModal).toBeVisible();
    await expect(dirtyModal.getByLabel('规则名称', { exact: true })).toHaveValue('未保存规则');
    await dirtyModal.getByRole('button', { name: '取消', exact: true }).click();
    await leaveConfirm.getByRole('button', { name: '确定', exact: true }).click();
    await expect(dirtyModal).toBeHidden();
    await expect(shell).toBeVisible();
    diagnostics.assertClean('condition and trigger entry empty state and close');
  });

  test('configures hit-link and attack-link events with nullable source skills', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await createModal.getByLabel('规则标识', { exact: true }).fill('on_hit_link');
    await createModal.getByLabel('规则名称', { exact: true }).fill('应用命中联动');
    await chooseTriggerEventType(page, createModal, '应用命中联动');
    await expect(createModal.getByText('事件序号和值将在阶段 7.6.5 开放；当前没有可用事件值。')).toHaveCount(0);
    await expect(createModal.getByLabel('联动来源技能', { exact: true })).toBeVisible();
    await expect(createModal.getByLabel('事件来源对象', { exact: true })).toHaveCount(0);
    await expect(createModal.getByLabel('联动来源技能', { exact: true })).toContainText('任意技能');
    await chooseSelectOption(page, createModal, '联动来源技能', '枯萎箭袋（varus_w）');
    await expect(createModal.getByLabel('联动来源技能', { exact: true })).toContainText('枯萎箭袋（varus_w）');

    await createModal.getByRole('button', { name: '新增条件组', exact: true }).click();
    await createModal.getByLabel('条件组名称', { exact: true }).fill('联动次数');
    await createModal.locator('.arco-card').filter({ hasText: '联动次数' })
      .getByRole('button', { name: '编辑', exact: true }).click();
    const conditionModal = visibleModal(page, '编辑条件');
    await chooseSelectOption(page, conditionModal, '条件种类', '事件值比较');
    await conditionModal.getByLabel('事件值', { exact: true }).click();
    await expect(page.getByRole('option', { name: '本次序号（从 1 开始）', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '总次数（从 1 开始）', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '当前命中序号', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '总次数（从 1 开始）', exact: true }).click();
    await conditionModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(conditionModal).toBeHidden();

    await chooseTriggerEventType(page, createModal, '触发攻击联动');
    await expect(createModal.getByText('事件序号和值将在阶段 7.6.5 开放；当前没有可用事件值。')).toHaveCount(0);
    await expect(createModal.getByLabel('联动来源技能', { exact: true })).toContainText('任意技能');
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    const leaveConfirm = page.getByRole('dialog').filter({ hasText: '当前修改尚未保存，确定要离开吗？' });
    await expect(leaveConfirm).toBeVisible();
    await leaveConfirm.getByRole('button', { name: '确定', exact: true }).click();
    await expect(createModal).toBeHidden();
    diagnostics.assertClean('hit-link and attack-link events');
  });

  test('creates a spell shield, configures a block scope and saves the blocked event', async ({ page }) => {
    test.setTimeout(120_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const effectShell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await effectShell.getByRole('button', { name: '新增效果', exact: true }).click();
    const shieldEffectModal = visibleModal(page, '新增效果');
    await shieldEffectModal.getByLabel('效果标识', { exact: true }).fill('spell_shield_effect');
    await shieldEffectModal.getByLabel('效果名称', { exact: true }).fill('法术护盾效果');
    await shieldEffectModal.getByLabel('生命周期', { exact: true }).click();
    await chooseSelectOption(page, shieldEffectModal, '最大层数取值', '一层');
    await chooseSelectOption(page, shieldEffectModal, '每次施加层数取值', '一层');
    await chooseSelectOption(page, shieldEffectModal, '实例范围', '当前技能');
    await chooseSelectOption(page, shieldEffectModal, '重复层数', '保留层数');
    await shieldEffectModal.getByRole('button', { name: '新增结果', exact: true }).click();
    const shieldResultModal = visibleModal(page, '新增结果');
    await shieldResultModal.getByLabel('结果标识', { exact: true }).fill('spell_shield');
    await shieldResultModal.getByLabel('结果名称', { exact: true }).fill('法术护盾');
    await chooseSelectOption(page, shieldResultModal, '结果种类', '法术护盾');
    await expect(shieldResultModal.getByLabel('数值', { exact: true })).toHaveCount(0);
    await expect(shieldResultModal.getByLabel('法术护盾阻挡粒度', { exact: true })).toHaveCount(0);
    await expect(shieldResultModal.getByLabel('生命周期时点', { exact: true })).toContainText('持续生效');
    await saveOpenModal(shieldResultModal);
    await shieldEffectModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(shieldEffectModal).toBeHidden();

    await effectShell.locator('tr', { hasText: 'on_hit_results' })
      .getByRole('button', { name: '编辑', exact: true }).click();
    const damageEffectModal = visibleModal(page, '编辑效果');
    await damageEffectModal.locator('tr', { hasText: 'damage' })
      .getByRole('button', { name: '编辑', exact: true }).click();
    const damageResultModal = visibleModal(page, '编辑结果');
    await chooseSelectOption(page, damageResultModal, '法术护盾阻挡粒度', '当前效果');
    await saveOpenModal(damageResultModal);
    await damageEffectModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(damageEffectModal).toBeHidden();
    await closeVisibleDialog(effectShell);

    const triggerShell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await triggerShell.getByRole('button', { name: '新增规则', exact: true }).click();
    const ruleModal = visibleModal(page, '新增规则');
    await ruleModal.getByLabel('规则标识', { exact: true }).fill('after_spell_shield_block');
    await ruleModal.getByLabel('规则名称', { exact: true }).fill('法术护盾阻挡后');
    await chooseTriggerEventType(page, ruleModal, '法术护盾成功阻挡');
    await ruleModal.getByRole('button', { name: '新增条件组', exact: true }).click();
    await ruleModal.getByLabel('条件组名称', { exact: true }).fill('护盾条件');
    await ruleModal.locator('.arco-card').filter({ hasText: '护盾条件' })
      .getByRole('button', { name: '编辑', exact: true }).click();
    const shieldCondition = visibleModal(page, '编辑条件');
    await shieldCondition.getByLabel('条件种类', { exact: true }).click();
    await expect(page.getByRole('option', { name: '事件值比较', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await shieldCondition.getByRole('button', { name: '取消', exact: true }).click();
    await expect(shieldCondition).toBeHidden();
    await ruleModal.locator('.arco-card').filter({ hasText: '护盾条件' })
      .getByRole('button', { name: '删除', exact: true }).first().click();
    await expect(ruleModal.getByLabel('条件组名称', { exact: true })).toHaveCount(0);
    const shieldEffectSelect = ruleModal.getByLabel('法术护盾效果', { exact: true });
    await expect(shieldEffectSelect).toBeEnabled();
    await shieldEffectSelect.click();
    await expect(page.getByRole('option', { name: '法术护盾效果', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '专注标记', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '法术护盾效果', exact: true }).click();
    await ruleModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '阻挡后执行',
      effectName: '法力消耗'
    });
    await ruleModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(ruleModal).toBeHidden();

    expect(mock.skillTriggerRules.at(-1)?.eventSource).toEqual({
      eventType: 'SPELL_SHIELD_BLOCKED',
      detail: { shieldEffectKey: 'spell_shield_effect' }
    });
    const createdShield = mock.skillEffects.find((item) => item.effectKey === 'spell_shield_effect');
    expect(createdShield?.results[0]).toMatchObject({
      resultType: 'SPELL_SHIELD',
      spellShieldBlockScope: null,
      valueRule: null,
      detail: {},
      lifecycleBehavior: { moment: 'PERSISTENT' }
    });
    expect(mock.skillEffects.find((item) => item.effectKey === 'on_hit_results')?.results[0])
      .toMatchObject({ spellShieldBlockScope: 'EFFECT' });
    diagnostics.assertClean('spell shield authoring and blocked event');
  });

  test('creates a low-health condition and trigger rule, blocks duplicate save, then deletes it', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await expect(createModal.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await createModal.getByLabel('规则标识', { exact: true }).fill('low_health_shield');
    await createModal.getByLabel('规则名称', { exact: true }).fill('低生命护盾');
    await chooseTriggerEventType(page, createModal, '指定对象生命属性越过阈值');
    await chooseSelectOption(page, createModal, '生命阈值对象', '来源对象');
    await chooseSelectOption(page, createModal, '生命阈值属性', '生命值');
    await chooseSelectOption(page, createModal, '阈值取值', '低生命阈值');
    await chooseSelectOption(page, createModal, '生命阈值方向', '向下');
    await createModal.getByRole('switch', { name: '每目标冷却', exact: true }).click();
    await chooseSelectOption(page, createModal, '每目标冷却取值', '冷却时长');

    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '施加护盾',
      effectName: '低生命护盾'
    });
    await expect(createModal.getByText('1. 施加护盾')).toBeVisible();

    const hold = createDeferred();
    mock.triggerRuleWriteHold = hold.promise;
    const saveButton = createModal.getByRole('button', { name: '保存', exact: true });
    await saveButton.click();
    await expect(saveButton).toHaveClass(/arco-btn-loading/);
    await expect(saveButton).toBeDisabled();
    await saveButton.click({ force: true });
    hold.resolve();
    mock.triggerRuleWriteHold = null;
    await expect(createModal).toBeHidden();
    await expect(shell.getByText('规则「低生命护盾」已保存。', { exact: true })).toBeVisible();
    await expect(shell.locator('tr', { hasText: 'low_health_shield' })).toBeVisible();
    expect(mock.writes.filter((item) => item.method === 'POST' && item.path.endsWith('/trigger-rules'))).toHaveLength(1);

    const created = mock.skillTriggerRules[0];
    expect(created?.eventSource).toMatchObject({
      eventType: 'HEALTH_THRESHOLD_CROSSED',
      detail: {
        subject: 'SOURCE',
        attributeKey: 'hp',
        thresholdValue: formulaValue("hp_threshold"),
        direction: 'DOWNWARD'
      }
    });
    expect(created?.perTargetCooldown).toMatchObject({
      durationValue: formulaValue("cooldown_ms"),
      targetContext: 'CURRENT_TARGET'
    });
    expect(created?.actions[0]).toMatchObject({
      name: '施加护盾',
      actionType: 'EXECUTE_EFFECT',
      detail: { effectKey: 'shield_effect' }
    });

    await shell.locator('tr', { hasText: 'low_health_shield' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑规则');
    await expect(editModal.getByLabel('规则标识', { exact: true })).toBeDisabled();
    await expect(editModal.getByLabel('规则标识', { exact: true })).toHaveValue('low_health_shield');
    await expect(editModal.getByLabel('规则名称', { exact: true })).toHaveValue('低生命护盾');
    await expect(editModal.getByLabel('事件类型', { exact: true })).toContainText('指定对象生命属性越过阈值');
    await expect(editModal.getByLabel('生命阈值对象', { exact: true })).toContainText('来源对象');
    await expect(editModal.getByLabel('生命阈值属性', { exact: true })).toContainText('生命值');
    await expect(editModal.getByLabel('阈值取值', { exact: true })).toContainText('低生命阈值');
    await expect(editModal.getByLabel('生命阈值方向', { exact: true })).toContainText('向下');
    await expect(editModal.getByRole('switch', { name: '每目标冷却', exact: true })).toBeChecked();
    await expect(editModal.getByText('1. 施加护盾')).toBeVisible();
    await expect(editModal.getByText('执行效果', { exact: true })).toBeVisible();
    await editModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editModal).toBeHidden();

    await shell.locator('tr', { hasText: 'low_health_shield' }).getByRole('button', { name: '删除', exact: true }).click();
    const deleteModal = visibleModal(page, '删除规则');
    await expect(deleteModal.getByText('确定删除规则「低生命护盾」吗？', { exact: true })).toBeVisible();
    await deleteModal.getByRole('button', { name: '删除', exact: true }).click();
    await expect(deleteModal).toBeHidden();
    await expect(shell.locator('tr', { hasText: 'low_health_shield' })).toHaveCount(0);
    await expect(shell.getByText('当前技能还没有条件与触发规则', { exact: true })).toBeVisible();
    expect(mock.skillTriggerRules).toHaveLength(0);
    diagnostics.assertClean('condition and trigger low-health round-trip');
  });

  for (const sourceKind of ['FORMULA', 'PARAMETER'] as const) test('binds a later condition and trigger execute-effect action to the earlier configured-value result (' + sourceKind + ')', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    if (sourceKind === 'PARAMETER') {
      const result = mock.skillEffects.find((item) => item.effectKey === 'follow_up_hit')!.results[0];
      result.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'prior_hit_value' };
    }
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await expect(createModal.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await createModal.getByLabel('规则标识', { exact: true }).fill('follow_up_from_hit');
    await createModal.getByLabel('规则名称', { exact: true }).fill('命中后追加');

    await chooseTriggerEventType(page, createModal, '当前技能生命周期到达离散时点');
    await chooseSelectOption(page, createModal, '生命周期事件效果', '专注标记');
    await createModal.getByLabel('生命周期时点', { exact: true }).click();
    await expect(page.getByRole('option', { name: '施加', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '满层', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '周期', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '自然结束', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '提前移除', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '持续生效', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'PERSISTENT', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '满层', exact: true }).click();

    await chooseTriggerEventType(page, createModal, '当前技能内部状态发生固定变化');
    await chooseSelectOption(page, createModal, '内部状态变化状态', '专注层数');
    await createModal.getByLabel('内部状态变化种类', { exact: true }).click();
    await expect(page.getByRole('option', { name: '数值变化', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '持续生效', exact: true })).toHaveCount(0);
    for (const term of ['防御后伤害', '护盾吸收', '实际扣血', '实际治疗', '阻挡', '免疫']) {
      await expect(page.getByRole('option', { name: term, exact: true })).toHaveCount(0);
    }
    await page.keyboard.press('Escape');

    await chooseTriggerEventType(page, createModal, '技能命中');

    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '命中伤害',
      effectName: '命中结果'
    });
    await expect(createModal.getByText('1. 命中伤害')).toBeVisible();

    await createModal.getByRole('button', { name: '新增动作', exact: true }).click();
    const secondAction = visibleModal(page, '新增动作');
    await secondAction.getByLabel('动作标识', { exact: true }).fill('apply_follow_up');
    await secondAction.getByLabel('动作名称', { exact: true }).fill('追加伤害');
    await chooseSelectOption(page, secondAction, '目标效果', '追加伤害');
    await expect(secondAction.getByText('绑定与可达参数不一致。', { exact: true })).toBeVisible();
    await secondAction.getByRole('button', { name: '新增绑定', exact: true }).click();
    const bindingModal = visibleModal(page, '新增绑定');
    await bindingModal.getByLabel('绑定标识', { exact: true }).fill('bind_prior_hit');
    await chooseSelectOption(page, bindingModal, '绑定参数', '前序命中值（prior_hit_value / 小数）');
    await chooseSelectOption(page, bindingModal, '来源种类', '更早动作结果');
    await chooseSelectOption(page, bindingModal, '来源动作', '命中伤害（action_1）');
    await chooseSelectOption(page, bindingModal, '来源结果', '造成物理伤害（damage）');
    await expect(bindingModal.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
    await bindingModal.getByLabel('结果输出', { exact: true }).click();
    await expect(page.getByRole('option', { name: '基础配置值', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '原始伤害', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '防御后伤害', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '护盾吸收', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '实际扣血', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '是否被伤害免疫（0/1）', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '是否形成击杀（0/1）', exact: true })).toBeVisible();
    for (const term of STAGE_76_FORBIDDEN_OUTPUT_TERMS) {
      await expect(page.getByRole('option', { name: term, exact: true })).toHaveCount(0);
    }
    await page.getByRole('option', { name: '基础配置值', exact: true }).click();
    await expect(bindingModal.getByRole('button', { name: '确定', exact: true })).toBeEnabled();
    await bindingModal.getByRole('button', { name: '确定', exact: true }).click();
    await expect(bindingModal).toBeHidden();
    await expect(secondAction.getByText('更早动作结果 / action_1 / damage / 基础配置值')).toBeVisible();
    await secondAction.getByRole('button', { name: '确定', exact: true }).click();
    await expect(secondAction).toBeHidden();

    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeHidden();
    await expect(shell.locator('tr', { hasText: 'follow_up_from_hit' })).toContainText('技能命中');

    await shell.locator('tr', { hasText: 'follow_up_from_hit' }).getByRole('button', { name: '编辑', exact: true }).click();
    const editModal = visibleModal(page, '编辑规则');
    await expect(editModal.getByText('1. 命中伤害')).toBeVisible();
    await expect(editModal.getByText('2. 追加伤害')).toBeVisible();
    await expect(editModal.getByText('绑定 1')).toBeVisible();
    await editModal.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
    const editSecond = visibleModal(page, '编辑动作');
    await expect(editSecond.getByText('更早动作结果 / action_1 / damage / 基础配置值')).toBeVisible();
    await editSecond.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editSecond).toBeHidden();
    await editModal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editModal).toBeHidden();
    diagnostics.assertClean('condition and trigger prior-result binding');
  });

  test('keeps the condition and trigger draft open for an unguarded cycle error', async ({ page }) => {
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await expect(createModal.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await createModal.getByLabel('规则标识', { exact: true }).fill('low_health_shield');
    await createModal.getByLabel('规则名称', { exact: true }).fill('低生命护盾');
    await chooseTriggerEventType(page, createModal, '指定对象生命属性越过阈值');
    await chooseSelectOption(page, createModal, '生命阈值属性', '生命值');
    await chooseSelectOption(page, createModal, '阈值取值', '低生命阈值');
    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '施加护盾',
      effectName: '低生命护盾'
    });
    await expect(createModal.getByText('1. 施加护盾')).toBeVisible();

    mock.triggerRuleWriteFailure = 'unprotected-cycle';
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByLabel('规则名称', { exact: true })).toHaveValue('低生命护盾');
    await expect(createModal.getByText(/当前关系形成没有保护的循环：/)).toBeVisible();
    await expect(createModal.getByText(/unknown_rule/)).toBeVisible();
    await expect(createModal.getByText('可增加每目标冷却、单次过程最大触发次数或调整关系。')).toBeVisible();
    await expect(createModal.getByText('400.TRIGGER_RULE_CYCLE_UNGUARDED')).toBeVisible();
    expect(mock.skillTriggerRules).toHaveLength(0);
    diagnostics.assertClean('condition and trigger unguarded cycle');
  });

  test('exposes dealt-damage event values including kill and actual HP loss', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await createModal.getByLabel('规则标识', { exact: true }).fill('on_damage_dealt');
    await createModal.getByLabel('规则名称', { exact: true }).fill('造成伤害后');
    await chooseTriggerEventType(page, createModal, '来源对象造成伤害');
    await createModal.getByRole('button', { name: '新增条件组', exact: true }).click();
    await createModal.getByLabel('条件组名称', { exact: true }).fill('击杀条件');
    await createModal.locator('.arco-card').filter({ hasText: '击杀条件' })
      .getByRole('button', { name: '编辑', exact: true }).click();
    const conditionModal = visibleModal(page, '编辑条件');
    await chooseSelectOption(page, conditionModal, '条件种类', '事件值比较');
    await conditionModal.getByLabel('事件值', { exact: true }).click();
    await expect(page.getByRole('option', { name: '护盾吸收', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '实际扣血', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /是否形成击杀/ })).toBeVisible();
    await expect(page.getByRole('option', { name: '受伤前生命', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: /是否形成击杀/ }).click();
    await conditionModal.getByRole('button', { name: '取消', exact: true }).click();
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    const leaveConfirm = page.getByRole('dialog').filter({ hasText: '当前修改尚未保存，确定要离开吗？' });
    await leaveConfirm.getByRole('button', { name: '确定', exact: true }).click();
    diagnostics.assertClean('damage-dealt event values');
  });

  test('persists action moves and numeric sort edits when editing an existing trigger rule', async ({ page }) => {
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    mock.skillTriggerRules = [{
      gameId: GAME_ID, skillKey: 'varus_w', ruleKey: 'existing_order', name: '已有规则顺序',
      description: null, sortOrder: 0,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
      conditionGroups: [], perTargetCooldown: null, maxTriggersPerProcess: null,
      actions: [
        { actionKey: 'apply_damage', name: '造成伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { effectKey: 'on_hit_results' }, runtimeInputBindings: [], resultModifiers: [] },
        { actionKey: 'start_cast', name: '启动过程', actionType: 'START_PROCESS', sortOrder: 20,
          targetContext: 'CURRENT_TARGET', detail: { processKey: 'primary_cast' }, runtimeInputBindings: [], resultModifiers: [] }
      ],
      createdAt: CREATED_AT, updatedAt: UPDATED_AT
    }];
    const diagnostics = await prepare(page, mock);
    let detailReads = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/trigger-rules/existing_order')) detailReads += 1;
    });
    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.locator('tr', { hasText: 'existing_order' }).getByRole('button', { name: '编辑', exact: true }).click();
    let editor = visibleModal(page, '编辑规则');
    await expect(editor.getByText('1. 造成伤害', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '下移', exact: true }).first().click();
    await expect(editor.getByText('1. 启动过程', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toBeHidden();
    expect(detailReads).toBe(1);
    expect(mock.skillTriggerRules[0]!.actions.map((action) => [action.actionKey, action.sortOrder]))
      .toEqual([['start_cast', 10], ['apply_damage', 20]]);

    await shell.locator('tr', { hasText: 'existing_order' }).getByRole('button', { name: '编辑', exact: true }).click();
    editor = visibleModal(page, '编辑规则');
    await expect(editor.getByText('1. 启动过程', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '编辑', exact: true }).first().click();
    const actionEditor = visibleModal(page, '编辑动作');
    await actionEditor.getByLabel('动作排序', { exact: true }).fill('30');
    await actionEditor.getByRole('button', { name: '确定', exact: true }).click();
    await expect(actionEditor).toBeHidden();
    await expect(editor.getByText('1. 造成伤害', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toBeHidden();
    expect(detailReads).toBe(2);
    expect(mock.skillTriggerRules[0]!.actions.map((action) => [action.actionKey, action.sortOrder]))
      .toEqual([['apply_damage', 20], ['start_cast', 30]]);

    await shell.locator('tr', { hasText: 'existing_order' }).getByRole('button', { name: '编辑', exact: true }).click();
    editor = visibleModal(page, '编辑规则');
    await expect(editor.getByText('1. 造成伤害', { exact: true })).toBeVisible();
    await expect(editor.getByText('2. 启动过程', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).toBeHidden();
    diagnostics.assertClean('existing trigger action order persists without dirty-state reloads');
  });

  test('confirms stale prior-result cleanup after reordering actions and can cancel', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await createModal.getByLabel('规则标识', { exact: true }).fill('reorder_prior');
    await createModal.getByLabel('规则名称', { exact: true }).fill('重排前序');
    await chooseTriggerEventType(page, createModal, '技能命中');
    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '命中伤害',
      effectName: '命中结果'
    });
    await createModal.getByRole('button', { name: '新增动作', exact: true }).click();
    const secondAction = visibleModal(page, '新增动作');
    await secondAction.getByLabel('动作标识', { exact: true }).fill('apply_follow_up');
    await secondAction.getByLabel('动作名称', { exact: true }).fill('追加伤害');
    await secondAction.getByLabel('动作排序', { exact: true }).fill('20');
    await chooseSelectOption(page, secondAction, '目标效果', '追加伤害');
    await secondAction.getByRole('button', { name: '新增绑定', exact: true }).click();
    const bindingModal = visibleModal(page, '新增绑定');
    await bindingModal.getByLabel('绑定标识', { exact: true }).fill('bind_prior_hit');
    await chooseSelectOption(page, bindingModal, '绑定参数', '前序命中值（prior_hit_value / 小数）');
    await bindPriorActionResult(page, bindingModal, {
      sourceAction: '命中伤害（action_1）',
      sourceResult: '造成物理伤害（damage）',
      output: '基础配置值'
    });
    await bindingModal.getByRole('button', { name: '确定', exact: true }).click();
    await secondAction.getByRole('button', { name: '确定', exact: true }).click();
    await expect(createModal.getByText('1. 命中伤害')).toBeVisible();
    await expect(createModal.getByText('2. 追加伤害')).toBeVisible();

    await createModal.getByRole('button', { name: '下移', exact: true }).first().click();
    const staleConfirm = page.getByRole('dialog').filter({ hasText: '将删除失效绑定' });
    await expect(staleConfirm).toBeVisible();
    await staleConfirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(createModal.getByText('1. 命中伤害')).toBeVisible();
    await expect(createModal.getByText('2. 追加伤害')).toBeVisible();

    await createModal.getByRole('button', { name: '下移', exact: true }).first().click();
    await expect(staleConfirm).toBeVisible();
    await staleConfirm.getByRole('button', { name: '确定', exact: true }).click();
    await expect(createModal.getByText('1. 追加伤害')).toBeVisible();
    await expect(createModal.getByText('2. 命中伤害')).toBeVisible();
    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    const editFollowUp = visibleModal(page, '编辑动作');
    await expect(editFollowUp.getByText('更早动作结果 / action_1 / damage / 基础配置值')).toHaveCount(0);
    await editFollowUp.getByRole('button', { name: '取消', exact: true }).click();
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    const leaveConfirm = page.getByRole('dialog').filter({ hasText: '当前修改尚未保存，确定要离开吗？' });
    await leaveConfirm.getByRole('button', { name: '确定', exact: true }).click();
    diagnostics.assertClean('prior-result reorder cleanup');
  });

  test('retries source-effect loading without dropping the prior-result draft', async ({ page }) => {
    test.setTimeout(90_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    mock.skillEffectGetFailureKeys.add('on_hit_results');
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await createModal.getByLabel('规则标识', { exact: true }).fill('retry_prior');
    await createModal.getByLabel('规则名称', { exact: true }).fill('重试前序');
    await chooseTriggerEventType(page, createModal, '技能命中');
    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '命中伤害',
      effectName: '命中结果'
    });
    await createModal.getByRole('button', { name: '新增动作', exact: true }).click();
    const secondAction = visibleModal(page, '新增动作');
    await secondAction.getByLabel('动作标识', { exact: true }).fill('apply_follow_up');
    await secondAction.getByLabel('动作名称', { exact: true }).fill('追加伤害');
    await chooseSelectOption(page, secondAction, '目标效果', '追加伤害');
    await secondAction.getByRole('button', { name: '新增绑定', exact: true }).click();
    const bindingModal = visibleModal(page, '新增绑定');
    await bindingModal.getByLabel('绑定标识', { exact: true }).fill('bind_prior_hit');
    await chooseSelectOption(page, bindingModal, '绑定参数', '前序命中值（prior_hit_value / 小数）');
    await chooseSelectOption(page, bindingModal, '来源种类', '更早动作结果');
    await chooseSelectOption(page, bindingModal, '来源动作', '命中伤害（action_1）');
    await expect(bindingModal.getByText('来源效果详情未加载，无法校验前序结果。请重试。')).toBeVisible();
    await expect(bindingModal.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
    mock.skillEffectGetFailureKeys.clear();
    await bindingModal.getByRole('button', { name: '重试', exact: true }).click();
    await expect(bindingModal.getByText('来源效果详情未加载，无法校验前序结果。请重试。')).toHaveCount(0);
    await chooseSelectOption(page, bindingModal, '来源结果', '造成物理伤害（damage）');
    await chooseSelectOption(page, bindingModal, '结果输出', '基础配置值');
    await bindingModal.getByRole('button', { name: '确定', exact: true }).click();
    await expect(secondAction.getByText('更早动作结果 / action_1 / damage / 基础配置值')).toBeVisible();
    await secondAction.getByRole('button', { name: '取消', exact: true }).click();
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    const leaveConfirm = page.getByRole('dialog').filter({ hasText: '当前修改尚未保存，确定要离开吗？' });
    await leaveConfirm.getByRole('button', { name: '确定', exact: true }).click();
    diagnostics.assertClean('prior-result source-effect retry');
  });

  test('keeps trigger and effect drafts after 400 binding and 409 shape occupancy errors', async ({ page }) => {
    test.setTimeout(120_000);
    const mock = new MockApi();
    seedSkillTriggerCatalog(mock);
    const diagnostics = await prepare(page, mock);

    await openSkills(page);
    const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
    await shell.getByRole('button', { name: '新增规则', exact: true }).click();
    const createModal = visibleModal(page, '新增规则');
    await createModal.getByLabel('规则标识', { exact: true }).fill('invalid_prior');
    await createModal.getByLabel('规则名称', { exact: true }).fill('非法前序');
    await chooseTriggerEventType(page, createModal, '技能命中');
    await createModal.getByRole('button', { name: '编辑', exact: true }).first().click();
    await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), {
      name: '命中伤害',
      effectName: '命中结果'
    });
    await createModal.getByRole('button', { name: '新增动作', exact: true }).click();
    const secondAction = visibleModal(page, '新增动作');
    await secondAction.getByLabel('动作标识', { exact: true }).fill('apply_follow_up');
    await secondAction.getByLabel('动作名称', { exact: true }).fill('追加伤害');
    await chooseSelectOption(page, secondAction, '目标效果', '追加伤害');
    await secondAction.getByRole('button', { name: '新增绑定', exact: true }).click();
    const bindingModal = visibleModal(page, '新增绑定');
    await bindingModal.getByLabel('绑定标识', { exact: true }).fill('bind_prior_hit');
    await chooseSelectOption(page, bindingModal, '绑定参数', '前序命中值（prior_hit_value / 小数）');
    await bindPriorActionResult(page, bindingModal, {
      sourceAction: '命中伤害（action_1）',
      sourceResult: '造成物理伤害（damage）',
      output: '基础配置值'
    });
    await bindingModal.getByRole('button', { name: '确定', exact: true }).click();
    await secondAction.getByRole('button', { name: '确定', exact: true }).click();

    mock.triggerRuleWriteFailure = 'invalid-binding';
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(createModal).toBeVisible();
    await expect(createModal.getByLabel('规则名称', { exact: true })).toHaveValue('非法前序');
    await expect(createModal.getByText('当前结果不提供该输出')).toBeVisible();
    expect(mock.skillTriggerRules).toHaveLength(0);
    await createModal.getByRole('button', { name: '取消', exact: true }).click();
    const leaveConfirm = page.getByRole('dialog').filter({ hasText: '当前修改尚未保存，确定要离开吗？' });
    await leaveConfirm.getByRole('button', { name: '确定', exact: true }).click();
    await closeVisibleDialog(shell);

    const effectShell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
    await effectShell.locator('tr', { hasText: 'on_hit_results' })
      .getByRole('button', { name: '编辑', exact: true }).click();
    const effectModal = visibleModal(page, '编辑效果');
    mock.effectWriteFailure = 'shape-in-use';
    await effectModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(effectModal).toBeVisible();
    await expect(effectModal.getByLabel('效果名称', { exact: true })).toHaveValue('命中结果');
    await expect(effectModal.getByText('该结构仍被条件与触发规则使用')).toBeVisible();
    await expect(effectModal.getByText('请先调整条件与触发规则再保存效果。')).toBeVisible();
    await expect(effectModal.getByText('follow_up_from_hit / apply_follow_up / bind_prior_hit / 实际治疗')).toBeVisible();
    await effectModal.getByRole('button', { name: '取消', exact: true }).click();
    diagnostics.assertClean('400 binding and 409 shape occupancy drafts');
  });
});

test.describe('image management without Wasm', () => {
  test('reads the image list from local cache and fills it through full sync', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openImages(page);

    await expect(page.locator('.page-images .panel-title')).toHaveText(['本地缓存工具', '图片管理']);
    await expect(page.getByText('本地缓存暂无图片，请先全量同步', { exact: true })).toBeVisible();
    expect(mock.imageAdminListRequests).toBe(0);

    const cachedUpload = await pngUpload(page, 32, 20, 'cached.png');
    mock.images = [{
      gameId: GAME_ID,
      imageKey: 'cached_icon',
      name: '已同步图片',
      description: null,
      imageBase64: `data:image/png;base64,${cachedUpload.buffer.toString('base64')}`,
      mimeType: 'image/png',
      byteSize: cachedUpload.buffer.length,
      width: 32,
      height: 20,
      enabled: true,
      createdAt: '2026-09-05T12:00:00.000Z',
      updatedAt: '2026-09-05T12:00:00.000Z'
    }];

    await page.getByRole('button', { name: '全量同步', exact: true }).click();
    await expect(page.getByText('全量同步完成，本次接收 1 条变化。', { exact: true })).toBeVisible();
    await expect(imageRow(page, 'cached_icon')).toBeVisible();
    expect(mock.imageAdminListRequests).toBe(0);

    await page.reload();
    await waitForGame(page);
    await expect(imageRow(page, 'cached_icon')).toBeVisible();
    expect(mock.imageAdminListRequests).toBe(0);
    diagnostics.assertClean('image cache list');
  });

  test('creates, edits, replaces, filters, disables, syncs and retains failed drafts', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openImages(page);
    await expect(page.getByText('本地缓存暂无图片，请先全量同步', { exact: true })).toBeVisible();
    expect(mock.imageAdminListRequests).toBe(0);

    await page.getByRole('button', { name: '新建图片', exact: true }).click();
    let modal = visibleModal(page, '新建图片');
    await modal.getByLabel('图片标识', { exact: true }).fill('hero_icon');
    await modal.getByLabel('图片名称', { exact: true }).fill('英雄头像');
    await modal.getByLabel('图片说明', { exact: true }).fill('初始说明');
    await modal.getByLabel('选择图片文件', { exact: true }).setInputFiles(await pngUpload(page, 160, 96));
    await expect(modal.getByText(/原图 160 × 96；已在浏览器处理为 PNG，64 × 64/)).toBeVisible();
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('图片“英雄头像”已保存。', { exact: true })).toBeVisible();

    let row = imageRow(page, 'hero_icon');
    await expect(row).toBeVisible();
    await expect.poll(() => row.getByRole('img', { name: 'hero_icon', exact: true }).evaluate(
      (image: HTMLImageElement) => `${image.naturalWidth} × ${image.naturalHeight}`
    )).toBe('64 × 64');
    const createWrite = mock.writes.find((write) => write.method === 'POST' && write.path.endsWith('/images'))!;
    const createBytes = Buffer.from(String(createWrite.body.imageBase64).split(',')[1]!, 'base64');
    expect(createBytes.readUInt32BE(16)).toBe(64);
    expect(createBytes.readUInt32BE(20)).toBe(64);

    await row.getByRole('button', { name: '编辑', exact: true }).click();
    modal = visibleModal(page, '编辑图片');
    await modal.getByLabel('图片说明', { exact: true }).fill('编辑后的说明');
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('图片“英雄头像”已保存。', { exact: true })).toBeVisible();
    const metadataWrite = mock.writes.filter((write) => write.method === 'PUT').at(-1)!;
    expect(metadataWrite.body).not.toHaveProperty('imageBase64');

    row = imageRow(page, 'hero_icon');
    await row.getByRole('button', { name: '替换图片', exact: true }).click();
    modal = visibleModal(page, '编辑图片');
    const smallUpload = await pngUpload(page, 32, 20, 'small.png');
    await modal.getByLabel('选择图片文件', { exact: true }).setInputFiles(smallUpload);
    await expect(modal.getByText(/小图保持原内容：PNG，32 × 20/)).toBeVisible();
    await expect(modal.getByText('将替换图片内容', { exact: false })).toBeVisible();
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    row = imageRow(page, 'hero_icon');
    await expect.poll(() => row.getByRole('img', { name: 'hero_icon', exact: true }).evaluate(
      (image: HTMLImageElement) => `${image.naturalWidth} × ${image.naturalHeight}`
    )).toBe('32 × 20');
    const replacementWrite = mock.writes.filter((write) => write.method === 'PUT').at(-1)!;
    expect(Buffer.from(String(replacementWrite.body.imageBase64).split(',')[1]!, 'base64')).toEqual(smallUpload.buffer);

    await page.getByLabel('图片标识关键词', { exact: true }).fill('hero');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(imageRow(page, 'hero_icon')).toBeVisible();
    await page.getByLabel('图片标识关键词', { exact: true }).fill('missing');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByText('本地缓存中没有符合筛选条件的图片', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重置', exact: true }).click();
    row = imageRow(page, 'hero_icon');

    await page.getByRole('button', { name: '全量同步', exact: true }).click();
    await expect(page.getByText('全量同步完成，本次接收 1 条变化。', { exact: true })).toBeVisible();
    await expect(page.getByText('其中可展示 1 条', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: '停用', exact: true }).click();
    const disableModal = visibleModal(page, '停用图片');
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    await expect(page.getByText('图片“英雄头像”已停用。', { exact: true })).toBeVisible();
    await expect(page.getByText('其中可展示 0 条', { exact: true })).toBeVisible();
    await page.getByLabel('图片状态筛选', { exact: true }).getByText('停用', { exact: true }).click();
    await page.getByRole('button', { name: '查询', exact: true }).click();
    row = imageRow(page, 'hero_icon');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '启用', exact: true }).click();
    await expect(page.getByText('图片“英雄头像”已启用。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '增量同步', exact: true }).click();
    await expect(page.getByText('增量同步完成，本次接收 0 条变化。', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新建图片', exact: true }).click();
    modal = visibleModal(page, '新建图片');
    await modal.getByLabel('图片标识', { exact: true }).fill('draft_icon');
    await modal.getByLabel('图片名称', { exact: true }).fill('保留草稿');
    await modal.getByLabel('选择图片文件', { exact: true }).setInputFiles(await pngUpload(page, 20, 20));
    mock.imageWriteFailure = 'validation';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText('服务端图片名称校验失败', { exact: true }).first()).toBeVisible();
    await expect(modal.getByLabel('图片标识', { exact: true })).toHaveValue('draft_icon');
    await expect(modal.getByLabel('图片名称', { exact: true })).toHaveValue('保留草稿');
    mock.imageWriteFailure = 'duplicate';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText('图片标识已存在', { exact: true }).first()).toBeVisible();
    await expect(modal.getByLabel('图片标识', { exact: true })).toHaveValue('draft_icon');
    mock.imageWriteFailure = null;

    const oversized = {
      name: 'too-large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(5_242_881)
    };
    await modal.getByLabel('选择图片文件', { exact: true }).setInputFiles(oversized);
    await expect(modal.getByText('源图片不能超过 5 MB。', { exact: true })).toBeVisible();
    const writesBeforeBlockedSave = mock.writes.length;
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    expect(mock.writes).toHaveLength(writesBeforeBlockedSave);
    await modal.getByLabel('选择图片文件', { exact: true }).setInputFiles({
      name: 'fake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a png')
    });
    await expect(modal.getByText('图片文件声明类型与真实内容不一致。', { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    expect(mock.writes).toHaveLength(writesBeforeBlockedSave);

    expect(mock.imageAdminListRequests).toBe(0);
    diagnostics.assertClean('image management');
  });
});

test.describe('attribute management without Wasm', () => {
  test('empty state, normalized query filtering and reset', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openAttributes(page);
    await expect(page.getByText('暂无属性，可以新增第一条属性')).toBeVisible();

    mock.attributes = [
      attribute('armor', '护甲', { sortOrder: 10 }),
      attribute('armor_penetration', '护甲穿透', { status: 'DISABLED', sortOrder: 20 }),
      attribute('move_speed', '移动速度', { sortOrder: 30 })
    ];
    await page.getByRole('button', { name: '刷新', exact: true }).last().click();
    await expect(attributeRow(page, 'armor')).toBeVisible();

    await page.getByLabel('关键词').fill('  armor  ');
    const statusGroup = page
      .locator('[aria-label="属性查询"]')
      .getByRole('group', { name: '状态筛选' });
    await statusGroup.getByText('停用', { exact: true }).click();
    await expect(statusGroup.getByRole('radio', { name: '停用' })).toBeChecked();
    await page.getByRole('button', { name: '查询', exact: true }).click();

    await expect(attributeRow(page, 'armor_penetration')).toBeVisible();
    await expect(attributeRow(page, 'armor')).toHaveCount(0);
    await expect.poll(() => mock.listQueries.at(-1)).toEqual({
      keyword: 'armor',
      status: 'DISABLED'
    });

    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(statusGroup.getByRole('radio', { name: '全部' })).toBeChecked();
    await expect(attributeRow(page, 'move_speed')).toBeVisible();
    await expect(page.getByText('共 3 条属性')).toBeVisible();
    diagnostics.assertClean('empty/filter/reset');
  });

  test('creates a trimmed attribute and reads it back from the refreshed list', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);

    const modal = await fillCreateDraft(page, {
      key: '  move_speed  ',
      name: '  移动速度  ',
      description: '  角色面板移动速度  '
    });
    await modal.getByLabel('最小值').fill('0');
    await modal.getByLabel('排序').fill('100');
    await modal.getByRole('button', { name: '保存', exact: true }).click();

    await expect(modal).toBeHidden();
    await expect(attributeRow(page, 'move_speed')).toContainText('移动速度');
    await expect(page.getByText('属性「移动速度」已保存。')).toBeVisible();
    expect(mock.writes.at(-1)).toEqual({
      method: 'POST',
      path: `/api/admin/games/${GAME_ID}/attributes`,
      body: {
        attributeKey: 'move_speed',
        name: '移动速度',
        valueType: 'DECIMAL',
        minValue: 0,
        maxValue: null,
        description: '角色面板移动速度',
        status: 'ENABLED',
        sortOrder: 100
      }
    });
    diagnostics.assertClean('create/readback');
  });

  test('views, edits and disables an existing attribute', async ({ page }, testInfo) => {
    const mock = new MockApi();
    mock.attributes = [attribute('move_speed', '移动速度')];
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);
    const row = attributeRow(page, 'move_speed');
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: '查看' }).click();
    const viewModal = visibleModal(page, '查看属性');
    await expect(viewModal.getByLabel('稳定标识')).toBeDisabled();
    await expect(viewModal.getByRole('button', { name: '保存' })).toHaveCount(0);
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();

    await row.getByRole('button', { name: '编辑' }).click();
    const editModal = visibleModal(page, '编辑属性');
    await expect(editModal.getByLabel('稳定标识')).toBeDisabled();
    await editModal.getByLabel('属性名称').fill('基础移动速度');
    const writesBeforeDiscard = mock.writes.length;
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(editModal).toBeHidden();
    expect(mock.writes.length).toBe(writesBeforeDiscard);
    await expect(row).toContainText('移动速度');
    await expect(row.getByText('基础移动速度')).toHaveCount(0);

    await row.getByRole('button', { name: '编辑' }).click();
    await expect(editModal).toBeVisible();
    await editModal.getByLabel('属性名称').click();
    await editModal.getByLabel('属性名称').fill('');
    await editModal.getByLabel('属性名称').pressSequentially('基础移动速度');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(attributeRow(page, 'move_speed')).toContainText('基础移动速度');

    await attributeRow(page, 'move_speed').getByRole('button', { name: '停用' }).click();
    const disableModal = visibleModal(page, '停用属性');
    await expect(disableModal.getByText('确定停用属性「基础移动速度」吗？')).toBeVisible();
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    expect(mock.writes.at(-1)?.body.status).toBe('DISABLED');
    await expect(attributeRow(page, 'move_speed').getByRole('button', { name: '启用' })).toBeVisible();

    await attributeRow(page, 'move_speed').getByRole('button', { name: '启用' }).click();
    const enableModal = visibleModal(page, '启用属性');
    mock.writeFailure = 'network';
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    await expect(enableModal.getByText(/fetch|network/i)).toBeVisible();
    await expect(enableModal).toBeVisible();
    mock.writeFailure = null;
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    expect(mock.writes.at(-1)?.body.status).toBe('ENABLED');
    await expect(attributeRow(page, 'move_speed').getByRole('button', { name: '停用' })).toBeVisible();
    diagnostics.assertClean('view/edit/disable');
  });

  test('keeps the draft for field 400, duplicate 409, 404 and network failures', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);
    const modal = await fillCreateDraft(page, {
      key: 'draft_attribute',
      name: '草稿属性'
    });

    mock.writeFailure = 'validation';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText('服务端属性名称校验失败')).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('草稿属性');

    mock.writeFailure = 'duplicate';
    await modal.getByLabel('属性名称').fill('重复草稿');
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText(/409\.ATTRIBUTE_KEY_EXISTS/)).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('重复草稿');

    mock.writeFailure = 'not-found';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText(/404\.ATTRIBUTE_NOT_FOUND/)).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('重复草稿');

    mock.writeFailure = 'network';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText(/fetch|network/i)).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('重复草稿');
    diagnostics.assertClean('write failures retain draft');
  });

  test('confirms unsaved close, route changes and refresh', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);

    let modal = await fillCreateDraft(page, { key: 'unsaved_close', name: '未保存关闭' });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('当前修改尚未保存');
      await dialog.dismiss();
    });
    await modal.getByRole('button', { name: '取消' }).click();
    await expect(modal).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await modal.getByRole('button', { name: '取消' }).click();
    await expect(modal).toBeHidden();

    modal = await fillCreateDraft(page, { key: 'unsaved_route', name: '未保存路由' });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('当前修改尚未保存');
      await dialog.dismiss();
    });
    await page.evaluate(() => {
      window.location.hash = '#/characters';
    });
    await expect(page).toHaveURL(/#\/attributes$/);
    await expect(modal).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.evaluate(() => {
      window.location.hash = '#/characters';
    });
    await expect(page).toHaveURL(/#\/characters$/);
    await expect(page.locator('.app-main').getByText('角色管理', { exact: true }).first()).toBeVisible();

    await page.goto('/#/attributes');
    await waitForGame(page);
    modal = await fillCreateDraft(page, { key: 'unsaved_refresh', name: '未保存刷新' });
    let sawBeforeUnload = false;
    page.once('dialog', async (dialog) => {
      sawBeforeUnload = dialog.type() === 'beforeunload';
      await dialog.accept();
    });
    await page.reload();
    expect(sawBeforeUnload).toBe(true);
    await waitForGame(page);
    await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();
    diagnostics.assertClean('unsaved guards');
  });

  test('lands root and unknown hashes on attributes and keeps current pages', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await page.goto('/');
    await waitForGame(page);
    await expect(page).toHaveURL(/#\/attributes$/);
    await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();

    await page.goto('/#/');
    await waitForGame(page);
    await expect(page).toHaveURL(/#\/attributes$/);
    await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();

    const legacyHashes = [
      '#/overview',
      '#/workspace',
      '#/wasm-validation-generic',
      '#/combat-data/effect-steps',
      '#/admin/attribute-definitions',
      '#/entity-growth',
      '#/entity-setup',
      '#/entity-provider-mount',
      '#/provider-setup',
      '#/ability-setup',
      '#/effect-sequence-setup',
      '#/effect-step-setup',
      '#/direct-damage-ability'
    ];

    for (const hash of legacyHashes) {
      await page.goto(`/${hash}`);
      await waitForGame(page);
      await expect(page).toHaveURL(/#\/attributes$/);
      await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();
    }

    const currentPages: Array<[string, string]> = [
      ['#/attributes', '属性管理'],
      ['#/characters', '角色管理'],
      ['#/equipment', '装备管理'],
      ['#/skill-categories', '技能分类管理'],
      ['#/damage-types', '伤害类型管理'],
      ['#/modifier-zones', '乘区管理'],
      ['#/skills', '技能管理'],
      ['#/statuses', '状态管理'],
      ['#/game-settings', '游戏配置'],
      ['#/images', '图片管理']
    ];

    for (const [hash, title] of currentPages) {
      await page.goto(`/${hash}`);
      await waitForGame(page);
      await expect(page).toHaveURL(new RegExp(`${hash.replace('/', '\\/')}$`));
      await expect(page.locator('.app-main').getByText(title, { exact: true }).first()).toBeVisible();
    }

    expect(await page.locator('a[href="#/overview"]').count()).toBe(0);
    expect(await page.locator('a[href="#/workspace"]').count()).toBe(0);
    expect(await page.locator('a[href="#/wasm-validation-generic"]').count()).toBe(0);
    expect(await page.locator('a[href^="#/combat-data"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-growth"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-setup"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-provider-mount"]').count()).toBe(0);
    expect(await page.locator('a[href="#/provider-setup"]').count()).toBe(0);
    expect(await page.locator('a[href="#/ability-setup"]').count()).toBe(0);
    expect(await page.locator('a[href="#/effect-sequence-setup"]').count()).toBe(0);
    expect(await page.locator('a[href="#/effect-step-setup"]').count()).toBe(0);
    expect(await page.locator('a[href="#/direct-damage-ability"]').count()).toBe(0);
    expect(await page.locator('a[href="#/attributes"]').count()).toBe(1);
    expect(await page.locator('a[href="#/characters"]').count()).toBe(1);
    expect(await page.locator('a[href="#/equipment"]').count()).toBe(1);
    expect(await page.locator('a[href="#/skill-categories"]').count()).toBe(1);
    expect(await page.locator('a[href="#/damage-types"]').count()).toBe(1);
    expect(await page.locator('a[href="#/modifier-zones"]').count()).toBe(1);
    expect(await page.locator('a[href="#/skills"]').count()).toBe(1);
    expect(await page.locator('a[href="#/statuses"]').count()).toBe(1);
    expect(await page.locator('a[href="#/game-settings"]').count()).toBe(1);
    expect(await page.locator('a[href="#/images"]').count()).toBe(1);
    diagnostics.assertClean('current pages and unknown hash fallback');
  });
});

test('retries a failed formula catalog inside an unfinished effect result without losing drafts', async ({ page }) => {
  const mock = new MockApi();
  seedSkillEffectCatalog(mock);
  mock.skillFormulaListFailure = true;
  await prepare(page, mock);
  await openSkills(page);
  const shell = await openSkillEffects(page, 'varus_w', '枯萎箭袋');
  const failedRead = page.waitForResponse(response => response.url().endsWith('/skills/varus_w/formulas') && response.status() === 503);
  await shell.getByRole('button', { name: '新增效果', exact: true }).click();
  const effect = visibleModal(page, '新增效果');
  await failedRead;
  await effect.getByLabel('效果标识', { exact: true }).fill('retained_heal');
  await effect.getByLabel('效果名称', { exact: true }).fill('保留治疗草稿');
  await effect.getByRole('button', { name: '新增结果', exact: true }).click();
  const result = visibleModal(page, '新增结果');
  await result.getByLabel('结果标识', { exact: true }).fill('heal');
  await result.getByLabel('结果名称', { exact: true }).fill('未选公式的治疗');
  await chooseSelectOption(page, result, '结果种类', '直接治疗');
  await result.getByText('技能公式', { exact: true }).click();
  await expect(result.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  mock.skillFormulaListFailure = false;
  const recoveredRead = page.waitForResponse(response => response.url().endsWith('/skills/varus_w/formulas') && response.status() === 200);
  await result.getByRole('button', { name: '重试', exact: true }).click();
  await recoveredRead;
  await expect(result.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
  await expect(result.getByLabel('结果名称', { exact: true })).toHaveValue('未选公式的治疗');
  await expect(effect.getByLabel('效果名称', { exact: true })).toHaveValue('保留治疗草稿');
  await fillValueRule(page, result, '治疗公式');
  await saveOpenModal(result);
  await expect(effect.locator('tr', { hasText: 'heal' })).toBeVisible();
  expect(mock.writes).toHaveLength(0);
});

test('numeric values keep fixed zero through catalog failure and preserve parameter drafts after rejected save', async ({ page }) => {
  const mock = new MockApi();
  seedSkillProcessCatalog(mock);
  mock.skillFormulaListFailure = true;
  mock.skillParameters = [{ gameId: GAME_ID, skillKey: 'varus_w', parameterKey: 'capacity', name: '容量', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3, levelValues: null, description: null, sortOrder: 0, createdAt: CREATED_AT, updatedAt: UPDATED_AT }];
  await prepare(page, mock);
  await openSkills(page);
  const shell = await openSkillProcesses(page, 'varus_w', '枯萎箭袋');
  await shell.getByRole('tab', { name: '内部状态' }).click();
  await shell.getByRole('button', { name: '新增内部状态', exact: true }).click();
  const create = visibleModal(page, '新增内部状态');
  await create.getByLabel('内部状态标识', { exact: true }).fill('numeric_counter');
  await create.getByLabel('内部状态名称', { exact: true }).fill('三选计数');
  await create.getByLabel('初始值取值固定数值', { exact: true }).fill('0');
  await create.getByLabel('上限取值固定数值', { exact: true }).fill('0');
  await saveOpenModal(create);
  expect(mock.skillInternalStates[0].detail).toEqual({ initialValue: { kind: 'FIXED', value: 0 }, maxValue: { kind: 'FIXED', value: 0 } });
  mock.skillFormulaListFailure = false;
  await shell.locator('tr', { hasText: 'numeric_counter' }).getByRole('button', { name: '编辑', exact: true }).click();
  const edit = visibleModal(page, '编辑内部状态');
  await expect(edit.getByLabel('上限取值固定数值', { exact: true })).toHaveValue('0');
  await edit.getByLabel('上限取值取值来源', { exact: true }).getByText('技能参数', { exact: true }).click();
  await edit.getByLabel('上限取值技能参数', { exact: true }).click();
  await chooseVisibleOption(page, '容量（capacity）');
  mock.internalStateWriteFailure = 'validation';
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(edit.getByLabel('上限取值技能参数', { exact: true })).toContainText('容量');
  await expect(edit.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await expect(edit.getByText('服务端内部状态名称校验失败', { exact: true })).toBeVisible();
  mock.internalStateWriteFailure = null;
  await saveOpenModal(edit);
  expect(mock.skillInternalStates[0].detail).toEqual({ initialValue: { kind: 'FIXED', value: 0 }, maxValue: { kind: 'PARAMETER', parameterKey: 'capacity' } });
  await shell.locator('tr', { hasText: 'numeric_counter' }).getByRole('button', { name: '编辑', exact: true }).click();
  const reopened = visibleModal(page, '编辑内部状态');
  await expect(reopened.getByLabel('上限取值技能参数', { exact: true })).toContainText('容量');
  await chooseSelectOption(page, reopened, '上限取值', '专注上限');
  await saveOpenModal(reopened);
  expect(mock.skillInternalStates[0].detail.maxValue).toEqual({ kind: 'FORMULA', formulaKey: 'focus_max_stacks' });
});

test('lifecycle conditions save and reopen presence absence and stack comparison without projection state', async ({ page }) => {
  test.setTimeout(120_000);
  const mock = new MockApi();
  seedSkillTriggerCatalog(mock);
  const mark = mock.skillEffects.find((item) => item.effectKey === 'focus_mark')!;
  mark.lifecycle!.instanceScope = 'SOURCE_TARGET';
  mock.skillEffects.push({ ...structuredClone(mark), effectKey: 'skill_mark', name: '技能唯一印记', lifecycle: { ...mark.lifecycle!, instanceScope: 'SKILL' } });
  mock.skillEffectGetFailureKeys.add('focus_mark');
  const diagnostics = await prepare(page, mock);
  await openSkills(page);
  const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
  await shell.getByRole('button', { name: '新增规则', exact: true }).click();
  const create = visibleModal(page, '新增规则');
  await create.getByLabel('规则标识', { exact: true }).fill('lifecycle_direct');
  await create.getByLabel('规则名称', { exact: true }).fill('直接检查印记');
  await create.getByRole('button', { name: '编辑', exact: true }).first().click();
  await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), { name: '引爆', effectName: '命中结果' });
  await create.getByRole('button', { name: '新增条件组', exact: true }).click();
  await create.getByLabel('条件组名称', { exact: true }).fill('印记条件');
  const conditionCard = (modal: Locator) => modal.locator('.arco-card').filter({ has: page.getByLabel('条件组名称', { exact: true }) });
  await conditionCard(create).getByRole('button', { name: '编辑', exact: true }).click();
  const condition = visibleModal(page, '编辑条件');
  await chooseSelectOption(page, condition, '条件种类', '生命周期检查');
  await condition.getByRole('button', { name: '确定', exact: true }).click();
  await expect(condition.getByText('请选择当前技能中已配置生命周期的效果；目录未加载成功时请重试。', { exact: true })).toBeVisible();
  mock.skillEffectGetFailureKeys.delete('focus_mark');
  await condition.getByRole('button', { name: '刷新生命周期候选', exact: true }).click();
  await expect(condition.getByRole('button', { name: '刷新生命周期候选', exact: true })).toBeEnabled();
  await expect(condition.getByLabel('条件种类', { exact: true })).toContainText('生命周期检查');
  await chooseSelectOption(page, condition, '生命周期效果', '专注标记（focus_mark）');
  await expect(condition.getByLabel('生命周期主体', { exact: true })).toContainText('当前目标');
  await expect(condition.getByLabel('层数比较取值', { exact: true })).toHaveCount(0);
  await condition.getByRole('button', { name: '确定', exact: true }).click();
  await expect(condition).toBeHidden();
  await saveOpenModal(create);
  const savedDetail = () => mock.skillTriggerRules.find((item) => item.ruleKey === 'lifecycle_direct')!.conditionGroups[0].conditions[0].detail;
  expect(savedDetail()).toEqual({ effectKey: 'focus_mark', subject: 'CURRENT_TARGET', checkKind: 'PRESENT', comparator: null, comparisonValue: null });

  const reopen = async () => {
    await shell.locator('tr', { hasText: 'lifecycle_direct' }).getByRole('button', { name: '编辑', exact: true }).click();
    const parent = visibleModal(page, '编辑规则');
    await conditionCard(parent).getByRole('button', { name: '编辑', exact: true }).click();
    const child = visibleModal(page, '编辑条件');
    await expect(child.getByLabel('条件种类', { exact: true })).toBeDisabled();
    return { parent, child };
  };
  const absent = await reopen();
  await expect(absent.child.getByLabel('生命周期检查方式', { exact: true })).toContainText('存在');
  await chooseSelectOption(page, absent.child, '生命周期检查方式', '不存在');
  await absent.child.getByRole('button', { name: '确定', exact: true }).click();
  await saveOpenModal(absent.parent);
  expect(savedDetail()).toEqual({ effectKey: 'focus_mark', subject: 'CURRENT_TARGET', checkKind: 'ABSENT', comparator: null, comparisonValue: null });

  const stacks = await reopen();
  await expect(stacks.child.getByLabel('生命周期检查方式', { exact: true })).toContainText('不存在');
  await chooseSelectOption(page, stacks.child, '生命周期效果', '技能唯一印记（skill_mark）');
  await expect(stacks.child.getByLabel('生命周期主体', { exact: true })).toHaveCount(0);
  await chooseSelectOption(page, stacks.child, '生命周期效果', '专注标记（focus_mark）');
  await expect(stacks.child.getByLabel('生命周期主体', { exact: true })).toContainText('当前目标');
  await chooseSelectOption(page, stacks.child, '生命周期检查方式', '层数比较');
  await stacks.child.getByLabel('层数比较取值固定数值', { exact: true }).fill('0.5');
  await stacks.child.getByRole('button', { name: '确定', exact: true }).click();
  await expect(stacks.child.getByText('此处数值必须为整数。', { exact: true })).toBeVisible();
  await stacks.child.getByLabel('层数比较取值固定数值', { exact: true }).fill('0');
  await stacks.child.getByRole('button', { name: '确定', exact: true }).click();
  await saveOpenModal(stacks.parent);
  expect(savedDetail()).toEqual({ effectKey: 'focus_mark', subject: 'CURRENT_TARGET', checkKind: 'STACKS_COMPARE', comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: 0 } });

  const final = await reopen();
  await expect(final.child.getByLabel('层数比较取值固定数值', { exact: true })).toHaveValue('0');
  await final.child.getByRole('button', { name: '取消', exact: true }).click();
  await conditionCard(final.parent).getByRole('button', { name: '删除', exact: true }).last().click();
  await conditionCard(final.parent).getByRole('button', { name: '新增条件', exact: true }).click();
  const replacement = visibleModal(page, '新增条件');
  await expect(replacement.getByLabel('条件标识', { exact: true })).toHaveValue('cond_2');
  await chooseSelectOption(page, replacement, '条件种类', '生命周期检查');
  await chooseSelectOption(page, replacement, '生命周期效果', '技能唯一印记（skill_mark）');
  await replacement.getByRole('button', { name: '确定', exact: true }).click();
  await saveOpenModal(final.parent);
  expect(savedDetail()).toEqual({ effectKey: 'skill_mark', subject: null, checkKind: 'PRESENT', comparator: null, comparisonValue: null });
  diagnostics.assertClean('lifecycle check three branches and replacement condition key');
});

test('source cast resource cost binding retains failed drafts and saves and reopens with immutable source type', async ({ page }) => {
  test.setTimeout(90_000);
  const mock = new MockApi();
  seedSkillTriggerCatalog(mock);
  mock.attributeListFailure = true;
  const diagnostics = await prepare(page, mock);
  await openSkills(page);
  const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
  await shell.getByRole('button', { name: '新增规则', exact: true }).click();
  const create = visibleModal(page, '新增规则');
  await create.getByLabel('规则标识', { exact: true }).fill('source_cast_cost');
  await create.getByLabel('规则名称', { exact: true }).fill('读取来源消耗');
  await chooseTriggerEventType(page, create, '技能命中');
  await chooseSelectOption(page, create, '命中来源技能', '枯萎箭袋（varus_w）');
  await create.getByRole('button', { name: '编辑', exact: true }).first().click();
  const action = visibleModal(page, '编辑动作');
  await action.getByLabel('动作名称', { exact: true }).fill('读取施放消耗');
  await chooseSelectOption(page, action, '目标效果', '追加伤害');
  await action.getByRole('button', { name: '新增绑定', exact: true }).click();
  const binding = visibleModal(page, '新增绑定');
  await chooseSelectOption(page, binding, '来源种类', '来源施放资源消耗');
  await chooseSelectOption(page, binding, '绑定参数', '前序命中值（prior_hit_value / 小数）');
  await expect(binding.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
  await expect(binding.getByText('属性目录尚未成功加载，请刷新后继续；当前草稿已保留。', { exact: true })).toBeVisible();
  mock.attributeListFailure = false;
  await binding.getByRole('button', { name: '刷新属性目录', exact: true }).click();
  await expect(binding.getByLabel('绑定参数', { exact: true })).toContainText('前序命中值');
  await chooseSelectOption(page, binding, '消耗属性', '法力值（mana）');
  await binding.getByRole('button', { name: '确定', exact: true }).click();
  await action.getByRole('button', { name: '确定', exact: true }).click();
  mock.triggerRuleWriteFailure = 'invalid-binding';
  await create.getByRole('button', { name: '保存', exact: true }).click();
  await expect(create.getByText(/400.INVALID_RUNTIME_INPUT_BINDING/)).toBeVisible();
  await expect(create.getByLabel('规则名称', { exact: true })).toHaveValue('读取来源消耗');
  const bindingPayload = { bindingKey: 'bind_1', parameterKey: 'prior_hit_value', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } };
  const writes = () => mock.writes.filter((item) => item.path.endsWith('/trigger-rules'));
  expect((writes().at(-1)!.body.actions as Json[])[0].runtimeInputBindings).toEqual([bindingPayload]);
  expect(mock.skillTriggerRules).toHaveLength(0);
  mock.triggerRuleWriteFailure = null;
  await saveOpenModal(create);
  expect(mock.skillTriggerRules[0].actions[0].runtimeInputBindings).toEqual([bindingPayload]);

  await shell.locator('tr', { hasText: 'source_cast_cost' }).getByRole('button', { name: '编辑', exact: true }).click();
  const edit = visibleModal(page, '编辑规则');
  await edit.getByRole('button', { name: '编辑', exact: true }).first().click();
  const editAction = visibleModal(page, '编辑动作');
  await editAction.locator('tr', { hasText: '来源施放资源消耗 / mana' }).getByRole('button', { name: '编辑', exact: true }).click();
  const editBinding = visibleModal(page, '编辑绑定');
  await expect(editBinding.getByLabel('来源种类', { exact: true })).toHaveClass(/arco-select-disabled/);
  await expect(editBinding.getByLabel('消耗属性', { exact: true })).toContainText('法力值（mana）');
  await expect(editBinding.getByRole('button', { name: '确定', exact: true })).toBeEnabled();
  mock.attributes = mock.attributes.filter((item) => item.attributeKey !== 'mana');
  await editBinding.getByRole('button', { name: '刷新属性目录', exact: true }).click();
  await expect(editBinding.getByText('请选择当前游戏已存在的消耗属性。', { exact: true })).toBeVisible();
  await expect(editBinding.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
  mock.attributes.push(attribute('mana', '法力值'));
  await editBinding.getByRole('button', { name: '刷新属性目录', exact: true }).click();
  await expect(editBinding.getByRole('button', { name: '确定', exact: true })).toBeEnabled();
  await editBinding.getByRole('button', { name: '取消', exact: true }).click();
  await editAction.locator('tr', { hasText: '来源施放资源消耗 / mana' }).getByRole('button', { name: '删除', exact: true }).click();
  await editAction.getByRole('button', { name: '新增绑定', exact: true }).click();
  const replacement = visibleModal(page, '新增绑定');
  await expect(replacement.getByLabel('绑定标识', { exact: true })).toHaveValue('bind_2');
  await chooseSelectOption(page, replacement, '来源种类', '来源施放资源消耗');
  await chooseSelectOption(page, replacement, '绑定参数', '前序命中值（prior_hit_value / 小数）');
  await chooseSelectOption(page, replacement, '消耗属性', '法力值（mana）');
  await replacement.getByRole('button', { name: '确定', exact: true }).click();
  await editAction.getByRole('button', { name: '确定', exact: true }).click();
  await saveOpenModal(edit);
  expect(mock.skillTriggerRules[0].actions[0].runtimeInputBindings).toEqual([{ ...bindingPayload, bindingKey: 'bind_2' }]);
  diagnostics.assertClean('source cast resource cost binding round trip and retained failures');
});

test('event counterpart category supports kill, damage directions, legal switches and confirms invalid event cleanup', async ({ page }) => {
  const mock = new MockApi();
  seedSkillTriggerCatalog(mock);
  const diagnostics = await prepare(page, mock);
  await openSkills(page);
  const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
  await shell.getByRole('button', { name: '新增规则', exact: true }).click();
  const create = visibleModal(page, '新增规则');
  await create.getByLabel('规则标识', { exact: true }).fill('target_categories');
  await create.getByLabel('规则名称', { exact: true }).fill('事件对方类别条件');
  await chooseTriggerEventType(page, create, '来源对象完成击杀');
  await create.getByRole('button', { name: '编辑', exact: true }).first().click();
  await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), { name: '命中伤害', effectName: '命中结果' });
  await create.getByRole('button', { name: '新增条件组', exact: true }).click();
  await create.getByLabel('条件组名称', { exact: true }).fill('实际事件对方类别');
  const card = (modal: Locator) => modal.locator('.arco-card').filter({ has: page.getByLabel('条件组名称', { exact: true }) });
  await card(create).getByRole('button', { name: '编辑', exact: true }).click();
  const condition = visibleModal(page, '编辑条件');
  await chooseSelectOption(page, condition, '条件种类', '事件对方类别');
  await expect(condition.getByLabel('属性比较对象', { exact: true })).toHaveCount(0);
  await expect(condition.getByLabel('比较取值', { exact: true })).toHaveCount(0);
  await expect(condition.getByText('击杀事件读取本次被击杀对象；匹配所选任一类别。', { exact: true })).toBeVisible();
  await condition.getByRole('button', { name: '确定', exact: true }).click();
  await expect(condition.getByText('至少选择一个事件对方类别。', { exact: true })).toBeVisible();
  for (const label of ['英雄', '史诗野怪', '建筑']) await condition.getByText(label, { exact: true }).click();
  await condition.getByRole('button', { name: '确定', exact: true }).click();
  await expect(card(create).locator('span').filter({ hasText: /^事件对方类别 \/ 英雄、史诗野怪、建筑$/ })).toBeVisible();
  await saveOpenModal(create);
  const saved = () => mock.skillTriggerRules.find((item) => item.ruleKey === 'target_categories')!;
  expect(saved().conditionGroups[0].conditions[0].detail).toEqual({ categories: ['CHAMPION', 'EPIC_MONSTER', 'STRUCTURE'] });
  expect(saved().eventSource.eventType).toBe('KILL');
  expect(saved().perTargetCooldown).toBeNull();
  expect(saved().maxTriggersPerProcess).toBeNull();

  const reopen = async () => {
    await shell.locator('tr', { hasText: 'target_categories' }).getByRole('button', { name: '编辑', exact: true }).click();
    return visibleModal(page, '编辑规则');
  };
  const edit = await reopen();
  await chooseTriggerEventType(page, edit, '普通攻击命中');
  await card(edit).getByRole('button', { name: '编辑', exact: true }).click();
  const editCondition = visibleModal(page, '编辑条件');
  await expect(editCondition.getByLabel('条件种类', { exact: true })).toBeDisabled();
  for (const label of ['英雄', '史诗野怪', '建筑']) await expect(editCondition.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  for (const label of ['英雄', '史诗野怪', '建筑', '小兵', '非史诗野怪']) await editCondition.getByText(label, { exact: true }).click();
  await editCondition.getByRole('button', { name: '确定', exact: true }).click();
  await saveOpenModal(edit);
  expect(saved().eventSource.eventType).toBe('BASIC_ATTACK_HIT');
  expect(saved().conditionGroups[0].conditions[0].detail).toEqual({ categories: ['MINION', 'NON_EPIC_MONSTER'] });

  const reopened = await reopen();
  await expect(card(reopened).locator('span').filter({ hasText: /^事件对方类别 \/ 小兵、非史诗野怪$/ })).toBeVisible();
  const assertDirectionHelp = async (eventName: string, help: string) => {
    await chooseTriggerEventType(page, reopened, eventName);
    await card(reopened).getByRole('button', { name: '编辑', exact: true }).click();
    const directionCondition = visibleModal(page, '编辑条件');
    await expect(directionCondition.getByText(help, { exact: true })).toBeVisible();
    await directionCondition.getByRole('button', { name: '取消', exact: true }).click();
  };
  await assertDirectionHelp('即将受到伤害', '伤害待结算事件读取本次伤害来源对象；匹配所选任一类别。');
  await assertDirectionHelp('来源对象造成伤害', '造成伤害事件读取本次伤害承受对象；匹配所选任一类别。');
  await assertDirectionHelp('来源对象受到伤害', '受到伤害事件读取本次伤害来源对象；匹配所选任一类别。');
  await chooseTriggerEventType(page, reopened, '技能命中');
  await expect(card(reopened).locator('span').filter({ hasText: /^事件对方类别 \/ 小兵、非史诗野怪$/ })).toBeVisible();
  await chooseTriggerEventType(page, reopened, '来源对象完成击杀');
  await expect(card(reopened).locator('span').filter({ hasText: /^事件对方类别 \/ 小兵、非史诗野怪$/ })).toBeVisible();
  await chooseSelectOption(page, reopened, '事件类型', '普通攻击发起');
  const cleanup = page.getByRole('dialog').filter({ hasText: '将清除事件对方类别条件' });
  await cleanup.getByRole('button', { name: '取消', exact: true }).click();
  await expect(card(reopened).locator('span').filter({ hasText: /^事件对方类别 \/ 小兵、非史诗野怪$/ })).toBeVisible();
  await chooseSelectOption(page, reopened, '事件类型', '普通攻击发起');
  await cleanup.getByRole('button', { name: '确定', exact: true }).click();
  await expect(card(reopened).getByText(/事件对方类别 \/ /)).toHaveCount(0);
  await expect(card(reopened)).toHaveCount(0);
  await reopened.getByRole('button', { name: '新增条件组', exact: true }).click();
  await card(reopened).getByRole('button', { name: '新增条件', exact: true }).click();
  const next = visibleModal(page, '新增条件');
  await next.getByLabel('条件种类', { exact: true }).click();
  await expect(page.getByRole('option', { name: '事件对方类别', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  diagnostics.assertClean('target category selection and event cleanup');
});

test('skill hit spell shield value saves condition and binding and confirms invalid event cleanup', async ({ page }) => {
  const mock = new MockApi();
  seedSkillTriggerCatalog(mock);
  const diagnostics = await prepare(page, mock);
  const valueLabel = '技能命中被法术护盾阻挡（否 = 0，是 = 1）';
  await openSkills(page);
  const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
  await shell.getByRole('button', { name: '新增规则', exact: true }).click();
  const create = visibleModal(page, '新增规则');
  await create.getByLabel('规则标识', { exact: true }).fill('hit_shield_value');
  await create.getByLabel('规则名称', { exact: true }).fill('命中护盾判定');
  await chooseTriggerEventType(page, create, '技能命中');
  await create.getByRole('button', { name: '编辑', exact: true }).first().click();
  const action = visibleModal(page, '编辑动作');
  await action.getByLabel('动作名称', { exact: true }).fill('读取阻挡值');
  await chooseSelectOption(page, action, '目标效果', '追加伤害');
  await action.getByRole('button', { name: '新增绑定', exact: true }).click();
  const binding = visibleModal(page, '新增绑定');
  await chooseSelectOption(page, binding, '绑定参数', '前序命中值（prior_hit_value / 小数）');
  await chooseSelectOption(page, binding, '来源种类', '当前事件值');
  await chooseSelectOption(page, binding, '绑定事件值', valueLabel);
  await binding.getByRole('button', { name: '确定', exact: true }).click();
  await action.getByRole('button', { name: '确定', exact: true }).click();
  await create.getByRole('button', { name: '新增条件组', exact: true }).click();
  await create.getByLabel('条件组名称', { exact: true }).fill('检查命中阻挡');
  const card = (modal: Locator) => modal.locator('.arco-card').filter({ has: page.getByLabel('条件组名称', { exact: true }) });
  await card(create).getByRole('button', { name: '编辑', exact: true }).click();
  const condition = visibleModal(page, '编辑条件');
  await chooseSelectOption(page, condition, '条件种类', '事件值比较');
  await chooseSelectOption(page, condition, '事件值', valueLabel);
  await condition.getByLabel('事件值比较取值固定数值', { exact: true }).fill('0.5');
  await condition.getByRole('button', { name: '确定', exact: true }).click();
  await saveOpenModal(create);
  const saved = () => mock.skillTriggerRules.find((item) => item.ruleKey === 'hit_shield_value')!;
  expect(saved().conditionGroups[0].conditions[0].detail).toEqual({
    eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 0.5 }
  });
  expect(saved().actions[0].runtimeInputBindings).toEqual([{
    bindingKey: 'bind_1', parameterKey: 'prior_hit_value', sourceType: 'EVENT_VALUE',
    detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' }
  }]);
  expect(saved().perTargetCooldown).toBeNull();
  expect(saved().maxTriggersPerProcess).toBeNull();

  await shell.locator('tr', { hasText: 'hit_shield_value' }).getByRole('button', { name: '编辑', exact: true }).click();
  const edit = visibleModal(page, '编辑规则');
  await card(edit).getByRole('button', { name: '编辑', exact: true }).click();
  const editCondition = visibleModal(page, '编辑条件');
  await expect(editCondition.getByLabel('事件值', { exact: true })).toContainText(valueLabel);
  await expect(editCondition.getByLabel('事件值比较取值固定数值', { exact: true })).toHaveValue('0.5');
  await editCondition.getByRole('button', { name: '取消', exact: true }).click();
  await edit.locator('.arco-card').filter({ hasText: '1. 读取阻挡值' }).getByRole('button', { name: '编辑', exact: true }).click();
  const editAction = visibleModal(page, '编辑动作');
  await editAction.locator('tr', { hasText: '当前事件值 / 技能命中被法术护盾阻挡' }).getByRole('button', { name: '编辑', exact: true }).click();
  const editBinding = visibleModal(page, '编辑绑定');
  await expect(editBinding.getByLabel('绑定事件值', { exact: true })).toContainText(valueLabel);
  await expect(editBinding.getByRole('button', { name: '确定', exact: true })).toBeEnabled();
  await editBinding.getByRole('button', { name: '取消', exact: true }).click();
  await editAction.getByRole('button', { name: '取消', exact: true }).click();

  await chooseSelectOption(page, edit, '事件类型', '普通攻击命中');
  const cleanup = page.getByRole('dialog').filter({ hasText: '将清除不再可用的事件值：技能命中被法术护盾阻挡' });
  await cleanup.getByRole('button', { name: '取消', exact: true }).click();
  await expect(edit.getByLabel('事件类型', { exact: true })).toContainText('技能命中');
  await expect(card(edit).locator('span').filter({ hasText: /事件值比较 \/ 技能命中被法术护盾阻挡/ })).toBeVisible();
  await chooseSelectOption(page, edit, '事件类型', '普通攻击命中');
  await cleanup.getByRole('button', { name: '确定', exact: true }).click();
  await expect(card(edit).getByText(/事件值比较 \/ 技能命中被法术护盾阻挡/)).toHaveCount(0);
  await expect(card(edit)).toHaveCount(0);
  await edit.getByRole('button', { name: '新增条件组', exact: true }).click();
  await card(edit).getByRole('button', { name: '新增条件', exact: true }).click();
  const nextCondition = visibleModal(page, '新增条件');
  await chooseSelectOption(page, nextCondition, '条件种类', '事件值比较');
  await nextCondition.getByLabel('事件值', { exact: true }).click();
  await expect(page.getByRole('option', { name: valueLabel, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await nextCondition.getByRole('button', { name: '取消', exact: true }).click();
  await edit.locator('.arco-card').filter({ hasText: '1. 读取阻挡值' }).getByRole('button', { name: '编辑', exact: true }).click();
  await expect(editAction.locator('tr', { hasText: '当前事件值 / 技能命中被法术护盾阻挡' })).toHaveCount(0);
  await editAction.getByRole('button', { name: '新增绑定', exact: true }).click();
  const nextBinding = visibleModal(page, '新增绑定');
  await chooseSelectOption(page, nextBinding, '来源种类', '当前事件值');
  await nextBinding.getByLabel('绑定事件值', { exact: true }).click();
  await expect(page.getByRole('option', { name: valueLabel, exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '当前命中序号', exact: true })).toBeVisible();
  diagnostics.assertClean('skill hit spell shield value round trip and cleanup');
});

test('condition group key typing keeps focus and identity through equal-order rename and reorder', async ({ page }) => {
  const mock = new MockApi();
  seedSkillTriggerCatalog(mock);
  const diagnostics = await prepare(page, mock);
  await openSkills(page);
  const shell = await openSkillTriggers(page, 'varus_w', '枯萎箭袋');
  await shell.getByRole('button', { name: '新增规则', exact: true }).click();
  const create = visibleModal(page, '新增规则');
  await create.getByLabel('规则标识', { exact: true }).fill('group_focus');
  await create.getByLabel('规则名称', { exact: true }).fill('条件组输入焦点');
  await chooseTriggerEventType(page, create, '技能命中');
  await create.getByRole('button', { name: '编辑', exact: true }).first().click();
  await fillExecuteEffectAction(page, visibleModal(page, '编辑动作'), { name: '命中伤害', effectName: '命中结果' });
  await create.getByRole('button', { name: '新增条件组', exact: true }).click();
  await create.getByLabel('条件组名称', { exact: true }).fill('第一组');
  await create.getByRole('button', { name: '新增条件组', exact: true }).click();
  await create.getByLabel('条件组名称', { exact: true }).last().fill('第二组');
  const groupCard = (name: string, modal: Locator = create) => modal.locator('.arco-card').filter({
    has: page.locator(`input[aria-label="条件组名称"][value="${name}"]`)
  });
  const keyInput = groupCard('第一组').getByLabel('条件组标识', { exact: true });
  const originalKeyNode = await keyInput.elementHandle();
  await keyInput.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(keyInput).toBeFocused();
  let typed = '';
  for (const character of 'z_valid_mark_target') {
    await page.keyboard.type(character);
    typed += character;
    await expect(keyInput).toBeFocused();
    await expect(keyInput).toHaveValue(typed);
  }
  expect(await originalKeyNode!.evaluate((node) => node === document.activeElement && node.isConnected)).toBe(true);
  await expect(groupCard('第二组').getByLabel('条件组标识', { exact: true })).toHaveValue('group_2');
  expect(await create.getByLabel('条件组名称', { exact: true }).evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))).toEqual(['第二组', '第一组']);

  const sortInput = groupCard('第一组').getByLabel('条件组排序', { exact: true });
  const originalSortNode = await sortInput.elementHandle();
  await sortInput.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(sortInput).toBeFocused();
  for (const character of '50') {
    await page.keyboard.type(character);
    await expect(sortInput).toBeFocused();
  }
  expect(await originalSortNode!.evaluate((node) => node === document.activeElement && node.isConnected)).toBe(true);
  await expect(sortInput).toHaveValue('50');
  await expect(groupCard('第二组').getByLabel('条件组排序', { exact: true })).toHaveValue('10');
  for (const [name, category] of [['第一组', '英雄'], ['第二组', '小兵']]) {
    await groupCard(name).getByRole('button', { name: '编辑', exact: true }).click();
    const condition = visibleModal(page, '编辑条件');
    await chooseSelectOption(page, condition, '条件种类', '事件对方类别');
    await condition.getByText(category, { exact: true }).click();
    await condition.getByRole('button', { name: '确定', exact: true }).click();
  }
  await saveOpenModal(create);
  const request = mock.writes.find((item) => item.method === 'POST' && item.path.endsWith('/trigger-rules') && item.body.ruleKey === 'group_focus')!.body;
  expect(JSON.stringify(request)).not.toContain('draftId');
  expect((request.conditionGroups as Json[]).map((group) => [group.groupKey, group.name, group.sortOrder, group.conditions[0].detail.categories])).toEqual([
    ['group_2', '第二组', 10, ['MINION']], ['z_valid_mark_target', '第一组', 50, ['CHAMPION']]
  ]);
  await shell.locator('tr', { hasText: 'group_focus' }).getByRole('button', { name: '编辑', exact: true }).click();
  const reopened = visibleModal(page, '编辑规则');
  await expect(groupCard('第一组', reopened).getByLabel('条件组标识', { exact: true })).toHaveValue('z_valid_mark_target');
  await expect(groupCard('第二组', reopened).getByLabel('条件组标识', { exact: true })).toHaveValue('group_2');
  await reopened.getByRole('button', { name: '取消', exact: true }).click();
  await expect(reopened).toBeHidden();
  diagnostics.assertClean('condition group typing and reorder preserve identity');
});
