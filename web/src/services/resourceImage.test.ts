import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_JPEG_QUALITY,
  IMAGE_SOURCE_MAX_BYTES,
  imageKeyValidationMessage,
  normalizeImageKey,
  prepareResourceImage
} from './resourceImage';

type FakeFile = File & { dataUrl: string };

let dimensions = { width: 32, height: 20 };
let encodedDataUrl = 'data:image/png;base64,AQIDBA==';
const drawImage = vi.fn();
const toDataURL = vi.fn(() => encodedDataUrl);

function file(type: string, dataUrl: string, size = 4): FakeFile {
  return { type, size, name: 'icon', dataUrl } as FakeFile;
}

class FakeFileReader {
  error: Error | null = null;
  result: string | ArrayBuffer | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  readAsDataURL(value: FakeFile) {
    this.result = value.dataUrl;
    this.onload?.();
  }
}

class FakeImage {
  naturalWidth = dimensions.width;
  naturalHeight = dimensions.height;
  width = dimensions.width;
  height = dimensions.height;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  set src(_value: string) {
    this.onload?.();
  }
}

describe('resourceImage', () => {
  beforeEach(() => {
    dimensions = { width: 32, height: 20 };
    encodedDataUrl = 'data:image/png;base64,AQIDBA==';
    drawImage.mockClear();
    toDataURL.mockClear();
    vi.stubGlobal('FileReader', FakeFileReader);
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '',
          fillRect: vi.fn(),
          clearRect: vi.fn(),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
          drawImage
        }),
        toDataURL
      })
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('validates the stable image key without inferring a business prefix', () => {
    expect(normalizeImageKey('  icon.any_1-2  ')).toBe('icon.any_1-2');
    expect(normalizeImageKey('foo/bar')).toBeNull();
    expect(normalizeImageKey('_bad')).toBeNull();
    expect(imageKeyValidationMessage('')).toBe('请输入图片标识。');
    expect(imageKeyValidationMessage('foo/bar')).toContain('路径分隔符');
  });

  it('keeps a compliant small PNG byte-for-byte and does not create a canvas', async () => {
    const source = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await prepareResourceImage(file('image/png', source, 8));
    expect(result).toMatchObject({
      imageBase64: source,
      width: 32,
      height: 20,
      byteSize: 8,
      transformed: false
    });
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('center-crops a large PNG by its short side and limits output to 64 square pixels', async () => {
    dimensions = { width: 160, height: 96 };
    const result = await prepareResourceImage(file('image/png', 'data:image/png;base64,iVBORw0KGgo='));
    expect(result).toMatchObject({ width: 64, height: 64, sourceWidth: 160, sourceHeight: 96, transformed: true });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 32, 0, 96, 96, 0, 0, 64, 64);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('uses the short side below 64 and fixed JPEG quality', async () => {
    dimensions = { width: 120, height: 40 };
    encodedDataUrl = 'data:image/jpeg;base64,AQIDBA==';
    const result = await prepareResourceImage(file('image/jpeg', 'data:image/jpeg;base64,/9j/AA=='));
    expect(result).toMatchObject({ width: 40, height: 40, transformed: true, mimeType: 'image/jpeg' });
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', IMAGE_JPEG_QUALITY);
  });

  it('rejects unsupported, empty, oversized and over-dimension source files', async () => {
    await expect(prepareResourceImage(file('image/gif', 'data:image/gif;base64,AQID'))).rejects.toThrow('PNG 或 JPEG');
    await expect(prepareResourceImage(file('image/png', 'data:image/png;base64,iVBORw0KGgo=', 0))).rejects.toThrow('不能为空');
    await expect(prepareResourceImage(
      file('image/png', 'data:image/png;base64,iVBORw0KGgo=', IMAGE_SOURCE_MAX_BYTES + 1)
    )).rejects.toThrow('5 MB');
    dimensions = { width: 4097, height: 20 };
    await expect(prepareResourceImage(file('image/png', 'data:image/png;base64,iVBORw0KGgo='))).rejects.toThrow('4096');
    await expect(prepareResourceImage(file('image/jpeg', 'data:image/jpeg;base64,iVBORw0KGgo='))).rejects.toThrow('真实内容');
  });

  it('rejects a transformed payload above the backend byte limit', async () => {
    dimensions = { width: 128, height: 128 };
    encodedDataUrl = `data:image/png;base64,${'A'.repeat(349_528)}`;
    await expect(prepareResourceImage(file('image/png', 'data:image/png;base64,iVBORw0KGgo='))).rejects.toThrow('262144');
  });
});
