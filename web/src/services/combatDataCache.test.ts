import { describe, expect, it } from 'vitest';
import {
  buildCombatDataApiGameScopeKey,
  buildCombatDataCacheKey,
  combatDataCacheDescriptor,
  normalizeCombatDataApiNamespace
} from './combatDataCache';

describe('normalizeCombatDataApiNamespace', () => {
  it('normalizes equivalent localhost default-port forms to the same namespace', () => {
    const a = normalizeCombatDataApiNamespace('http://LOCALHOST:80/');
    const b = normalizeCombatDataApiNamespace('http://localhost');
    const c = normalizeCombatDataApiNamespace('http://localhost/');

    expect(a).toBe('http://localhost');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps non-default ports distinct', () => {
    const port8080 = normalizeCombatDataApiNamespace('http://localhost:8080');
    const port8082 = normalizeCombatDataApiNamespace('http://localhost:8082/');

    expect(port8080).toBe('http://localhost:8080');
    expect(port8082).toBe('http://localhost:8082');
    expect(port8080).not.toBe(port8082);
  });

  it('preserves a safe lowercase fallback for non-URL strings', () => {
    expect(normalizeCombatDataApiNamespace('not a url/')).toBe('not a url');
  });
});

describe('combat-data cache key helpers', () => {
  it('builds namespaced cache keys that never collide across backends', () => {
    const ns8080 = normalizeCombatDataApiNamespace('http://localhost:8080');
    const ns8082 = normalizeCombatDataApiNamespace('http://localhost:8082');

    const key8080 = buildCombatDataCacheKey(ns8080, 'lol', 13);
    const key8082 = buildCombatDataCacheKey(ns8082, 'lol', 13);

    expect(key8080).toBe('http://localhost:8080::lol::13');
    expect(key8082).toBe('http://localhost:8082::lol::13');
    expect(key8080).not.toBe(key8082);
  });

  it('builds api+game scope keys for exact invalidation', () => {
    const ns = normalizeCombatDataApiNamespace('http://localhost:8080');
    expect(buildCombatDataApiGameScopeKey(ns, 'lol')).toBe('http://localhost:8080::lol');
  });

  it('bumps IndexedDB to version 2 for namespaced records', () => {
    expect(combatDataCacheDescriptor.dbVersion).toBe(2);
  });
});
