import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import { mapImageDraftErrors, validateImageDraft } from './imageForm';

describe('imageForm', () => {
  it('accepts a create draft with a prepared image', () => {
    expect(validateImageDraft({
      imageKey: 'icon_test',
      name: '测试图片',
      description: '',
      enabled: true
    }, true, true, true)).toEqual({});
  });

  it('locates key, name, description and missing content errors', () => {
    expect(validateImageDraft({
      imageKey: '_bad',
      name: ' ',
      description: 'x'.repeat(2001),
      enabled: true
    }, true, true, false)).toMatchObject({
      imageKey: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      image: expect.any(String)
    });
  });

  it('maps server imageBase64 issues to the file area', () => {
    const error = new ApiRequestError('invalid', 400, '400.IMAGE_CONTENT_INVALID', {
      fieldIssues: [{ field: 'imageBase64', code: 'INVALID', message: '内容不合法' }]
    });
    expect(mapImageDraftErrors(error)).toEqual({ image: '内容不合法' });
  });
});
