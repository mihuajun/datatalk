"use client";

import { Children, isValidElement, useState, type SelectHTMLAttributes, type ReactElement, type ChangeEvent } from "react";

// HTML controls only: embedded browsers may not implement native select popups.
export function WebViewSelect({ children, value, onChange, disabled, className, id, title, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const options = Children.toArray(children).filter(isValidElement) as ReactElement<{ value: string | number; children: React.ReactNode; disabled?: boolean }>[];
  const selected = options.find(option => String(option.props.value) === String(value));
  return <div className="relative min-w-0 flex-1">
    <button type="button" id={id} role="combobox" aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-expanded={open} aria-controls={`${id || props['aria-label'] || 'select'}-options`} title={title} disabled={disabled} className={`${className || ""} flex w-full items-center justify-between gap-2 text-left`} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } if (event.key === 'Escape') setOpen(false); }}>
      <span className="truncate">{selected?.props.children || "请选择"}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && !disabled && <div id={`${id || props['aria-label'] || 'select'}-options`} role="listbox" className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-48 overflow-y-auto rounded-md border border-[#DDE5F0] bg-white p-1 shadow-lg">
      {options.map(option => <button type="button" role="option" aria-selected={String(option.props.value) === String(value)} disabled={option.props.disabled} key={String(option.props.value)} className="block w-full rounded px-2 py-2 text-left text-xs text-[#526174] hover:bg-[#EDF3FF] focus:bg-[#EDF3FF] disabled:opacity-50" onClick={() => { onChange?.({ target: { value: String(option.props.value) } } as ChangeEvent<HTMLSelectElement>); setOpen(false); }}>{option.props.children}</button>)}
    </div>}
  </div>;
}
