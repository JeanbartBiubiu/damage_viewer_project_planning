import { Empty, Typography } from '@arco-design/web-react';

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <Empty
      description={
        <div className="empty-copy">
          <Typography.Title heading={5} className="empty-title">
            {title}
          </Typography.Title>
          <Typography.Text className="empty-description">{description}</Typography.Text>
        </div>
      }
    />
  );
}
