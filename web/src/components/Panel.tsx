import type { PropsWithChildren, ReactNode } from 'react';
import { Space, Typography } from '@arco-design/web-react';

type PanelProps = PropsWithChildren<{
  title: string;
  kicker?: string;
  actions?: ReactNode;
  className?: string;
}>;

export function Panel({ title, kicker, actions, className, children }: PanelProps) {
  return (
    <section className={className ? `panel-shell ${className}` : 'panel-shell'}>
      <header className="panel-head">
        <Space direction="vertical" size={2}>
          {kicker ? <Typography.Text className="panel-kicker">{kicker}</Typography.Text> : null}
          <Typography.Title heading={4} className="panel-title">
            {title}
          </Typography.Title>
        </Space>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
