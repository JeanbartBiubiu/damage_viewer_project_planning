/**
 * Isolated non-Wasm mock UI acceptance (Slice 3).
 * Mock / live-read / controlled-write evidence are conceptually separate:
 * these cases prove browser UI against deterministic route mocks only —
 * they do not claim live Backend compatibility.
 */
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { COMBAT_DATA_RESOURCE_LIST } from '../../src/pages/admin/combat-data/resourceRegistry';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';

/** Dedicated mock API host — never reuse Wasm E2E_* live metadata. */
const MOCK_API_BASE = 'http://127.0.0.1:19080';
const GAME_ID = 'demo';
const GAME_NAME = 'Demo Arena';
const ADMIN_TOKEN = 'non-wasm-e2e-token';

/** Tiny 1×1 PNG (in-memory upload buffer only). */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const META = {
  gameId: GAME_ID,
  changeRevision: 7,
  updatedAt: '2026-07-18T00:00:00Z'
} as const;

type Json = Record<string, unknown>;

type MockFlags = {
  /** Public list resource id that fails with 500 (relationship unknown). */
  failRelationshipListId: string | null;
  /** Admin PUT returns 409.REVISION_CONFLICT. */
  conflictOnSave: boolean;
  /** Entity PUT returns 400 with details.path=/imageUri. */
  imageUri400: boolean;
  /** GET versions/current → 404. */
  noCurrentVersion: boolean;
  /** GET versions/current → 500 (inspect failure, not no-current). */
  failCurrentVersionHard: boolean;
  /** GET combat-data/state → 500 (soft inspect warning). */
  failCombatState: boolean;
  /** After successful entity PUT, list omits the saved row (readback warning). */
  omitSavedEntityOnList: boolean;
  /** After publish POST, verification GETs fail (readback-warning separation). */
  publishVerificationFail: boolean;
  /** Generic non-409 save failure. */
  genericSaveFail: boolean;
};

type CapturedPut = {
  url: string;
  method: string;
  body: Json | null;
};

function row(extra: Json): Json {
  return { ...META, ...extra };
}

function envelope(data: unknown, revision = 7): Json {
  return { gameId: GAME_ID, currentRevision: revision, data };
}

function stagesFor(entityId: string, attrKey: string, base = 10): Json[] {
  const out: Json[] = [];
  for (let stage = 1; stage <= 18; stage += 1) {
    out.push(row({ entityId, attrKey, stage, value: base + stage }));
  }
  return out;
}

function resourceStagesFor(entityId: string, resourceKey: string): Json[] {
  const out: Json[] = [];
  for (let stage = 1; stage <= 18; stage += 1) {
    out.push(
      row({
        entityId,
        resourceKey,
        stage,
        initialValue: 100 + stage,
        maxValue: 200 + stage
      })
    );
  }
  return out;
}

