import { Button, Trigger } from '@arco-design/web-react';
import { IconApps, IconCheck, IconClose, IconDown, IconImageClose, IconSearch } from '@arco-design/web-react/icon';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';
import { useSimulationOptionImage } from './useSimulationOptionImage';
import './SimulationEquipmentSelect.css';

const equipmentLimit = 6;
const maxColumns = 6;
const minTileWidth = 72;
const gridGap = 8;

type EquipmentSelectProps = {
  id?: string;
  label: string;
  value: string[];
  options: SimulationEntityOption[];
  loading: boolean;
  disabled: boolean;
  loadImage: SimulationImageLoader | null;
  onChange: (value: string[]) => void;
};

function EquipmentIcon({ option, loadImage, eager }: {
  option: SimulationEntityOption; loadImage: SimulationImageLoader | null; eager?: boolean;
}) {
  const { element, src } = useSimulationOptionImage(option, loadImage, eager);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <span ref={element} className="equipment-picker-icon" aria-hidden="true">
    {src && src !== failedSrc ? <img src={src} alt="" onError={() => setFailedSrc(src)} /> : <IconImageClose />}
  </span>;
}

function EquipmentPicker({ id, label, options, value, duplicateNames, loadImage, onToggle, onClear, onClose, onLeave }: {
  id: string;
  label: string;
  options: SimulationEntityOption[];
  value: string[];
  duplicateNames: ReadonlySet<string>;
  loadImage: SimulationImageLoader | null;
  onToggle: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
  onLeave: (next: EventTarget | null) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [columns, setColumns] = useState(maxColumns);
  const searchTerm = query.trim().toLowerCase();
  const matches = useMemo(() => options.filter(option => `${option.name} ${option.key}`.toLowerCase().includes(searchTerm)), [options, searchTerm]);
  const selected = new Set(value);
  const full = value.length >= equipmentLimit;
  const activeIndex = Math.max(0, matches.findIndex(option => option.key === activeKey));
  const active = matches[activeIndex];
  const cellId = (key: string) => `${id}-${key}`;

  useLayoutEffect(() => {
    // 触屏展开时先展示装备，点搜索框后再打开软键盘。
    const initialFocus = window.matchMedia('(pointer: coarse)').matches ? panel : search;
    initialFocus.current?.focus({ preventScroll: true });
    const element = grid.current;
    if (!element) return;
    const updateColumns = () => {
      const count = Math.floor((element.clientWidth + gridGap) / (minTileWidth + gridGap));
      setColumns(Math.max(1, Math.min(maxColumns, count)));
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function revealItem(key: string) {
    const area = scrollArea.current;
    const cell = document.getElementById(cellId(key));
    if (!area || !cell) return;
    const { top, bottom } = cell.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    if (top < bounds.top + 3) area.scrollTop += top - bounds.top - 3;
    else if (bottom > bounds.bottom - 3) area.scrollTop += bottom - bounds.bottom + 3;
  }

  function focusItem(index: number) {
    const option = matches[index];
    if (!option) return;
    setActiveKey(option.key);
    revealItem(option.key);
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.target !== grid.current || !active || event.altKey || event.metaKey
      || event.ctrlKey && event.key !== 'Home' && event.key !== 'End') return;
    const rowStart = activeIndex - activeIndex % columns;
    const rowEnd = Math.min(rowStart + columns - 1, matches.length - 1);
    let next = activeIndex;
    switch (event.key) {
      case 'ArrowLeft': next = Math.max(rowStart, activeIndex - 1); break;
      case 'ArrowRight': next = Math.min(rowEnd, activeIndex + 1); break;
      case 'ArrowUp': next = activeIndex - columns; break;
      case 'ArrowDown':
        if (rowStart + columns < matches.length) next = Math.min(activeIndex + columns, matches.length - 1);
        break;
      case 'Home': next = event.ctrlKey ? 0 : rowStart; break;
      case 'End': next = event.ctrlKey ? matches.length - 1 : rowEnd; break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!event.repeat) onToggle(active.key);
        return;
      default: return;
    }
    if (next < 0 || next === activeIndex) return;
    event.preventDefault();
    focusItem(next);
  }

  const tracks = `repeat(${columns}, minmax(0, 1fr))`;
  const rows = Array.from({ length: Math.ceil(matches.length / columns) }, (_, row) =>
    matches.slice(row * columns, (row + 1) * columns));

  return <div id={id} ref={panel} tabIndex={-1} className="equipment-picker" role="dialog" aria-label={label}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) onLeave(event.relatedTarget);
    }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
    <div className="equipment-picker-header">
      <h2 className="equipment-picker-title">{label}</h2>
      <div className="equipment-picker-search">
        <IconSearch aria-hidden="true" />
        <input ref={search} type="search" aria-label="搜索装备" placeholder="搜索装备名称或编号" value={query}
          autoComplete="off" onChange={event => {
            setQuery(event.currentTarget.value);
            setActiveKey(null);
            scrollArea.current?.scrollTo({ top: 0 });
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || !['ArrowDown', 'Enter'].includes(event.key)) return;
            if (event.key === 'Enter' || active) event.preventDefault();
            if (active) {
              grid.current?.focus({ preventScroll: true });
              focusItem(activeIndex);
            }
          }} />
      </div>
    </div>

    <div className="equipment-picker-scroll" ref={scrollArea} data-large-catalog={options.length > columns * 4}>
      <div ref={grid} className="equipment-picker-grid" role="grid" aria-label="可选装备" aria-multiselectable="true"
        tabIndex={active ? 0 : -1} aria-activedescendant={active ? cellId(active.key) : undefined}
        style={{ gap: gridGap, gridTemplateColumns: tracks }} onKeyDown={navigate}
        onFocus={event => {
          if (active && event.target === event.currentTarget && !event.currentTarget.contains(event.relatedTarget)) {
            revealItem(active.key);
          }
        }}>
        {rows.map((row, rowIndex) => <div key={rowIndex} className="equipment-picker-row" role="row">
          {row.map(option => {
            const checked = selected.has(option.key);
            const unavailable = full && !checked;
            return <div key={option.key} id={cellId(option.key)} role="gridcell" aria-selected={checked} aria-disabled={unavailable}
              data-active={option.key === active?.key}>
              <button type="button" className="equipment-picker-tile" tabIndex={-1} aria-pressed={checked}
                aria-disabled={unavailable} data-equipment-key={option.key} title={`${option.name}（${option.key}）`}
                onClick={() => {
                  grid.current?.focus({ preventScroll: true });
                  setActiveKey(option.key);
                  revealItem(option.key);
                  onToggle(option.key);
                }}>
                <EquipmentIcon option={option} loadImage={loadImage} />
                <span className="equipment-picker-name">{option.name}</span>
                {duplicateNames.has(option.name) ? <span className="equipment-picker-key">{option.key}</span> : null}
                {checked ? <span className="equipment-picker-tick" aria-hidden="true"><IconCheck /></span> : null}
              </button>
            </div>;
          })}
        </div>)}
      </div>
      {!matches.length ? <p className="equipment-picker-empty" role="status">
        {searchTerm ? '没有匹配的装备' : '暂无装备'}
      </p> : null}
    </div>

    <div className="equipment-picker-footer">
      <span role="status">已选 {value.length} / {equipmentLimit}</span>
      <div className="equipment-picker-actions">
        <Button size="small" type="text" htmlType="button" disabled={!value.length} onClick={() => {
          search.current?.focus({ preventScroll: true });
          onClear();
        }}>清空已选</Button>
        <Button size="small" type="primary" htmlType="button" onClick={onClose}>完成</Button>
      </div>
    </div>
  </div>;
}

