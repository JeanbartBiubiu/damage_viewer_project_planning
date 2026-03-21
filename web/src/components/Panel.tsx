import type { PropsWithChildren, ReactNode } from 'react';

type PanelProps = PropsWithChildren<{
  title: string;
  kicker?: string;
  actions?: ReactNode;
  className?: string;
}>;

export function Panel({ title, kicker, actions, className, children }: PanelProps) {
  const panelClassName = className ? `panel ${className}` : 'panel';

  return (
    <section className={panelClassName}>
      <header className="panel-header">
        <div>
          {kicker ? <p className="panel-kicker">{kicker}</p> : null}
          <h2 className="panel-title">{title}</h2>
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
