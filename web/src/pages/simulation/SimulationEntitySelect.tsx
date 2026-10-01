import { Select } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { EntitySelectOptionLabel } from '../../components/EntitySelectOption';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';

function OptionLabel({ option, loadImage, selected = false }: {
  option: SimulationEntityOption; loadImage: SimulationImageLoader | null; selected?: boolean;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ loader: SimulationImageLoader; key: string; src: string | null } | null>(null);
  const key = `${option.kind}:${option.key}`;
  useEffect(() => {
    if (!loadImage || !element.current) return;
    let active = true;
    let requested = false;
    const read = () => {
      if (requested) return;
      requested = true;
      void loadImage(option).then(src => { if (active) setImage({ loader: loadImage, key, src }); });
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { read(); observer.disconnect(); }
    });
    if (selected) read();
    else observer.observe(element.current);
    return () => { active = false; observer.disconnect(); };
  }, [loadImage, option, key, selected]);
  const src = image?.loader === loadImage && image?.key === key ? image.src : null;
  return (
    <span ref={element} className={`simulation-entity-option${selected ? ' simulation-entity-option--selected' : ''}`}>
      <EntitySelectOptionLabel primary={option.name} secondary={selected ? null : option.key}
        imageSrc={src} imageAlt={option.name} imageSize={24} showImage />
    </span>
  );
}

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
      options={options.map(option => ({ value: option.key, extra: `${option.name} ${option.key}`,
        label: <OptionLabel option={option} loadImage={loadImage} /> }))}
      renderFormat={(_, selectedValue) => {
        const option = options.find(row => row.key === selectedValue);
        return option ? <OptionLabel option={option} loadImage={loadImage} selected /> : null;
      }}
      onChange={(next: string | undefined) => onChange(next ?? '')} onClear={() => onChange('')} />
  );
}
