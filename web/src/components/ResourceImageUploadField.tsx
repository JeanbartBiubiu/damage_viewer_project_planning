import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import { useRef } from 'react';
import { ResourceImageThumb } from './ResourceImageThumb';

type ResourceImageUploadFieldProps = {
  src: string | null;
  alt: string;
  readOnly?: boolean;
  processing?: boolean;
  error?: string | null;
  emptyLabel?: string;
  size?: number;
  buttonText?: string;
  helperText?: string;
  metadataText?: string | null;
  onSelect: (file: File) => Promise<void> | void;
};

const DEFAULT_HELPER_TEXT = '仅支持 PNG/JPEG；大图会在浏览器中居中裁切并压缩到最大 64×64，小图保持原尺寸。';

export function ResourceImageUploadField({
  src,
  alt,
  readOnly = false,
  processing = false,
  error = null,
  emptyLabel = '未选择',
  size = 96,
  buttonText = src ? '重新选择图片' : '选择图片',
  helperText = DEFAULT_HELPER_TEXT,
  metadataText = null,
  onSelect
}: ResourceImageUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="resource-image-field">
      <ResourceImageThumb src={src} alt={alt} size={size} emptyLabel={emptyLabel} />
      <div className="resource-image-field-copy">
        <Typography.Text type="secondary">{helperText}</Typography.Text>
        {metadataText ? <Typography.Text>{metadataText}</Typography.Text> : null}
        {error ? <Alert type="error" content={error} style={{ marginTop: 4 }} /> : null}
        {!readOnly ? (
          <Space wrap style={{ marginTop: 4 }}>
            <Button
              type="secondary"
              disabled={processing}
              loading={processing}
              onClick={() => fileInputRef.current?.click()}
            >
              {processing ? '正在处理…' : buttonText}
            </Button>
          </Space>
        ) : null}
        <input
          ref={fileInputRef}
          aria-label="选择图片文件"
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: 'none' }}
          disabled={readOnly || processing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onSelect(file);
          }}
        />
      </div>
    </div>
  );
}
