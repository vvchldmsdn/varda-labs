"use client";

import { useState } from "react";
import { Button, Checkbox, Field, Input } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { SALE_EXCLUSION_LIMIT } from "@/lib/additional-contribution-sale-exclusions";
import styles from "./sale-exclusion-picker.module.css";

export type SaleExclusionOption = { key: string; label: string; detail?: string };

type PickerProps = {
  options: readonly SaleExclusionOption[];
  value: readonly string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  english?: boolean;
};

export function SaleExclusionPicker({ options, value, onChange, disabled = false, english }: PickerProps) {
  const { locale } = useI18n();
  const en = english ?? locale === "en";
  const [query, setQuery] = useState("");
  const searchable = options.length >= 8;
  const filter = searchable ? query.trim().toLowerCase() : "";
  const selected = new Set(value);
  const first = options.find(option => selected.has(option.key));
  const remaining = selected.size - 1;
  let summary = en ? "None" : "없음";
  if (first) {
    summary = first.label;
    if (remaining) summary += en ? ` +${remaining}` : ` 외 ${remaining}건`;
  } else if (selected.size) {
    summary = en ? `${selected.size} selected` : `${selected.size}건 선택`;
  }
  const visible = options.filter(option =>
    !filter || `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(filter)
  );
  const visibleKeys = new Set(visible.map(option => option.key));

  function toggle(key: string, checked: boolean) {
    const next = checked ? [...value, key] : value.filter(item => item !== key);
    onChange(next.sort());
  }

  return (
    <details className={styles.picker} onToggle={event => {
      if (!event.currentTarget.open) setQuery("");
    }}>
      <summary>
        <span>{en ? "Exclude from sales" : "매도 제외 종목"}</span>
        <span className={styles.selection}>{summary}</span>
      </summary>
      <div className={styles.tools}>
        <p>{en ? "Keep these holdings out of this sale calculation." : "이번 계산에서 팔지 않을 종목을 고르세요."}</p>
        {selected.size > 0 && (
          <Button variant="bare" className={styles.clear} type="button" disabled={disabled}
            onClick={event => {
              event.currentTarget.closest("details")?.querySelector("summary")?.focus();
              onChange([]);
            }}>
            {en ? "Clear exclusions" : "모두 해제"}
          </Button>
        )}
      </div>
      {searchable && (
        <Input type="search" className={styles.search} value={query} disabled={disabled}
          placeholder={en ? "Search holdings or accounts" : "종목·계좌 검색"}
          aria-label={en ? "Search holdings or accounts" : "종목·계좌 검색"}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
      )}
      {options.length > 0 && (
        <div className={styles.list}>
          {options.map(option => {
            const checked = selected.has(option.key);
            return (
              <Field key={option.key} className={styles.option} hidden={!visibleKeys.has(option.key)}>
                <span className={styles.identity}>{option.label}
                  {option.detail && <small>{option.detail}</small>}
                </span>
                <Checkbox name="excludeSell" value={option.key} checked={checked}
                  disabled={disabled || (!checked && selected.size >= SALE_EXCLUSION_LIMIT)}
                  onChange={event => toggle(option.key, event.target.checked)} />
              </Field>
            );
          })}
        </div>
      )}
      {!visible.length && (
        <p role="status">{options.length
          ? (en ? "No matching holdings." : "검색 결과가 없어요.")
          : (en ? "No eligible holdings available." : "선택 가능한 보유 종목을 확인하지 못했습니다.")}</p>
      )}
      {selected.size >= SALE_EXCLUSION_LIMIT && (
        <p role="status">{en ? `Select up to ${SALE_EXCLUSION_LIMIT} holdings.` : `최대 ${SALE_EXCLUSION_LIMIT}건까지 선택할 수 있어요.`}</p>
      )}
    </details>
  );
}