/** Representative cross-linked fixture for all 30 public combat-data resources. */
function buildFixtureLists(): Record<string, unknown> {
  const types = [
    row({ typeId: 1, typeKey: 'provider_kind/active', name: '主动 Provider' }),
    row({ typeId: 2, typeKey: 'ability_kind/active', name: '主动技能' }),
    row({ typeId: 3, typeKey: 'operation/damage', name: '伤害操作' }),
    row({ typeId: 4, typeKey: 'selector/target', name: '目标选择' }),
    row({ typeId: 5, typeKey: 'damage/physical', name: '物理伤害' }),
    row({ typeId: 6, typeKey: 'value_policy/flat', name: '平面策略' }),
    row({ typeId: 7, typeKey: 'provider_action/apply', name: '施加' }),
    row({ typeId: 8, typeKey: 'event/on_hit', name: '命中事件' }),
    row({ typeId: 9, typeKey: 'ability_control_action/cast', name: '施放控制' }),
    row({ typeId: 10, typeKey: 'state_scope/self', name: '自身状态域' }),
    row({ typeId: 11, typeKey: 'repeat_scope/once', name: '单次' }),
    row({ typeId: 12, typeKey: 'phase/cast', name: '施放阶段' }),
    row({ typeId: 13, typeKey: 'refresh/refresh', name: '刷新策略' }),
    row({ typeId: 14, typeKey: 'match_mode/exact', name: '精确匹配' }),
    row({ typeId: 15, typeKey: 'trigger/on_cast', name: '施放触发' }),
    row({ typeId: 16, typeKey: 'value_type/number', name: '数值类型' })
  ];

  return {
    'progression-schema': row({
      progressionKind: 'LEVEL',
      stageMin: 1,
      stageMax: 18,
      stageLabel: '等级',
      requireAllStages: true
    }),
    'attribute-definitions': [
      row({
        attrKey: 'atk',
        attrName: '攻击力',
        attrType: 'number',
        valueKind: 'scalar',
        sortOrder: 1,
        imageUri: 'attr_atk_icon'
      }),
      row({
        attrKey: 'ap',
        attrName: '法术强度',
        attrType: 'number',
        valueKind: 'scalar',
        sortOrder: 2,
        imageUri: null
      })
    ],
    'resource-definitions': [
      row({
        resourceKey: 'hp',
        displayName: '生命值',
        defaultInitialValue: 500,
        defaultMaxValue: 500
      }),
      row({
        resourceKey: 'mana',
        displayName: '法力',
        defaultInitialValue: 200,
        defaultMaxValue: 200
      })
    ],
    types,
    'type-relations': [
      row({ typeId: 1, targetCategory: 'entity', targetId: 'hero_ashe', extend: {} })
    ],
    entities: [
      row({
        entityId: 'hero_ashe',
        displayName: '艾希',
        description: '寒冰射手',
        imageUri: 'character_ashe'
      }),
      row({
        entityId: 'hero_vayne',
        displayName: '薇恩',
        description: '暗夜猎手',
        imageUri: null
      })
    ],
    'entity-attributes': [
      row({ entityId: 'hero_ashe', attrKey: 'atk', baseValue: 60 }),
      row({ entityId: 'hero_ashe', attrKey: 'ap', baseValue: 0 }),
      row({ entityId: 'hero_vayne', attrKey: 'atk', baseValue: 55 })
    ],
    'entity-attribute-stages': [
      ...stagesFor('hero_ashe', 'atk', 60),
      ...stagesFor('hero_ashe', 'ap', 0),
      row({ entityId: 'hero_vayne', attrKey: 'atk', stage: 1, value: 56 })
    ],
    'entity-resources': [
      row({ entityId: 'hero_ashe', resourceKey: 'hp', initialValue: 500, maxValue: 500 }),
      row({ entityId: 'hero_ashe', resourceKey: 'mana', initialValue: 200, maxValue: 200 })
    ],
    'entity-resource-stages': resourceStagesFor('hero_ashe', 'hp'),
    'entity-provider-mounts': [row({ entityId: 'hero_ashe', providerId: 'provider_q' })],
    providers: [
      row({
        providerId: 'provider_q',
        providerKindTypeId: 1,
        displayName: 'Q 技能 Provider'
      })
    ],
    'provider-lifecycles': [
      row({
        providerId: 'provider_q',
        durationFormulaKey: 'duration',
        maxStacks: 1,
        refreshPolicyTypeId: 13,
        tickIntervalMs: 1000,
        startDelayMs: 0
      })
    ],
    'provider-state-fields': [
      row({ providerId: 'provider_q', stateKey: 'stacks', valueTypeId: 16 })
    ],
    'provider-formulas': [
      row({
        providerId: 'provider_q',
        formulaKey: 'damage_amount',
        expression: { op: 'const', value: 100 }
      }),
      row({
        providerId: 'provider_q',
        formulaKey: 'duration',
        expression: { op: 'const', value: 5 }
      }),
      row({
        providerId: 'provider_q',
        formulaKey: 'cast_ok',
        expression: { op: 'const', value: true }
      })
    ],
    'provider-modifiers': [
      row({
        modifierId: 'mod_atk',
        providerId: 'provider_q',
        modifierKey: 'atk_buff',
        modifierTypeId: 7,
        targetSelectorTypeId: 4,
        targetAttrKey: 'atk',
        priority: 0,
        valuePolicyTypeId: 6,
        valueFormulaKey: 'damage_amount'
      })
    ],
    'provider-listeners': [
      row({
        listenerId: 'listener_hit',
        providerId: 'provider_q',
        listenerKey: 'on_hit',
        eventTypeId: 8,
        abilityId: 'ability_q'
      })
    ],
    'listener-match-types': [
      row({ listenerId: 'listener_hit', matchModeTypeId: 14, typeId: 3 })
    ],
    'provider-tick-sequences': [
      row({ providerId: 'provider_q', sequenceId: 'seq_q_main' })
    ],
    abilities: [
      row({
        abilityId: 'ability_q',
        providerId: 'provider_q',
        abilityKey: 'q',
        abilityKindTypeId: 2,
        displayName: 'Q 技能',
        castConditionFormulaKey: 'cast_ok'
      })
    ],
    'ability-parameters': [row({ abilityId: 'ability_q', paramKey: 'rank', numericValue: 1 })],
    'ability-state-fields': [
      row({ abilityId: 'ability_q', stateKey: 'charges', valueTypeId: 16 })
    ],
    'ability-phases': [
      row({
        phaseId: 'phase_q_cast',
        abilityId: 'ability_q',
        phaseOrder: 0,
        phaseTypeId: 12,
        durationFormulaKey: 'duration',
        interruptible: true
      })
    ],
    'ability-costs': [
      row({
        costId: 'cost_q_mana',
        abilityId: 'ability_q',
        phaseId: 'phase_q_cast',
        resourceKey: 'mana',
        amountFormulaKey: 'damage_amount',
        allowPartial: false
      })
    ],
    'ability-cooldowns': [
      row({
        cooldownId: 'cd_q',
        abilityId: 'ability_q',
        durationFormulaKey: 'duration',
        startsOnPhaseId: 'phase_q_cast',
        groupKey: 'q'
      })
    ],
    'effect-sequences': [
      row({
        sequenceId: 'seq_q_main',
        providerId: 'provider_q',
        sequenceKey: 'main',
        displayName: 'Q 主序列'
      })
    ],
    'effect-steps': [
      row({
        stepId: 'step_q_damage',
        sequenceId: 'seq_q_main',
        stepOrder: 0,
        operationTypeId: 3,
        targetSelectorTypeId: 4,
        conditionFormulaKey: 'cast_ok',
        damageDetail: {
          amountFormulaKey: 'damage_amount',
          damageTypeId: 5,
          canCrit: true
        }
      }),
      row({
        stepId: 'step_q_execute',
        sequenceId: 'seq_q_main',
        stepOrder: 1,
        operationTypeId: 3,
        targetSelectorTypeId: 4,
        executeDetail: { threshold: 0.2 }
      })
    ],
    'execute-effect-details': [row({ stepId: 'step_q_execute', threshold: 0.2 })],
    'ability-phase-effect-sequences': [
      row({
        phaseId: 'phase_q_cast',
        triggerTypeId: 15,
        sequenceId: 'seq_q_main'
      })
    ],
    'listener-effect-sequences': [
      row({ listenerId: 'listener_hit', sequenceId: 'seq_q_main' })
    ]
  };
}

const RESOURCE_IDS = COMBAT_DATA_RESOURCE_LIST.map((item) => item.id);

type StaticRoute = {
  hash: string;
  signal: string | RegExp;
  control: string | RegExp;
};

const STATIC_ROUTES: StaticRoute[] = [
  { hash: '#/overview', signal: '游戏入口', control: '刷新快照' },
  { hash: '#/workspace', signal: '版本发布', control: '发布版本' },
  { hash: '#/images', signal: /图片|缓存/, control: '全量同步' },
  { hash: '#/entity-setup', signal: '实体创建', control: '保存' },
  { hash: '#/entity-growth', signal: '实体等级成长', control: '刷新实体曲线' },
  { hash: '#/provider-setup', signal: 'Provider 创建', control: '保存' },
  { hash: '#/entity-provider-mount', signal: '实体 Provider 挂载', control: '保存' },
  { hash: '#/ability-setup', signal: 'Ability 创建', control: '保存' },
  { hash: '#/effect-sequence-setup', signal: 'Effect Sequence 创建', control: '保存' },
  { hash: '#/effect-step-setup', signal: 'Effect Step 创建', control: '保存' },
  { hash: '#/direct-damage-ability', signal: '直伤技能配置', control: '保存' }
];

