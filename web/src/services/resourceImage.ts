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
