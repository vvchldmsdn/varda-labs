"use client";

import type { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
};

const format = (value: string) => /^\d+$/.test(value)
  ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : value;

export function MoneyInput({ value, onValueChange, ...props }: Props) {
  return <input {...props} type="text" inputMode="numeric" value={format(value)}
    onKeyDown={event => {
      const input = event.currentTarget;
      const position = input.selectionStart;
      if (position === null || position !== input.selectionEnd) return;
      if (event.key === "Backspace" && input.value[position - 1] === ",") input.setSelectionRange(position - 1, position - 1);
      if (event.key === "Delete" && input.value[position] === ",") input.setSelectionRange(position + 1, position + 1);
    }}
    onChange={event => {
      const input = event.currentTarget;
      const before = input.value.slice(0, input.selectionStart ?? input.value.length).replaceAll(",", "").length;
      const raw = input.value.replaceAll(",", "");
      onValueChange(raw);
      const formatted = format(raw);
      let position = 0;
      for (let count = 0; position < formatted.length && count < before; position++) {
        if (formatted[position] !== ",") count++;
      }
      requestAnimationFrame(() => {
        if (document.activeElement === input) input.setSelectionRange(position, position);
      });
    }} />;
}
