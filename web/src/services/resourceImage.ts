/** Stable opaque image asset URI segment used for admin upload routing only. */
const IMAGE_ASSET_URI_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Normalize a standalone image asset URI for upload routing.
 * Accepts a single opaque path segment; never a combat-data resource relation.
 */
export function normalizeImageAssetUri(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed || !IMAGE_ASSET_URI_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Chinese validation message for UI when normalizeImageAssetUri rejects the candidate. */
export function imageAssetUriValidationMessage(candidate: string): string | null {
  if (normalizeImageAssetUri(candidate) !== null) {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return '请输入图片 URI。';
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return '图片 URI 不能包含路径分隔符，请只填写稳定的单段资源标识。';
  }

  return '图片 URI 须为稳定单段标识：以字母或数字开头，仅含字母、数字、点、下划线或连字符，最长 128 个字符。';
}

export function buildHeroImageUri(heroId: string): string | null {
  const normalizedId = heroId.trim();
  return normalizedId ? `character_${normalizedId}` : null;
}

export function buildItemImageUri(itemId: string): string | null {
  const normalizedId = itemId.trim();
  return normalizedId ? `item_${normalizedId}` : null;
}

export function buildAttributeImageUri(attrKey: string): string | null {
  const normalizedKey = attrKey.trim();
  return normalizedKey ? `attribute_${normalizedKey}` : null;
}

// Skill 自身无独立图片资源；当 ownerType 为 hero/item 时复用 owner 的图片 URI。
export function buildOwnerImageUri(ownerType: string | null | undefined, ownerId: string | null | undefined): string | null {
  const type = (ownerType ?? '').trim();
  const id = (ownerId ?? '').trim();
  if (!type || !id) {
    return null;
  }
  if (type === 'hero') {
    return buildHeroImageUri(id);
  }
  if (type === 'item') {
    return buildItemImageUri(id);
  }
  return null;
}

const DEFAULT_RESOURCE_IMAGE_SIZE = 64;
const DEFAULT_JPEG_QUALITY = 0.92;

type ResourceImageTransformOptions = {
  size?: number;
  mimeType?: string;
  quality?: number;
};

function readFileAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('请选择图片文件。'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error('读取图片文件失败。'));
    };

    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
        reject(new Error('图片文件转换失败，请重试。'));
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

    image.onerror = () => {
      reject(new Error('图片加载失败，请重试。'));
    };

    image.onload = () => {
      resolve(image);
    };

    image.src = src;
  });
}

function resolveOutputMimeType(file: File, preferredMimeType?: string): string {
  if (preferredMimeType) {
    return preferredMimeType;
  }

  if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
    return 'image/jpeg';
  }

  return 'image/png';
}

function toCanvasDataUrl(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const supportsQuality = mimeType === 'image/jpeg' || mimeType === 'image/webp';
      const dataUrl = supportsQuality ? canvas.toDataURL(mimeType, quality) : canvas.toDataURL(mimeType);
      if (!dataUrl.startsWith('data:image/')) {
        reject(new Error('图片文件转换失败，请重试。'));
        return;
      }
      resolve(dataUrl);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('图片转换失败。'));
    }
  });
}

/**
 * Validate an upload-route asset URI and center-crop/encode the file to a data URL.
 * Strict route-URI rules are unchanged — binding editors must not use this for combat-data imageUri.
 */
export async function prepareResourceImageAssetUpload(
  uriCandidate: string,
  file: File,
  options: ResourceImageTransformOptions = {}
): Promise<{ uri: string; imageBase64: string }> {
  const uri = normalizeImageAssetUri(uriCandidate);
  if (!uri) {
    const message = imageAssetUriValidationMessage(uriCandidate) ?? '请输入有效的图片 URI。';
    throw new Error(message);
  }
  const imageBase64 = await readImageFileAsDataUrl(file, options);
  return { uri, imageBase64 };
}

export async function readImageFileAsDataUrl(
  file: File,
  options: ResourceImageTransformOptions = {}
): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);

  const size = options.size ?? DEFAULT_RESOURCE_IMAGE_SIZE;
  const mimeType = resolveOutputMimeType(file, options.mimeType);
  const quality = options.quality ?? DEFAULT_JPEG_QUALITY;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.max(0, (sourceWidth - cropSize) / 2);
  const sourceY = Math.max(0, (sourceHeight - cropSize) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前环境无法处理图片。');
  }

  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
  } else {
    context.clearRect(0, 0, size, size);
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

  return toCanvasDataUrl(canvas, mimeType, quality);
}