function isBenignConsoleNoise(text: string): boolean {
  // React 18 StrictMode double-invoke / Arco internal findDOMNode deprecation — not app defects.
  if (text.includes('findDOMNode is deprecated')) {
    return true;
  }
  if (text.includes('Download the React DevTools')) {
    return true;
  }
  // Chromium logs every non-2xx XHR/fetch as a console error even when the app handles it.
  // Controlled mock failure modes (404/409/4xx/5xx) intentionally produce these lines.
  if (/Failed to load resource: the server responded with a status of \d+/i.test(text)) {
    return true;
  }
  return false;
}

/** Neighbor card whose visible title matches resource label (not e.g. 实体属性阶段). */
function neighborByExactTitle(page: Page, title: string) {
  return page
    .locator('.combat-data-gux-neighbor')
    .filter({ hasText: title })
    .filter({ hasNotText: `${title}阶段` });
}

async function openEntityEditor(page: Page, entityId: string): Promise<void> {
  const row = page.locator('.combat-data-gux-record').filter({ hasText: entityId });
  await expect(row, `entity row ${entityId}`).toBeVisible();
  // Prefer explicit 编辑 — more reliable than dblclick under hasTouch mobile projects.
  await row.getByRole('button', { name: '编辑' }).click();
  await expect(page.getByText('编辑 实体')).toBeVisible();
}

class MockApi {
  flags: MockFlags = {
    failRelationshipListId: null,
    conflictOnSave: false,
    imageUri400: false,
    noCurrentVersion: false,
    failCurrentVersionHard: false,
    failCombatState: false,
    omitSavedEntityOnList: false,
    publishVerificationFail: false,
    genericSaveFail: false
  };

  revision = 7;
  lists: Record<string, unknown> = buildFixtureLists();
  images: Array<{ uri: string; imageBase64: string; updatedAt: string }> = [
    {
      uri: 'character_ashe',
      imageBase64: TINY_PNG_BASE64,
      updatedAt: '2026-07-18T00:00:00Z'
    },
    {
      uri: 'attr_atk_icon',
      imageBase64: TINY_PNG_BASE64,
      updatedAt: '2026-07-18T00:00:00Z'
    }
  ];
  currentVersion: Json | null = {
    gameId: GAME_ID,
    versionCode: '1.0.0',
    releaseDate: '2026-07-01',
    publishedAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    changeRevision: 7
  };
  capturedPuts: CapturedPut[] = [];
  unmockedRequests: string[] = [];
  failedRequests: string[] = [];

  resetFlags(): void {
    this.flags = {
      failRelationshipListId: null,
      conflictOnSave: false,
      imageUri400: false,
      noCurrentVersion: false,
      failCurrentVersionHard: false,
      failCombatState: false,
      omitSavedEntityOnList: false,
      publishVerificationFail: false,
      genericSaveFail: false
    };
  }

