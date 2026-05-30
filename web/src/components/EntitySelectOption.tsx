import type { ReactNode } from 'react';
import { ResourceImageThumb } from './ResourceImageThumb';

type EntitySelectOptionLabelProps = {
  primary: string;
  secondary?: string | null;
  meta?: string | null;
  imageSrc?: string | null;
  showImage?: boolean;
  imageAlt?: string;
  imageSize?: number;
};

type FilterableSelectOption = {
  value?: unknown;
  label?: unknown;
  searchText?: unknown;
  props?: {
    value?: unknown;
    label?: unknown;
    children?: unknown;
    searchText?: unknown;
  };
};

export type EntitySelectOptionRecord = {
  label: ReactNode;
  value: string;
  searchText: string;
  disabled?: boolean;
};

function normalizeSearchPart(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSearchPart(item)).filter(Boolean).join(' ');
  }
  if (value && typeof value === 'object' && 'props' in value) {
    const elementProps = (value as { props?: Record<string, unknown> }).props;
    if (elementProps && typeof elementProps === 'object') {
      return buildSelectSearchText(
        elementProps.children,
        elementProps.primary,
        elementProps.secondary,
        elementProps.meta,
        elementProps.label,
        elementProps.value
      );
    }
  }
  return '';
}

export function buildSelectSearchText(...parts: unknown[]): string {
  return parts.map(normalizeSearchPart).filter(Boolean).join(' ');
}

export function filterEntitySelectOption(inputValue: string, option?: unknown): boolean {
  const optionData = option as FilterableSelectOption | undefined;
  const searchText = buildSelectSearchText(
    optionData?.searchText,
    optionData?.value,
    optionData?.label,
    optionData?.props?.searchText,
    optionData?.props?.value,
    optionData?.props?.label,
    optionData?.props?.children
  ).toLowerCase();
  return searchText.includes(inputValue.trim().toLowerCase());
}

export function EntitySelectOptionLabel({
  primary,
  secondary,
  meta,
  imageSrc = null,
  showImage = false,
  imageAlt,
  imageSize = 22
}: EntitySelectOptionLabelProps) {
  const showSecondary = Boolean(secondary && secondary !== primary);
  const showMeta = Boolean(meta && meta !== primary && meta !== secondary);

  return (
    <span className={`entity-select-option${showImage ? '' : ' entity-select-option--text-only'}`}>
      {showImage ? <ResourceImageThumb src={imageSrc} alt={imageAlt ?? primary} size={imageSize} emptyLabel="" /> : null}
      <span className="entity-select-option-copy">
        <span className="entity-select-option-primary">{primary}</span>
        {showSecondary ? <span className="entity-select-option-secondary">{secondary}</span> : null}
        {showMeta ? <span className="entity-select-option-meta">{meta}</span> : null}
      </span>
    </span>
  );
}

type CreateEntitySelectOptionParams = {
  value: string;
  primary: string;
  secondary?: string | null;
  meta?: string | null;
  imageSrc?: string | null;
  showImage?: boolean;
  imageAlt?: string;
  imageSize?: number;
  disabled?: boolean;
};

export function createEntitySelectOption({
  value,
  primary,
  secondary,
  meta,
  imageSrc = null,
  showImage = false,
  imageAlt,
  imageSize = 22,
  disabled = false
}: CreateEntitySelectOptionParams): EntitySelectOptionRecord {
  return {
    value,
    disabled,
    searchText: buildSelectSearchText(value, primary, secondary, meta),
    label: (
      <EntitySelectOptionLabel
        primary={primary}
        secondary={secondary}
        meta={meta}
        imageSrc={imageSrc}
        showImage={showImage}
        imageAlt={imageAlt}
        imageSize={imageSize}
      />
    )
  };
}
