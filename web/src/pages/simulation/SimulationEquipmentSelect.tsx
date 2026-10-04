import { Select } from '@arco-design/web-react';
import { SimulationEntityOptionLabel } from './SimulationEntityOptionLabel';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';

export function SimulationEquipmentSelect({ label, value, options, loading, disabled, loadImage, onChange }: {
  label: string; value: string[]; options: SimulationEntityOption[]; loading: boolean; disabled: boolean;
  loadImage: SimulationImageLoader | null; onChange: (value: string[]) => void;
}) {
  return (
    <Select aria-label={label} className="simulation-equipment-select" mode="multiple" allowClear showSearch
      value={value} loading={loading} disabled={disabled} placeholder="可留空；搜索真实装备名称或标识"
      filterOption={(input, option) => String(option.props.extra ?? option.props.value)
        .toLowerCase().includes(input.trim().toLowerCase())}
      notFoundContent={loading ? '正在加载…' : '没有匹配项'}
      virtualListProps={{ height: 264, itemHeight: 48, isStaticItemHeight: false, threshold: 10 }}
      options={options.map(option => ({ value: option.key, extra: `${option.name} ${option.key}`,
        disabled: value.length >= 6 && !value.includes(option.key),
        label: <SimulationEntityOptionLabel option={option} loadImage={loadImage} /> }))}
      renderFormat={(_, selectedValue) => {
        const option = options.find(row => row.key === selectedValue);
        return option ? <SimulationEntityOptionLabel option={option} loadImage={loadImage} selected
          selectedLabel={`${option.name}（${option.key}）`} /> : String(selectedValue);
      }}
      onChange={(values: string[]) => onChange(values)} />
  );
}