  resetData(): void {
    this.revision = 7;
    this.lists = buildFixtureLists();
    this.images = [
      {
        uri: 'character_ashe',
        imageBase64: TINY_PNG_BASE64,
        updatedAt: '2026-07-18T00:00:00Z'
      },
      {
        uri: 'attr_atk_icon',
        imageBase64: TINY_PNG_BASE64,
        updatedAt: '2026-07-18T00:00:00Z'
      }
    ];
    this.currentVersion = {
      gameId: GAME_ID,
      versionCode: '1.0.0',
      releaseDate: '2026-07-01',
      publishedAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
      changeRevision: 7
    };
    this.capturedPuts = [];
    this.unmockedRequests = [];
    this.failedRequests = [];
    this.resetFlags();
  }

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
      this.failedRequests.push(`${request.method()} ${url.pathname}: ${String(error)}`);
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: '500.MOCK', message: String(error) }
        })
      });
    }
  }

  private async readBody(request: Request): Promise<Json | null> {
    const raw = request.postData();
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Json;
    } catch {
      return { __raw: raw };
    }
  }

  private async fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  }

  private async fulfillError(
    route: Route,
    status: number,
    code: string,
    message: string,
    details?: Json
  ): Promise<void> {
    await this.fulfillJson(route, status, {
      error: { code, message, details: details ?? {} }
    });
  }

  private combatState(): Json {
    return envelope({
      gameId: GAME_ID,
      currentRevision: this.revision,
      publishedRevision: this.revision,
      updatedAt: META.updatedAt
    });
  }

  private listPayload(resourceId: string): unknown {
    if (resourceId === 'entities' && this.flags.omitSavedEntityOnList) {
      const list = (this.lists.entities as Json[]).filter((item) => item.entityId !== 'hero_ashe');
      return list;
    }
    return this.lists[resourceId];
  }

  private async dispatch(route: Route, request: Request, url: URL): Promise<void> {
    const method = request.method().toUpperCase();
    // Client encodes colon segments (versions:publish, :batch, :direct-damage-setup) as %3A.
    const path = decodeURIComponent(url.pathname);

    if (method === 'GET' && path === '/api/games') {
      await this.fulfillJson(route, 200, [{ gameId: GAME_ID, gameName: GAME_NAME }]);
      return;
    }

    const versionCurrent = path.match(/^\/api\/games\/([^/]+)\/versions\/current$/);
    if (method === 'GET' && versionCurrent) {
      if (this.flags.noCurrentVersion) {
        await this.fulfillError(route, 404, '404.NOT_FOUND', 'current version missing');
        return;
      }
      if (this.flags.failCurrentVersionHard || this.flags.publishVerificationFail) {
        await this.fulfillError(route, 500, '500.VERSION', 'current version inspect failed');
        return;
      }
      await this.fulfillJson(route, 200, this.currentVersion);
      return;
    }

    const combatState = path.match(/^\/api\/games\/([^/]+)\/combat-data\/state$/);
    if (method === 'GET' && combatState) {
      if (this.flags.failCombatState || this.flags.publishVerificationFail) {
        await this.fulfillError(route, 500, '500.STATE', 'combat-data state read failed');
        return;
      }
      await this.fulfillJson(route, 200, this.combatState());
      return;
    }

    const imagesGet = path.match(/^\/api\/games\/([^/]+)\/images$/);
    if (method === 'GET' && imagesGet) {
      await this.fulfillJson(route, 200, { gameId: GAME_ID, images: this.images });
      return;
    }

    const publicResource = path.match(/^\/api\/games\/([^/]+)\/combat-data\/([^/]+)$/);
    if (method === 'GET' && publicResource) {
      const resourceId = decodeURIComponent(publicResource[2]!);
      if (!(resourceId in this.lists)) {
        this.unmockedRequests.push(`${method} ${path}`);
        await this.fulfillError(route, 404, '404.NOT_FOUND', `unknown resource ${resourceId}`);
        return;
      }
      if (this.flags.failRelationshipListId === resourceId) {
        await this.fulfillError(route, 500, '500.RELATION', `relationship list failed: ${resourceId}`);
        return;
      }
      let payload = this.listPayload(resourceId);
      if (Array.isArray(payload) && url.searchParams.toString()) {
        payload = payload.filter((item) => {
          const record = item as Json;
          for (const [key, value] of url.searchParams.entries()) {
            if (String(record[key] ?? '') !== value) {
              return false;
            }
          }
          return true;
        });
      }
      await this.fulfillJson(route, 200, envelope(payload, this.revision));
      return;
    }

    const publicDetail = path.match(/^\/api\/games\/([^/]+)\/combat-data\/([^/]+)\/(.+)$/);
    if (method === 'GET' && publicDetail) {
      // Optional detail GETs (e.g. single entity) — return first matching list row or 404.
      const resourceId = decodeURIComponent(publicDetail[2]!);
      const rest = decodeURIComponent(publicDetail[3]!);
      const data = this.lists[resourceId];
      if (Array.isArray(data)) {
        const found = data.find((item) =>
          Object.values(item as Json).some((value) => String(value) === rest)
        );
        if (found) {
          await this.fulfillJson(route, 200, envelope(found, this.revision));
          return;
        }
      }
      await this.fulfillError(route, 404, '404.NOT_FOUND', 'not found');
      return;
    }

    const publish = path.match(/^\/api\/admin\/games\/([^/]+)\/versions:publish$/);
    if (method === 'POST' && publish) {
      const body = await this.readBody(request);
      this.capturedPuts.push({ url: path, method, body });
      this.revision += 1;
      const versionCode = String(body?.versionCode ?? '2.0.0');
      this.currentVersion = {
        gameId: GAME_ID,
        versionCode,
        releaseDate: body?.releaseDate ?? null,
        publishedAt: '2026-07-18T12:00:00Z',
        updatedAt: '2026-07-18T12:00:00Z',
        changeRevision: this.revision
      };
      await this.fulfillJson(route, 200, {
        gameId: GAME_ID,
        versionCode,
        releaseDate: body?.releaseDate ?? null,
        publishedAt: '2026-07-18T12:00:00Z',
        updatedAt: '2026-07-18T12:00:00Z',
        changeRevision: this.revision
      });
      return;
    }

    const imagePut = path.match(/^\/api\/admin\/games\/([^/]+)\/images\/([^/]+)$/);
    if (method === 'PUT' && imagePut) {
      const uri = decodeURIComponent(imagePut[2]!);
      const body = await this.readBody(request);
      this.capturedPuts.push({ url: path, method, body });
      const asset = {
        uri,
        imageBase64: String(body?.imageBase64 ?? TINY_PNG_BASE64),
        updatedAt: '2026-07-18T12:00:00Z'
      };
      const idx = this.images.findIndex((item) => item.uri === uri);
      if (idx >= 0) {
        this.images[idx] = asset;
      } else {
        this.images.push(asset);
      }
      await this.fulfillJson(route, 200, asset);
      return;
    }

    const adminBatch = path.match(
      /^\/api\/admin\/games\/([^/]+)\/combat-data\/entities\/([^/]+):batch$/
    );
    if (method === 'PUT' && adminBatch) {
      const body = await this.readBody(request);
      this.capturedPuts.push({ url: path, method, body });
      this.revision += 1;
      await this.fulfillJson(route, 200, {
        entityId: decodeURIComponent(adminBatch[2]!),
        currentRevision: this.revision,
        displayName: body?.displayName ?? '艾希'
      });
      return;
    }

    const adminDirectDamage = path.match(
      /^\/api\/admin\/games\/([^/]+)\/combat-data\/providers\/([^/]+)\/abilities\/([^/]+):direct-damage-setup$/
    );
    if (method === 'PUT' && adminDirectDamage) {
      const body = await this.readBody(request);
      this.capturedPuts.push({ url: path, method, body });
      this.revision += 1;
      await this.fulfillJson(route, 200, { currentRevision: this.revision, ok: true });
      return;
    }

    const adminPut = path.match(/^\/api\/admin\/games\/([^/]+)\/combat-data\/(.+)$/);
    if (method === 'PUT' && adminPut) {
      const body = await this.readBody(request);
      this.capturedPuts.push({ url: path, method, body });

      if (this.flags.conflictOnSave) {
        await this.fulfillError(route, 409, '409.REVISION_CONFLICT', 'revision conflict', {
          expectedCurrentRevision: this.revision,
          actualCurrentRevision: this.revision + 1
        });
        return;
      }
      if (this.flags.genericSaveFail) {
        await this.fulfillError(route, 500, '500.SAVE', 'controlled save failure');
        return;
      }
      if (this.flags.imageUri400 && path.includes('/entities/')) {
        await this.fulfillError(route, 400, '400.VALIDATION', 'invalid imageUri', {
          path: '/imageUri'
        });
        return;
      }

      this.revision += 1;
      const segments = adminPut[2]!.split('/');
      const resourceId = decodeURIComponent(segments[0]!);

      // Keep entities list in sync for normal saves (unless omit flag for readback warning).
      if (resourceId === 'entities' && segments[1] && !this.flags.omitSavedEntityOnList) {
        const entityId = decodeURIComponent(segments[1]);
        const list = this.lists.entities as Json[];
        const idx = list.findIndex((item) => item.entityId === entityId);
        const next = row({
          entityId,
          displayName: body?.displayName ?? (idx >= 0 ? list[idx]!.displayName : entityId),
          description:
            body && Object.prototype.hasOwnProperty.call(body, 'description')
              ? body.description
              : idx >= 0
                ? list[idx]!.description
                : '',
          imageUri:
            body && Object.prototype.hasOwnProperty.call(body, 'imageUri')
              ? body.imageUri
              : idx >= 0
                ? list[idx]!.imageUri
                : null
        });
        if (idx >= 0) {
          list[idx] = next;
        } else {
          list.push(next);
        }
      }

      await this.fulfillJson(route, 200, {
        ...(body ?? {}),
        gameId: GAME_ID,
        changeRevision: this.revision,
        updatedAt: META.updatedAt,
        currentRevision: this.revision
      });
      return;
    }

    this.unmockedRequests.push(`${method} ${path}`);
    await this.fulfillError(route, 404, '404.UNMOCKED', `unmocked API ${method} ${path}`);
  }
}

