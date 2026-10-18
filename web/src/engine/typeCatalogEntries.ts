/** 类型身份由作用域与原键组成；不同作用域的同名记录彼此独立。 */
export class TypeCatalogEntries {
  private readonly rows = new Map<string, { key: string; domain: string }>();
  constructor(entries: Iterable<readonly [string, string]> = []) {
    for (const [key, domain] of entries) this.set(key, domain);
  }
  set(key: string, domain: string): this {
    this.rows.set(JSON.stringify([domain, key]), { key, domain });
    return this;
  }
  *[Symbol.iterator](): IterableIterator<[string, string]> {
    for (const row of this.rows.values()) yield [row.key, row.domain];
  }
}
