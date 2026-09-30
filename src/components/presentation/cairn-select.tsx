"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./cairn-select.module.css";

export type CairnSelectOption = Readonly<{ value: string; label: string; disabled?: boolean }>;

/** A select-only combobox. Focus stays on its trigger while the list is open. */
export function CairnSelect({ id, label, value, options, onValueChange, disabled = false, className = "" }: {
  id?: string;
  label: string;
  value: string;
  options: readonly CairnSelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-options`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [placement, setPlacement] = useState({ above: false, height: 280 });
  const selected = options.find(option => option.value === value);
  const enabled = options.filter(option => !option.disabled);
  const activeIndex = options.findIndex(option => option.value === active && !option.disabled);

  function show() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) {
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      setPlacement({ above: below < 200 && above > below, height: Math.max(80, Math.min(280, below < 200 && above > below ? above : below)) });
    }
    setActive(enabled.some(option => option.value === value) ? value : enabled[0]?.value ?? "");
    search.current = { text: "", at: 0 };
    setOpen(true);
  }

  function choose(next: string) {
    if (!enabled.some(option => option.value === next)) return;
    onValueChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === "Tab") { setOpen(false); return; }
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (open) choose(active); else show();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) show();
      const index = enabled.findIndex(option => option.value === (open ? active : value));
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      if (enabled[next]) setActive(enabled[next].value);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - search.current.at < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
      if (!open) show();
      search.current = { text, at: now };
      const query = [...text].every(letter => letter === text[0]) ? text[0] : text;
      const start = query.length === 1 ? enabled.findIndex(option => option.value === active) + 1 : 0;
      const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
      const match = ordered.find(option => option.label.toLocaleLowerCase().startsWith(query));
      if (match) setActive(match.value);
    }
  }

  return <div ref={root} className={`${styles.root} ${className}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} id={controlId} type="button" role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      disabled={disabled || enabled.length === 0} className={styles.trigger}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown}>
      <span title={selected?.label}>{selected?.label ?? label}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open ? <ul id={listId} role="listbox" aria-label={label} className={styles.options}
      data-above={placement.above} style={{ maxHeight: placement.height }}>
      {options.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        data-active={option.value === active} title={option.label}
        onPointerDown={event => event.preventDefault()}
        onPointerMove={() => { if (!option.disabled) setActive(option.value); }}
        onClick={() => choose(option.value)}>
        <span>{option.label}</span>{option.value === value ? <Check size={14} aria-hidden="true" /> : null}
      </li>)}
    </ul> : null}
  </div>;
}
