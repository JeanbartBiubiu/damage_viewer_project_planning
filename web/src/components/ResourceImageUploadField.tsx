import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import { useRef } from 'react';
import { ResourceImageThumb } from './ResourceImageThumb';

type ResourceImageUploadFieldProps = {
  src: string | null;
  alt: string;
  imageUri: string | null;
  uriPlaceholder: string;
  readOnly?: boolean;
  uploading?: boolean;
  error?: string | null;
  emptyLabel?: string;
  size?: number;
  buttonText?: string;
  helperText?: string;
  accept?: string;
  onUpload: (file: File) => Promise<void> | void;
};

const DEFAULT_HELPER_TEXT = '支持常见图片文件，上传时会先居中裁切并统一转成 64x64 图标。';

export function ResourceImageUploadField({
  src,
  alt,
  imageUri,
  uriPlaceholder,
  readOnly = false,
  uploading = false,
  error = null,
  emptyLabel = '未上传',
  size = 88,
  buttonText = '选择并上传图片',
  helperText = DEFAULT_HELPER_TEXT,
  accept = 'image/*',
  onUpload
}: ResourceImageUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="resource-image-field">
      <ResourceImageThumb src={src} alt={alt} size={size} emptyLabel={emptyLabel} />
      <div className="resource-image-field-copy">
        <Typography.Text>{imageUri ?? uriPlaceholder}</Typography.Text>
        <Typography.Text type="secondary">{helperText}</Typography.Text>
        {error ? <Alert type="error" content={error} style={{ marginTop: 8 }} /> : null}
        {!readOnly ? (
          <Space wrap style={{ marginTop: 4 }}>
            <Button
              type="secondary"
              disabled={!imageUri || uploading}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {buttonText}
            </Button>
          </Space>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              void onUpload(file);
            }
          }}
        />
      </div>
    </div>
  );
}
