import { Card, Space, Tag, Typography } from '@arco-design/web-react';
import {
  adminResourceNavigationItems,
  type AdminResourceKind,
  type AdminSnapshot,
  getAdminResourceRows
} from './adminResourceConfig';

type AdminResourceNavProps = {
  activeResource: AdminResourceKind;
  snapshot: AdminSnapshot;
  onSelectResource: (kind: AdminResourceKind) => void;
};

export function AdminResourceNav({ activeResource, snapshot, onSelectResource }: AdminResourceNavProps) {
  return (
    <div className="admin-resource-nav">
      {adminResourceNavigationItems.map((item) => {
        const count = getAdminResourceRows(snapshot, item.id).length;
        const isActive = activeResource === item.id;

        return (
          <Card
            key={item.id}
            size="small"
            hoverable
            className={isActive ? 'admin-resource-card is-active' : 'admin-resource-card'}
            onClick={() => onSelectResource(item.id)}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space align="center" size={8} wrap>
                <Typography.Title heading={6} style={{ margin: 0 }}>
                  {item.label}
                </Typography.Title>
                <Tag color={isActive ? 'arcoblue' : 'gray'}>{count}</Tag>
              </Space>
              <Typography.Text type="secondary">{item.summary}</Typography.Text>
              <Typography.Text className="admin-resource-card-hint">#/admin/{item.hashSegment}</Typography.Text>
            </Space>
          </Card>
        );
      })}
    </div>
  );
}