export function SimulationEquipmentSelect({ id, label, value, options, loading, disabled, loadImage, onChange }: EquipmentSelectProps) {
  const popupId = useId();
  const countId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const inactive = disabled || loading;
  const expanded = open && !inactive;
  const { byKey, duplicateNames } = useMemo(() => {
    const byKey = new Map<string, SimulationEntityOption>();
    const names = new Set<string>();
    const duplicateNames = new Set<string>();
    for (const item of options) {
      byKey.set(item.key, item);
      if (names.has(item.name)) duplicateNames.add(item.name);
      names.add(item.name);
    }
    return { byKey, duplicateNames };
  }, [options]);

  useEffect(() => { if (inactive) setOpen(false); }, [inactive]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function toggle(key: string) {
    if (inactive) return;
    if (value.includes(key)) onChange(value.filter(item => item !== key));
    else if (value.length < equipmentLimit && byKey.has(key)) onChange([...value, key]);
  }

  return <div className="simulation-equipment-select" role="group" aria-label={label}>
    <Trigger trigger="click" position="bl" className="equipment-picker-overlay" popupVisible={expanded} disabled={inactive}
      onVisibleChange={setOpen} escToClose={false} updateOnScroll duration={0}
      popupAlign={{ bottom: 8 }} boundaryDistance={{ left: 12, right: 12, top: 12, bottom: 12 }}
      popup={() => expanded ? <EquipmentPicker id={popupId} label={label} options={options} value={value}
        duplicateNames={duplicateNames} loadImage={loadImage} onToggle={toggle}
        onClear={() => onChange([])} onClose={close} onLeave={next => {
          if (next && next !== trigger.current) setOpen(false);
        }} /> : null}>
      <button type="button" id={id} ref={trigger} className="equipment-select-trigger" aria-label={label}
        aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? popupId : undefined}
        aria-describedby={countId} disabled={inactive}>
        <IconApps aria-hidden="true" />
        <span className="equipment-select-trigger-text">{loading ? '正在读取装备…' : '选择装备'}</span>
        <span className="equipment-select-count" id={countId}>{value.length} / {equipmentLimit}</span>
        <IconDown aria-hidden="true" className="equipment-select-chevron" />
      </button>
    </Trigger>
    {value.length ? <ul className="equipment-select-selected" aria-label="已选装备">
      {value.map(key => {
        const item = byKey.get(key);
        const name = item?.name ?? key;
        const title = `${name}（${key}）`;
        return <li key={key} data-equipment-key={key} title={title}>
          {item ? <EquipmentIcon option={item} loadImage={loadImage} eager /> : null}
          <span className="equipment-select-selected-name">{name}</span>
          <button type="button" aria-label={`移除 ${title}`} disabled={inactive} onClick={() => {
            toggle(key);
            trigger.current?.focus({ preventScroll: true });
          }}><IconClose aria-hidden="true" /></button>
        </li>;
      })}
    </ul> : null}
  </div>;
}
