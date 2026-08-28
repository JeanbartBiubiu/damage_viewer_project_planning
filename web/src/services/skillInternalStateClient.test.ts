import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillInternalState,
  deleteSkillInternalState,
  getSkillInternalState,
  listSkillInternalStates,
  updateSkillInternalState
} from './skillInternalStateClient';
import type {
  CreateSkillInternalStateRequest,
  SkillInternalState,
  SkillInternalStateSummary,
  UpdateSkillInternalStateRequest
} from '../types/skillInternalState';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const summary: SkillInternalStateSummary = {
  gameId: 'demo',
  skillKey: 'ashe_q',
  stateKey: 'focus_stacks',
  name: '专注层数',
  stateType: 'COUNTER',
  scope: 'SKILL',
  description: null,
  sortOrder: 10,
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z'
};

const detail: SkillInternalState = {
  ...summary,
  stateType: 'COUNTER',
  detail: {
    initialValueFormulaKey: 'zero',
    maxValueFormulaKey: 'focus_max_stacks'
  }
};

const createBody: CreateSkillInternalStateRequest = {
  stateKey: 'focus_stacks',
  name: '专注层数',
  stateType: 'COUNTER',
  scope: 'SKILL',
  description: null,
  sortOrder: 10,
  detail: {
    initialValueFormulaKey: 'zero',
    maxValueFormulaKey: 'focus_max_stacks'
  }
};

const updateBody: UpdateSkillInternalStateRequest = {
  name: '专注层数',
  stateType: 'COUNTER',
  scope: 'SKILL',
  description: null,
  sortOrder: 11,
  detail: {
    initialValueFormulaKey: 'zero',
    maxValueFormulaKey: 'focus_max_stacks'
  }
};

describe('skillInternalStateClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game, skill and state path segments with admin token', async () => {
    const listMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/internal-states'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, [summary]);
    });
    vi.stubGlobal('fetch', listMock);
    const listed = await listSkillInternalStates(
      'http://localhost:8080/',
      'demo arena',
      'active/q',
      'token'
    );
    expect(listed.status).toBe(200);
    expect(listed.data[0]).not.toHaveProperty('detail');
    expect(listed.data[0]?.stateType).toBe('COUNTER');

    const detailMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/skills/ashe_q/internal-states/focus%2Fstacks'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, detail);
    });
    vi.stubGlobal('fetch', detailMock);
    const loaded = await getSkillInternalState(
      'http://localhost:8080',
      'demo',
      'ashe_q',
      'focus/stacks',
      'token'
    );
    expect(loaded.data.detail).toEqual({
      initialValueFormulaKey: 'zero',
      maxValueFormulaKey: 'focus_max_stacks'
    });
  });

  it('sends POST, PUT without stateKey, and DELETE with expected statuses', async () => {
    const calls: Array<{ method: string; url: string; status: number; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
      calls.push({
        method,
        url: String(input),
        status,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(status, method === 'DELETE' ? null : detail);
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await createSkillInternalState(
      'http://localhost:8080',
      'demo arena',
      'active/q',
      'token',
      createBody
    );
    const updated = await updateSkillInternalState(
      'http://localhost:8080',
      'demo',
      'ashe_q',
      'focus/stacks',
      'token',
      updateBody
    );
    const deleted = await deleteSkillInternalState(
      'http://localhost:8080',
      'demo',
      'ashe_q',
      'focus/stacks',
      'token'
    );

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/internal-states'
    );
    expect(calls[1]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo/skills/ashe_q/internal-states/focus%2Fstacks'
    );
    expect(calls[2]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo/skills/ashe_q/internal-states/focus%2Fstacks'
    );
    expect(calls[0]?.body).toEqual(createBody);
    expect(calls[0]?.body).toMatchObject({ stateKey: 'focus_stacks' });
    expect(calls[1]?.body).toEqual(updateBody);
    expect(calls[1]?.body).not.toHaveProperty('stateKey');
    expect(calls[2]?.body).toBeNull();
  });
});
