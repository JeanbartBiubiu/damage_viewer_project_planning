import { EntitySelectOptionLabel } from '../../components/EntitySelectOption';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';
import { useSimulationOptionImage } from './useSimulationOptionImage';

export function SimulationEntityOptionLabel({ option, loadImage, selected = false, selectedLabel }: {
  option: SimulationEntityOption; loadImage: SimulationImageLoader | null; selected?: boolean; selectedLabel?: string;
}) {
  const { element, src } = useSimulationOptionImage(option, loadImage, selected);
  return (
    <span ref={element} className={`simulation-entity-option${selected ? ' simulation-entity-option--selected' : ''}`}>
      <EntitySelectOptionLabel primary={selected ? selectedLabel ?? option.name : option.name} secondary={selected ? null : option.key}
        imageSrc={src} imageAlt={option.name} imageSize={24} showImage />
    </span>
  );
}
