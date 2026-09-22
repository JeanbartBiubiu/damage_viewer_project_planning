import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  field: string;
  active: boolean;
  children: ReactNode;
};

export function AuthoringFieldAnchor({ field, active, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    ref.current.scrollIntoView({ block: 'nearest' });
    const focusable = ref.current.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
  }, [active]);
  return (
    <div
      ref={ref}
      data-authoring-field={field}
      className={active ? 'authoring-field-active' : undefined}
    >
      {children}
    </div>
  );
}
