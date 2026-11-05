export const PASSWORD_RULE_HINT = '密码至少12个字符，最多72字节；中文等字符占用多个字节，空格也属于密码。';

export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** bcrypt 的输入边界与后端一致；这里只校验，不改写用户输入。 */
export function passwordValidationError(value: string): string | null {
  const characters = Array.from(value);
  if (value.includes('\0') || characters.some(character => character.length === 1
    && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff)) {
    return '密码包含不支持的字符。';
  }
  if (characters.length < 12 || !value.trim()) return '密码至少需要12个字符，且不能全部为空白。';
  if (passwordByteLength(value) > 72) return '密码超过72字节，请缩短后重试；中文等字符占用多个字节。';
  return null;
}
