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

type WriteFailure = 'validation' | 'duplicate' | 'not-found' | 'network' | null;

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
  equipmentAttributes: Record<string, Record<string, number>> = {};
  skillCategories: SkillCategoryRow[] = [];
  damageTypes: DamageTypeRow[] = [];
  skills: SkillRow[] = [];
  skillParameters: SkillParameterRow[] = [];
  skillFormulas: SkillFormulaRow[] = [];
  skillCategoryListFailure = false;
  parameterDeleteConflictKeys = new Set<string>();
  minLevel = 1;
  maxLevel = 2;
  writeFailure: WriteFailure = null;
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
      await this.json(route, 200, [{ gameId: GAME_ID, gameName: GAME_NAME }]);
      return;
    }

    if (method === 'GET' && path === `/api/games/${GAME_ID}/versions/current`) {
      await this.json(route, 200, {
        gameId: GAME_ID,
        versionCode: '1.0.0',
        releaseDate: '2026-08-01',
        publishedAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        changeRevision: 7
      });
      return;
    }

    if (method === 'GET' && path === `/api/games/${GAME_ID}/combat-data/state`) {
      await this.json(route, 200, {
        gameId: GAME_ID,
        currentRevision: 7,
        data: {
          gameId: GAME_ID,
          currentRevision: 7,
          publishedRevision: 7,
          updatedAt: UPDATED_AT
        }
      });
      return;
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

    if (path === `/api/admin/games/${GAME_ID}/damage-types`) {
      if (method === 'GET') {
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

    if (path === `/api/admin/games/${GAME_ID}/attributes`) {
      if (method === 'GET') {
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

async function openSkills(page: Page): Promise<void> {
  await page.goto('/#/skills');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('技能管理', { exact: true }).first()).toBeVisible();
}

async function openGameSettings(page: Page): Promise<void> {
  await page.goto('/#/game-settings');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('游戏配置', { exact: true }).first()).toBeVisible();
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

function skillRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: key, exact: true })
  });
}

function visibleModal(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title });
}

async function closeEditorByOutsideOrEscape(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name === 'Desktop Chrome') {
    await page
      .locator('.arco-modal-wrapper:visible')
      .filter({ has: page.locator('.arco-modal:visible') })
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
});

test.describe('skill management without Wasm', () => {
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
    await expect(deleteModal.getByText('该参数正在被技能公式使用，不能删除')).toBeVisible();
    expect(mock.skillParameters.some((item) => item.parameterKey === 'missing_health_ratio')).toBe(true);

    await deleteModal.getByRole('button', { name: '取消', exact: true }).click();
    await shell.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(shell).toBeHidden();
    diagnostics.assertClean('skill parameter and formula management');
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
      window.location.hash = '#/overview';
    });
    await expect(page).toHaveURL(/#\/attributes$/);
    await expect(modal).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.evaluate(() => {
      window.location.hash = '#/overview';
    });
    await expect(page).toHaveURL(/#\/overview$/);
    await expect(page.locator('.app-main').getByText('游戏入口', { exact: true }).first()).toBeVisible();

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

  test('keeps legacy hashes, renders overview and exposes no legacy navigation entry', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    const legacyHashes = [
      '#/combat-data/effect-steps',
      '#/admin/attribute-definitions',
      '#/entity-growth',
      '#/entity-setup',
      '#/entity-provider-mount'
    ];

    for (const hash of legacyHashes) {
      await page.goto(`/${hash}`);
      await waitForGame(page);
      await expect(page.locator('.app-main').getByText('游戏入口', { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => window.location.hash)).toBe(hash);
    }

    expect(await page.locator('a[href^="#/combat-data"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-growth"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-setup"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-provider-mount"]').count()).toBe(0);
    expect(await page.locator('a[href="#/attributes"]').count()).toBe(1);
    expect(await page.locator('a[href="#/characters"]').count()).toBe(1);
    expect(await page.locator('a[href="#/equipment"]').count()).toBe(1);
    expect(await page.locator('a[href="#/skill-categories"]').count()).toBe(1);
    expect(await page.locator('a[href="#/damage-types"]').count()).toBe(1);
    expect(await page.locator('a[href="#/skills"]').count()).toBe(1);
    diagnostics.assertClean('legacy hash fallback');
  });
});
