import type { ReactNode } from "react";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { LOCALES, type Locale, type TranslationKey } from "../i18n";
export type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;
export function Language({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (locale: Locale) => void;
  t: Translate;
}) {
  return (
    <label className="language-select">
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 tabIndex={-1}>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Notice({
  children,
  kind = "info",
  close,
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
  close?: { label: string; action: () => void };
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <div>{children}</div>
      {close && (
        <button
          className="icon-button"
          onClick={close.action}
          aria-label={close.label}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ∿
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Busy({ label }: { label: string }) {
  return (
    <span className="busy">
      <LoaderCircle className="spin" size={16} />
      {label}
    </span>
  );
}
export function External({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={16} />
    </a>
  );
}
