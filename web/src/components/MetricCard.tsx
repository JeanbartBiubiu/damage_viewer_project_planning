import { Typography } from '@arco-design/web-react';

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
};

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <article className="metric-tile">
      <Typography.Text className="metric-label">{label}</Typography.Text>
      <Typography.Title heading={4} className="metric-value">
        {value}
      </Typography.Title>
      {hint ? <Typography.Paragraph className="metric-hint">{hint}</Typography.Paragraph> : null}
    </article>
  );
}
