import { useEffect, useRef, useState } from 'react';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';

export function useSimulationOptionImage(option: SimulationEntityOption, loadImage: SimulationImageLoader | null, eager = false) {
  const element = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ loader: SimulationImageLoader; key: string; src: string | null } | null>(null);
  const key = `${option.kind}:${option.key}`;
  useEffect(() => {
    if (!loadImage || !element.current) return;
    let active = true;
    const read = () => {
      void loadImage(option).then(src => { if (active) setImage({ loader: loadImage, key, src }); });
    };
    if (eager) {
      read();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        read();
      }
    });
    observer.observe(element.current);
    return () => { active = false; observer.disconnect(); };
  }, [loadImage, option, key, eager]);
  return { element, src: image?.loader === loadImage && image?.key === key ? image.src : null };
}