type RouteDiagnostics = {
  pageErrors: string[];
  consoleErrors: string[];
  assertClean: (routeLabel: string) => void;
};

function attachDiagnostics(page: Page, mock: MockApi): RouteDiagnostics {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return;
    }
    const text = msg.text();
    if (isBenignConsoleNoise(text)) {
      return;
    }
    consoleErrors.push(text);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.includes('/api/')) {
      return;
    }
    if (!url.startsWith(MOCK_API_BASE)) {
      mock.unmockedRequests.push(`FAILED ${request.method()} ${url}`);
    }
  });

  return {
    pageErrors,
    consoleErrors,
    assertClean(routeLabel: string) {
      expect(pageErrors, `${routeLabel}: uncaught pageerror`).toEqual([]);
      expect(consoleErrors, `${routeLabel}: console error`).toEqual([]);
      expect(mock.unmockedRequests, `${routeLabel}: unmocked/failed API`).toEqual([]);
    }
  };
}

async function clearBrowserPersistence(page: Page): Promise<void> {
  await page.addInitScript(
    ({ apiKey, tokenKey, apiBase, token }) => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // ignore
      }
      window.localStorage.setItem(apiKey, apiBase);
      window.localStorage.setItem(tokenKey, token);

      // Best-effort IndexedDB wipe so image cache cannot contaminate cases.
      const wipe = async () => {
        const idb = window.indexedDB as IDBFactory & {
          databases?: () => Promise<Array<{ name?: string }>>;
        };
        if (typeof idb.databases !== 'function') {
          return;
        }
        const dbs = await idb.databases();
        await Promise.all(
          (dbs ?? []).map(
            (db) =>
              new Promise<void>((resolve) => {
                if (!db.name) {
                  resolve();
                  return;
                }
                const req = idb.deleteDatabase(db.name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
          )
        );
      };
      void wipe();
    },
    {
      apiKey: API_BASE_STORAGE_KEY,
      tokenKey: ADMIN_TOKEN_STORAGE_KEY,
      apiBase: MOCK_API_BASE,
      token: ADMIN_TOKEN
    }
  );
}

async function openApp(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(
    page.locator('.app-toolbar-field--game .arco-select-view-value'),
    `game select must settle for ${hash}`
  ).toContainText(GAME_ID, { timeout: 30_000 });
}

async function assertNoHorizontalViewportOverflow(page: Page, routeLabel: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      root: root.scrollWidth > window.innerWidth + 1,
      body: body.scrollWidth > window.innerWidth + 1,
      rootWidth: root.scrollWidth,
      inner: window.innerWidth
    };
  });
  expect(
    overflow.root || overflow.body,
    `${routeLabel}: unexpected horizontal viewport overflow (root=${overflow.rootWidth}, inner=${overflow.inner})`
  ).toBe(false);
}

async function prepare(page: Page, mock: MockApi): Promise<RouteDiagnostics> {
  mock.resetData();
  await mock.install(page);
  await clearBrowserPersistence(page);
  return attachDiagnostics(page, mock);
}

test.describe('non-Wasm route inventory gate', () => {
  test('registry inventory is exactly 30', () => {
    expect(COMBAT_DATA_RESOURCE_LIST).toHaveLength(30);
    expect(new Set(RESOURCE_IDS).size).toBe(30);
  });

  for (const route of STATIC_ROUTES) {
    test(`static route opens: ${route.hash}`, async ({ page }) => {
      const mock = new MockApi();
      const diag = await prepare(page, mock);
      await openApp(page, route.hash);
      // Scope to main workspace so Mobile CSS-hidden sidebar labels are not matched first.
      await expect(
        page.locator('.app-main').getByText(route.signal).first(),
        `${route.hash}: page signal`
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: route.control }).first(),
        `${route.hash}: primary control`
      ).toBeVisible();
      await assertNoHorizontalViewportOverflow(page, route.hash);
      diag.assertClean(route.hash);
    });
  }

  for (const resource of COMBAT_DATA_RESOURCE_LIST) {
    const hash = `#/combat-data/${resource.id}`;
    test(`combat-data route opens: ${hash}`, async ({ page }) => {
      const mock = new MockApi();
      const diag = await prepare(page, mock);
      await openApp(page, hash);
      await expect(
        page.locator('.app-main').getByText(resource.label).first(),
        `${hash}: resource label signal`
      ).toBeVisible();
      // Arco Radio keeps the native <input type="radio"> visually hidden; assert the mode control label.
      await expect(
        page.locator('.combat-data-gux-mode').getByText('关系引导', { exact: true }),
        `${hash}: guided mode control`
      ).toBeVisible();
      await expect(
        page.getByPlaceholder('本地搜索当前列表…'),
        `${hash}: search control`
      ).toBeVisible();
      await assertNoHorizontalViewportOverflow(page, hash);
      diag.assertClean(hash);
    });
  }
});

