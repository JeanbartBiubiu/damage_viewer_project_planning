import { Select } from '@arco-design/web-react';
import { SimulationEntityOptionLabel } from './SimulationEntityOptionLabel';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';

export function SimulationEntitySelect({ label, value, options, loading, disabled, placeholder, loadImage, onChange }: {
  label: string; value: string; options: SimulationEntityOption[]; loading: boolean; disabled: boolean;
  placeholder: string; loadImage: SimulationImageLoader | null; onChange: (value: string) => void;
}) {
  return (
    <Select aria-label={label} className="simulation-entity-select" value={value || undefined} showSearch allowClear
      loading={loading} disabled={disabled} placeholder={placeholder}
      filterOption={(input, option) => String(option.props.extra ?? option.props.value)
        .toLowerCase().includes(input.trim().toLowerCase())}
      notFoundContent={loading ? '正在加载…' : '没有匹配项'}
      virtualListProps={{ height: 264, itemHeight: 48, isStaticItemHeight: false, threshold: 10 }}
      options={options.map(option => ({ value: option.key, extra: `${option.name} ${option.key} ${option.unavailableReason ?? ''}`,
        disabled: option.disabled,
        label: <SimulationEntityOptionLabel option={option} loadImage={loadImage} /> }))}
      renderFormat={(_, selectedValue) => {
        const option = options.find(row => row.key === selectedValue);
        return option ? <SimulationEntityOptionLabel option={option} loadImage={loadImage} selected /> : String(selectedValue ?? '');
      }}
      onChange={(next: string | undefined) => {
        if (!next || options.some(option => option.key === next && !option.disabled)) onChange(next ?? '');
      }} onClear={() => onChange('')} />
  );
}
