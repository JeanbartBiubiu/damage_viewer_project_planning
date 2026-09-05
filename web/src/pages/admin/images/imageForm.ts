import { imageFieldIssues } from '../../../services/imageClient';
import { imageKeyValidationMessage } from '../../../services/resourceImage';

export type ImageDraft = {
  imageKey: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type ImageDraftErrors = Partial<Record<keyof ImageDraft | 'image', string>>;

export function validateImageDraft(
  draft: ImageDraft,
  includeKey: boolean,
  requireImage: boolean,
  hasPreparedImage: boolean
): ImageDraftErrors {
  const errors: ImageDraftErrors = {};
  if (includeKey) {
    const keyMessage = imageKeyValidationMessage(draft.imageKey);
    if (keyMessage) errors.imageKey = keyMessage;
  }
  if (!draft.name.trim()) {
    errors.name = '图片名称不能为空。';
  } else if (draft.name.trim().length > 100) {
    errors.name = '图片名称不能超过 100 个字符。';
  }
  if (draft.description.trim().length > 2000) {
    errors.description = '图片说明不能超过 2000 个字符。';
  }
  if (requireImage && !hasPreparedImage) {
    errors.image = '请选择图片文件。';
  }
  return errors;
}

export function mapImageDraftErrors(error: unknown): ImageDraftErrors {
  const errors: ImageDraftErrors = {};
  for (const issue of imageFieldIssues(error)) {
    if (issue.field === 'imageKey' || issue.field === 'name' || issue.field === 'description' || issue.field === 'enabled') {
      errors[issue.field] = issue.message;
    } else if (issue.field === 'imageBase64' || issue.field === 'image') {
      errors.image = issue.message;
    }
  }
  return errors;
}