test.describe('representative non-Wasm interactions', () => {
  test('guided defaults, advanced switch, search/count, keyboard selection', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/entities');

    const guided = page.locator('.combat-data-gux-mode').getByText('关系引导', { exact: true });
    await expect(page.locator('.combat-data-gux-mode input[value="guided"]')).toBeChecked();
    await page.locator('.combat-data-gux-mode').getByText('高级逐表', { exact: true }).click();
    await expect(page.locator('.combat-data-gux-mode input[value="advanced"]')).toBeChecked();
    await guided.click();
    await expect(page.locator('.combat-data-gux-mode input[value="guided"]')).toBeChecked();

    await expect(page.getByText(/可见 \d+ \/ 全部 \d+/)).toBeVisible();
    await page.getByPlaceholder('本地搜索当前列表…').fill('vayne');
    await expect(page.getByText(/可见 1 \/ 全部 2/)).toBeVisible();
    await page.getByPlaceholder('本地搜索当前列表…').fill('');

    const list = page.locator('.combat-data-gux-record-list');
    await list.focus();
    await list.press('ArrowDown');
    await expect(page.locator('.combat-data-gux-record.is-selected').first()).toBeVisible();
    diag.assertClean('entities keyboard/search');
  });

  test('resolved labels, compound filter, lazy downstream, relationship unknown', async ({
    page
  }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);

    await openApp(
      page,
      '#/combat-data/entity-attributes?field=entityId&value=hero_ashe&field=attrKey&value=atk'
    );
    await expect(page.getByText(/过滤 2 组/)).toBeVisible();
    await expect(page.getByText(/可见 1 \/ 全部/)).toBeVisible();
    // Resolved reference labels (entity + attribute display names).
    await expect(page.getByText('艾希').first()).toBeVisible();
    await expect(page.getByText('攻击力').first()).toBeVisible();

    await openApp(page, '#/combat-data/entities');
    const list = page.locator('.combat-data-gux-record-list');
    await list.focus();
    await list.press('ArrowDown');
    await expect(page.locator('.combat-data-gux-record.is-selected')).toBeVisible();

    const downstream = neighborByExactTitle(page, '实体属性');
    await downstream.getByRole('button', { name: '展开并加载' }).click();
    await expect(downstream.locator('.combat-data-gux-neighbor-status')).not.toHaveText('未展开');
    await expect(downstream.locator('.combat-data-gux-neighbor-status')).not.toHaveText('关系未知');

    mock.flags.failRelationshipListId = 'entity-resources';
    const failing = neighborByExactTitle(page, '实体资源');
    await failing.getByRole('button', { name: '展开并加载' }).click();
    // Status chip must read 关系未知 (never a false zero); detail text may also contain the phrase.
    await expect(failing.locator('.combat-data-gux-neighbor-status.is-unknown')).toHaveText('关系未知');

    diag.assertClean('relationships');
  });

  test('copy-selected, create-child prefill, save receipt, downstream action', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/entities');

    const list = page.locator('.combat-data-gux-record-list');
    await list.focus();
    await list.press('ArrowDown');
    await page.getByRole('button', { name: '复制所选' }).click();
    await expect(page.getByText('新增 实体')).toBeVisible();
    await page.locator('#combat-data-field-entityId').fill('hero_ashe_copy');
    await page.locator('#combat-data-field-displayName').fill('艾希副本');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.combat-data-gux-success')).toContainText('currentRevision=');
    await expect(page.getByText(/已保存 .* · currentRevision=/)).toBeVisible();
    await expect(page.getByRole('button', { name: /创建下游：/ }).first()).toBeVisible();

    // Prefill create-child from selected parent via 创建下游.
    await openApp(page, '#/combat-data/entities');
    await list.focus();
    await list.press('ArrowDown');
    await neighborByExactTitle(page, '实体属性').getByRole('button', { name: '创建下游' }).click();
    await expect(page).toHaveURL(/combat-data\/entity-attributes/);
    await expect(page.getByText('新增 实体属性')).toBeVisible();
    // entityId is a reference Select (not a native input).
    await expect(page.locator('#combat-data-field-entityId')).toContainText('hero_ashe');

    diag.assertClean('copy/create/save');
  });

  test('409 and normal failure retain draft and modal', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/entities');

    await openEntityEditor(page, 'hero_ashe');
    await page.locator('#combat-data-field-displayName').fill('艾希-409草稿');

    mock.flags.conflictOnSave = true;
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(/版本冲突 409，草稿已保留/)).toBeVisible();
    await expect(page.getByText('编辑 实体')).toBeVisible();
    await expect(page.locator('#combat-data-field-displayName')).toHaveValue('艾希-409草稿');

    mock.flags.conflictOnSave = false;
    mock.flags.genericSaveFail = true;
    await page.locator('#combat-data-field-displayName').fill('艾希-500草稿');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('编辑 实体')).toBeVisible();
    await expect(page.locator('#combat-data-field-displayName')).toHaveValue('艾希-500草稿');

    diag.assertClean('save failure retention');
  });

  test('effect-step guided assistance and advanced raw fallback', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/effect-steps');

    await page.locator('.combat-data-gux-record').filter({ hasText: 'step_q_damage' }).dblclick();
    await expect(page.getByText('编辑 效果步骤')).toBeVisible();
    await expect(page.getByText('操作类型', { exact: true }).first()).toBeVisible();
    await expect(
      page.locator('.arco-form-item').filter({ hasText: '序列 ID' }).locator('.arco-select')
    ).toBeVisible();
    await expect(
      page.locator('.arco-form-item').filter({ hasText: '条件公式 Key' }).locator('.arco-select')
    ).toBeVisible();

    await page.getByRole('button', { name: '取消' }).click();
    await page.locator('.combat-data-gux-mode').getByText('高级逐表', { exact: true }).click();
    await page
      .locator('.arco-table-tr')
      .filter({ hasText: 'step_q_damage' })
      .getByRole('button', { name: '编辑' })
      .click();
    await expect(page.getByText('操作类型 ID').first()).toBeVisible();
    await expect(page.getByText('目标选择器类型 ID').first()).toBeVisible();

    diag.assertClean('effect-step assistance');
  });

  test('entity imageUri preserve / set / clear / cache / upload / 400 / 409', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/entities');

    // Untouched preserve: edit displayName only → PUT omits imageUri.
    await openEntityEditor(page, 'hero_ashe');
    await expect(page.getByText(/当前关联：character_ashe · 保留既有/)).toBeVisible();
    await page.locator('#combat-data-field-displayName').fill('艾希-保留图');
    mock.capturedPuts = [];
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.combat-data-gux-success')).toBeVisible();
    const preservePut = mock.capturedPuts.find((item) => item.url.includes('/entities/hero_ashe'));
    expect(preservePut?.body, 'preserve PUT must omit imageUri').not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(preservePut!.body, 'imageUri')).toBe(false);

    // Exact set with whitespace preserved in request body.
    await openEntityEditor(page, 'hero_ashe');
    const imageField = page.locator('.combat-image-ref[data-combat-field="imageUri"]');
    await imageField.locator('#combat-data-field-imageUri-custom').fill('  spaced_icon  ');
    await imageField.getByRole('button', { name: '应用精确值' }).click();
    mock.capturedPuts = [];
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.combat-data-gux-success')).toBeVisible();
    const setPut = mock.capturedPuts.find((item) => item.url.includes('/entities/hero_ashe'));
    expect(setPut?.body?.imageUri).toBe('  spaced_icon  ');

    // Clear → null.
    await openEntityEditor(page, 'hero_ashe');
    await page
      .locator('.combat-image-ref[data-combat-field="imageUri"]')
      .getByRole('button', { name: '清除关联' })
      .click();
    mock.capturedPuts = [];
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.combat-data-gux-success')).toBeVisible();
    const clearPut = mock.capturedPuts.find((item) => item.url.includes('/entities/hero_ashe'));
    expect(clearPut?.body?.imageUri).toBeNull();

    // Cache miss + refresh.
    await openEntityEditor(page, 'hero_vayne');
    await page.locator('#combat-data-field-imageUri-custom').fill('missing_cache_uri');
    await page
      .locator('.combat-image-ref[data-combat-field="imageUri"]')
      .getByRole('button', { name: '应用精确值' })
      .click();
    await expect(page.getByText('缓存未命中').first()).toBeVisible();
    await page.getByRole('button', { name: '刷新缓存预览' }).click();
    await expect(page.getByText(/缓存已刷新/)).toBeVisible();

    // Existing asset selection.
    await page.locator('#combat-data-field-imageUri-select').click();
    await page.locator('.arco-select-option').filter({ hasText: 'character_ashe' }).click();
    mock.capturedPuts = [];
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.combat-data-gux-success')).toBeVisible();
    const selectPut = mock.capturedPuts.find((item) => item.url.includes('/entities/hero_vayne'));
    expect(selectPut?.body?.imageUri).toBe('character_ashe');

    // Upload asset then explicit resource save.
    await openEntityEditor(page, 'hero_vayne');
    await page.locator('#combat-data-field-imageUri-upload-uri').fill('uploaded_icon');
    const uploadButton = page.getByRole('button', { name: '选择并上传资产' });
    await expect(uploadButton).toBeEnabled();
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      uploadButton.click()
    ]);
    await fileChooser.setFiles({
      name: 'dot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64')
    });
    await expect(page.getByText(/已上传资产「uploaded_icon」/)).toBeVisible();
    // Prove upload PUT happened before the separate resource save.
    expect(
      mock.capturedPuts.some((item) => item.url.includes('/images/uploaded_icon')),
      'expected admin images PUT for uploaded asset'
    ).toBe(true);
    mock.capturedPuts = [];
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.combat-data-gux-success')).toBeVisible();
    const uploadBind = mock.capturedPuts.find((item) => item.url.includes('/entities/hero_vayne'));
    expect(uploadBind?.body?.imageUri).toBe('uploaded_icon');

    // /imageUri 400 field error.
    await openEntityEditor(page, 'hero_ashe');
    await page.locator('#combat-data-field-imageUri-custom').fill('bad_uri');
    await page
      .locator('.combat-image-ref[data-combat-field="imageUri"]')
      .getByRole('button', { name: '应用精确值' })
      .click();
    mock.flags.imageUri400 = true;
    await page.getByRole('button', { name: '保存' }).click();
    await expect(
      page.locator('.arco-form-message, .arco-alert-content, .arco-message-content').filter({
        hasText: '400.VALIDATION'
      }).first()
    ).toBeVisible();
    await expect(page.getByText('编辑 实体')).toBeVisible();
    mock.flags.imageUri400 = false;

    // 409 retention with image edit.
    await page.locator('#combat-data-field-displayName').fill('艾希-图409');
    mock.flags.conflictOnSave = true;
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(/版本冲突 409，草稿已保留/)).toBeVisible();
    await expect(page.locator('#combat-data-field-displayName')).toHaveValue('艾希-图409');

    diag.assertClean('imageUri flows');
  });

  test('entity growth batch omits imageUri', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/entity-growth');

    // Entity Growth uses a labelled Select, not Arco Form.Item.
    const entitySelect = page.locator('#entity-growth-entity');
    await expect(entitySelect).toBeEnabled({ timeout: 30_000 });
    await entitySelect.click();
    await page.locator('.arco-select-option').filter({ hasText: 'hero_ashe' }).click();
    await expect(page.getByText(/currentRevision/)).toBeVisible();
    await expect(page.getByRole('button', { name: '保存曲线' }).first()).toBeEnabled({
      timeout: 30_000
    });

    mock.capturedPuts = [];
    await page.getByRole('button', { name: '保存曲线' }).first().click();
    await expect(page.getByText(/已保存属性曲线/)).toBeVisible();
    const batch = mock.capturedPuts.find((item) => item.url.includes(':batch'));
    expect(batch, 'expected entity :batch PUT').toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(batch!.body, 'imageUri')).toBe(false);

    diag.assertClean('entity-growth imageUri omit');
  });

  test('version no-current, inspect failure, publish success, readback-warning', async ({
    page
  }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);

    mock.flags.noCurrentVersion = true;
    await openApp(page, '#/workspace');
    await expect(
      page.getByText(
        '当前游戏尚无已发布版本（current version 为 404）。可直接填写 versionCode 进行首次发布。'
      )
    ).toBeVisible();

    // Inspect failure separation: hard current-version failure + soft combat-data warning.
    mock.flags.noCurrentVersion = false;
    mock.flags.failCurrentVersionHard = true;
    mock.flags.failCombatState = true;
    await page.getByRole('button', { name: '刷新当前状态' }).click();
    await expect(page.getByText(/读取当前版本失败/)).toBeVisible();
    await expect(
      page.getByText(/combat-data state 读取失败（不影响 current version 观察）/)
    ).toBeVisible();

    mock.flags.failCurrentVersionHard = false;
    mock.flags.failCombatState = false;
    await page.getByRole('button', { name: '刷新当前状态' }).click();
    await expect(page.getByText('1.0.0').first()).toBeVisible();

    const versionInput = page
      .locator('.arco-form-item')
      .filter({ hasText: 'versionCode' })
      .locator('input');
    await versionInput.fill('2.0.0-e2e');
    await page.getByRole('button', { name: '发布版本' }).click();
    await expect(page.getByText(/版本结果:.*已发布/)).toBeVisible();

    mock.flags.publishVerificationFail = true;
    await versionInput.fill('2.0.1-warn');
    await page.getByRole('button', { name: '发布版本' }).click();
    await expect(page.getByText(/已发布/)).toBeVisible();
    await expect(page.getByText(/发布核验：/)).toBeVisible();

    diag.assertClean('version publish');
  });

  test('save readback-warning disables downstream actions', async ({ page }) => {
    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/entities');
    await openEntityEditor(page, 'hero_ashe');
    await page.locator('#combat-data-field-displayName').fill('艾希-回读缺失');
    // Omit only on the post-save list refresh so the editor can still open the loaded row.
    mock.flags.omitSavedEntityOnList = true;
    await page.getByRole('button', { name: '保存' }).click();
    await expect(
      page.getByText('保存后未能在列表中回读到该记录；创建下游等后续操作已禁用，请刷新后手动定位。')
    ).toBeVisible();
    diag.assertClean('readback warning');
  });

  test('390px relationship context stacks; modal body scrolls with stable actions', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'responsive assertions are Mobile 390 only');

    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/combat-data/entities');

    const layout = page.locator('.combat-data-gux-layout');
    const columns = await layout.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(columns.split(' ').length, 'relationship layout must be one column at 390px').toBe(1);

    await openEntityEditor(page, 'hero_ashe');
    // Arco Modal mounts children under .arco-modal-content (not .arco-modal-body).
    const modal = page.locator('.arco-modal.combat-data-gux-modal');
    await expect(modal).toBeVisible();
    const content = modal.locator('.arco-modal-content');
    await expect(content).toBeVisible();
    const wrapper = page.locator('.arco-modal-wrapper').filter({ has: modal });
    const bodyScrollable = await Promise.all([
      content.evaluate((el) => {
        const style = getComputedStyle(el);
        return (
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll' ||
          el.scrollHeight > el.clientHeight + 1
        );
      }),
      wrapper.evaluate((el) => {
        const style = getComputedStyle(el);
        return (
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll' ||
          el.scrollHeight > el.clientHeight + 1
        );
      })
    ]).then(([contentScrolls, wrapperScrolls]) => contentScrolls || wrapperScrolls);
    expect(bodyScrollable, 'modal content/wrapper must be scrollable at 390px').toBe(true);
    await expect(modal.locator('.arco-modal-footer').getByRole('button', { name: '保存' })).toBeVisible();
    await expect(modal.locator('.arco-modal-footer').getByRole('button', { name: '取消' })).toBeVisible();

    // Controls/text must not overlap (footer vs content).
    const overlap = await modal.evaluate((root) => {
      const body = root.querySelector('.arco-modal-content');
      const footer = root.querySelector('.arco-modal-footer');
      if (!body || !footer) {
        return true;
      }
      const b = body.getBoundingClientRect();
      const f = footer.getBoundingClientRect();
      return b.bottom > f.top + 1;
    });
    expect(overlap, 'modal content must not overlap stable footer actions').toBe(false);

    await assertNoHorizontalViewportOverflow(page, 'mobile-390 entities');
    diag.assertClean('mobile-390');
  });
});

