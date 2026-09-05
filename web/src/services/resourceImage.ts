export const IMAGE_SOURCE_MAX_BYTES = 5_242_880;
export const IMAGE_SOURCE_MAX_DIMENSION = 4096;
export const IMAGE_OUTPUT_MAX_DIMENSION = 64;
export const IMAGE_OUTPUT_MAX_BYTES = 262_144;
export const IMAGE_JPEG_QUALITY = 0.92;

const IMAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

export type PreparedResourceImage = {
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  transformed: boolean;
};

export function normalizeImageKey(candidate: string): string | null {
  const trimmed = candidate.trim();
  return trimmed && IMAGE_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

export function imageKeyValidationMessage(candidate: string): string | null {
  if (normalizeImageKey(candidate) !== null) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return '请输入图片标识。';
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return '图片标识不能包含路径分隔符。';
  }
  return '图片标识须以字母或数字开头，仅含字母、数字、点、下划线或连字符，最长 128 个字符。';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('读取图片文件失败。'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('读取图片文件失败。'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('图片内容无法解码。'));
    image.onload = () => resolve(image);
    image.src = src;
  });
}

function decodedDataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) {
    throw new Error('图片内容不是有效的 Base64 数据。');
  }
  const payload = dataUrl.slice(comma + 1).replace(/\s/g, '');
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error('图片内容不是有效的 Base64 数据。');
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

function assertContentSignature(
  dataUrl: string,
  mimeType: 'image/png' | 'image/jpeg'
): void {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  let prefix: string;
  try {
    prefix = atob(payload.slice(0, 16));
  } catch {
    throw new Error('图片内容不是有效的 Base64 数据。');
  }
  const bytes = Array.from(prefix, (value) => value.charCodeAt(0));
  const isPng = bytes.length >= 8
    && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((mimeType === 'image/png' && !isPng) || (mimeType === 'image/jpeg' && !isJpeg)) {
    throw new Error('图片文件声明类型与真实内容不一致。');
  }
}

function assertSourceFile(file: File): 'image/png' | 'image/jpeg' {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new Error('仅支持 PNG 或 JPEG 图片。');
  }
  if (file.size <= 0) {
    throw new Error('图片文件不能为空。');
  }
  if (file.size > IMAGE_SOURCE_MAX_BYTES) {
    throw new Error('源图片不能超过 5 MB。');
  }
  return file.type as 'image/png' | 'image/jpeg';
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('图片宽高必须大于 0。');
  }
  if (width > IMAGE_SOURCE_MAX_DIMENSION || height > IMAGE_SOURCE_MAX_DIMENSION) {
    throw new Error('源图片宽高都不能超过 4096 像素。');
  }
}

function assertOutputSize(byteSize: number): void {
  if (byteSize < 1 || byteSize > IMAGE_OUTPUT_MAX_BYTES) {
    throw new Error('处理后的图片不能超过 262144 字节。');
  }
}

function encodeCanvas(
  image: HTMLImageElement,
  mimeType: 'image/png' | 'image/jpeg',
  sourceWidth: number,
  sourceHeight: number
): { imageBase64: string; width: number; height: number } {
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const outputSize = Math.min(cropSize, IMAGE_OUTPUT_MAX_DIMENSION);
  const sourceX = Math.max(0, (sourceWidth - cropSize) / 2);
  const sourceY = Math.max(0, (sourceHeight - cropSize) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理图片。');

  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputSize, outputSize);
  } else {
    context.clearRect(0, 0, outputSize, outputSize);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    outputSize,
    outputSize
  );

  const imageBase64 = mimeType === 'image/jpeg'
    ? canvas.toDataURL(mimeType, IMAGE_JPEG_QUALITY)
    : canvas.toDataURL(mimeType);
  if (!imageBase64.startsWith(`data:${mimeType};base64,`)) {
    throw new Error('浏览器未能生成要求的图片格式。');
  }
  return { imageBase64, width: outputSize, height: outputSize };
}

export async function prepareResourceImage(file: File): Promise<PreparedResourceImage> {
  const mimeType = assertSourceFile(file);
  const sourceDataUrl = await readFileAsDataUrl(file);
  if (!sourceDataUrl.startsWith(`data:${mimeType};base64,`)) {
    throw new Error('图片文件类型与读取结果不一致。');
  }
  assertContentSignature(sourceDataUrl, mimeType);
  const image = await loadImageElement(sourceDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  assertDimensions(sourceWidth, sourceHeight);

  if (sourceWidth <= IMAGE_OUTPUT_MAX_DIMENSION && sourceHeight <= IMAGE_OUTPUT_MAX_DIMENSION) {
    const byteSize = decodedDataUrlByteSize(sourceDataUrl);
    assertOutputSize(byteSize);
    return {
      imageBase64: sourceDataUrl,
      mimeType,
      byteSize,
      width: sourceWidth,
      height: sourceHeight,
      sourceWidth,
      sourceHeight,
      transformed: false
    };
  }

  const output = encodeCanvas(image, mimeType, sourceWidth, sourceHeight);
  const byteSize = decodedDataUrlByteSize(output.imageBase64);
  assertOutputSize(byteSize);
  return {
    ...output,
    mimeType,
    byteSize,
    sourceWidth,
    sourceHeight,
    transformed: true
  };
}
