import { Button, Card, Space, Tag, Typography } from '@arco-design/web-react';
import type { TypeTreeNode } from '../services/typeCatalog';
import type { TypeDefinition } from '../types/api';

type TypesTreeViewProps = {
  roots: TypeTreeNode[];
  onView: (type: TypeDefinition) => void;
  onEdit: (type: TypeDefinition) => void;
  emptyText?: string;
};

export function TypesTreeView({ roots, onView, onEdit, emptyText = '暂无类型数据。' }: TypesTreeViewProps) {
  if (roots.length === 0) {
    return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {roots.map((root) => (
        <TypeNodeCard key={root.type.typeId} node={root} depth={0} onView={onView} onEdit={onEdit} />
      ))}
    </Space>
  );
}

function TypeNodeCard({
  node,
  depth,
  onView,
  onEdit
}: {
  node: TypeTreeNode;
  depth: number;
  onView: (type: TypeDefinition) => void;
  onEdit: (type: TypeDefinition) => void;
}) {
  return (
    <div style={{ marginLeft: depth * 24 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <Space wrap>
              <Typography.Text bold>{node.type.name ?? '未命名类型'}</Typography.Text>
              <Tag color="gray">typeId: {node.type.typeId}</Tag>
              {node.parentTypeId ? <Tag color="arcoblue">parent: {node.parentTypeId}</Tag> : <Tag color="green">根节点</Tag>}
            </Space>
            {node.type.description ? (
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                {node.type.description}
              </Typography.Paragraph>
            ) : null}
          </div>
          <Space>
            <Button size="mini" onClick={() => onView(node.type)}>
              查看
            </Button>
            <Button type="primary" size="mini" onClick={() => onEdit(node.type)}>
              编辑
            </Button>
          </Space>
        </div>
      </Card>

      {node.children.length > 0 ? (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
          {node.children.map((child) => (
            <TypeNodeCard key={child.type.typeId} node={child} depth={depth + 1} onView={onView} onEdit={onEdit} />
          ))}
        </Space>
      ) : null}
    </div>
  );
}