test.describe('mobile primary navigation', () => {
  test('Mobile 390: toggle opens nav, data-management link navigates and closes', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile 390', 'mobile navigation assertions are Mobile 390 only');

    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/overview');

    const toggle = page.getByRole('button', { name: '主导航' });
    const region = page.locator('#mobile-primary-navigation');

    await expect(toggle, 'mobile nav toggle must be visible').toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'mobile-primary-navigation');
    await expect(region, 'navigation region must start closed').toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region).toBeVisible();

    // data-management group stays expanded by default; combat-data groups may be collapsed.
    const versionLink = region.getByRole('link', { name: /版本发布/ });
    await expect(versionLink).toBeVisible();
    await versionLink.click();

    await expect(page).toHaveURL(/#\/workspace/);
    await expect(page.getByText('版本发布').first()).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region, 'route selection must close mobile navigation').toBeHidden();

    await assertNoHorizontalViewportOverflow(page, 'mobile-nav-390');
    diag.assertClean('mobile-nav-390');
  });

  test('Desktop: mobile nav toggle stays hidden', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'desktop toggle assertion is Desktop Chrome only');

    const mock = new MockApi();
    const diag = await prepare(page, mock);
    await openApp(page, '#/overview');

    await expect(page.getByRole('button', { name: '主导航' })).toBeHidden();
    await expect(page.locator('#mobile-primary-navigation')).toBeVisible();
    diag.assertClean('desktop-nav-toggle');
  });
});
