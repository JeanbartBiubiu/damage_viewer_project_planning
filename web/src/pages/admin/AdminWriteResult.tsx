import { Alert, Typography } from '@arco-design/web-react';
import type { LoadState } from '../../types/api';

type AdminWriteResultProps = {
  title: string;
  state: LoadState;
  error: string | null;
  success: string | null;
  idleHint?: string;
};

export function AdminWriteResult({ title, state, error, success, idleHint }: AdminWriteResultProps) {
  if (error) {
    return <Alert type="error" content={`${title}: ${error}`} />;
  }

  if (success) {
    return <Alert type="success" content={`${title}: ${success}`} />;
  }

  if (state === 'loading') {
    return <Alert type="info" content={`${title}: 处理中...`} />;
  }

  if (idleHint) {
    return <Typography.Text type="secondary">{idleHint}</Typography.Text>;
  }

  return null;
}
