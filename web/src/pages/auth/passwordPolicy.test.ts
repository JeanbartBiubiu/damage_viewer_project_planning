import { describe, expect, it } from 'vitest';
import { passwordByteLength, passwordValidationError } from './passwordPolicy';

describe('数据库 bcrypt 密码输入边界', () => {
  it('接收72字节英文并拒绝增加的第73字节，不截断后缀', () => {
    const maximum = 'aB9!'.repeat(18);
    expect(passwordValidationError(maximum)).toBeNull();
    expect(passwordValidationError(maximum + 'Z')).toContain('72字节');
  });
  it('按UTF-8字节限制中文与表情，按字符数计算下限', () => {
    const chinese = '安全密码中文四字'.repeat(3);
    expect(passwordByteLength(chinese)).toBe(72);
    expect(passwordValidationError(chinese)).toBeNull();
    expect(passwordValidationError(chinese + '中')).toContain('72字节');
    const emoji = '🔒🐱🦊🚀'.repeat(4) + '🔒🐱';
    expect(passwordByteLength(emoji)).toBe(72);
    expect(passwordValidationError(emoji)).toBeNull();
    expect(passwordValidationError(emoji + '🔒')).toContain('72字节');
    expect(passwordValidationError('🔒🐱🦊🚀🔒🐱')).toContain('12个字符');
  });
  it('保留首尾空白并拒绝全空白', () => {
    const input = '  fixture password  ';
    expect(passwordValidationError(input)).toBeNull();
    expect(passwordByteLength(input)).toBe(20);
    expect(input).toBe('  fixture password  ');
    expect(passwordValidationError(' '.repeat(12))).not.toBeNull();
  });
  it('拒绝数据库文本无法表示的空字符和孤立代理项', () => {
    expect(passwordValidationError('Fixture\0password')).toContain('不支持');
    expect(passwordValidationError('Fixture\ud800password')).toContain('不支持');
    expect(passwordValidationError('Fixture\udc00password')).toContain('不支持');
  });
});
