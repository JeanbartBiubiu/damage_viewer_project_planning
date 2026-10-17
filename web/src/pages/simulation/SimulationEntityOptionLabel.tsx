import { useEffect, useRef, useState } from 'react';
import { EntitySelectOptionLabel } from '../../components/EntitySelectOption';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';

export function SimulationEntityOptionLabel({ option, loadImage, selected = false, selectedLabel }: {
  option: SimulationEntityOption; loadImage: SimulationImageLoader | null; selected?: boolean; selectedLabel?: string;
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
    <span ref={element} className={`simulation-entity-option${selected ? ' simulation-entity-option--selected' : ''}`}
      title={option.unavailableDetails ?? option.unavailableReason} style={option.disabled ? { opacity: 0.6 } : undefined}>
      <EntitySelectOptionLabel primary={selected ? selectedLabel ?? option.name : option.name} secondary={selected ? null : option.key}
        meta={option.unavailableReason && (option.unavailableReason.length > 56 ? `${option.unavailableReason.slice(0, 55)}…` : option.unavailableReason)}
        imageSrc={src} imageAlt={option.name} imageSize={24} showImage />
    </span>
  );
}
