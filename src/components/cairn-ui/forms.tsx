import { createElement, type ComponentProps, type ReactNode } from "react";
import styles from "./forms.module.css";

const join = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(" ");
export type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "selection" | "bare"; size?: "sm" | "md" | "lg" };

/** Native form behavior, handlers, refs and submit names remain the caller's contract. */
export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return <button {...props} data-cairn-button data-variant={variant} data-size={size} className={join(styles.button, className)} />;
}

export type InputProps = ComponentProps<"input"> & { presentation?: "default" | "amount" };
export function Input({ className, presentation = "default", ...props }: InputProps) {
  return <input {...props} data-cairn-control data-presentation={presentation} className={join(styles.control, className)} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} data-cairn-control className={join(styles.control, styles.select, className)} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} data-cairn-control className={join(styles.control, styles.textarea, className)} />;
}
export function Checkbox(props: Omit<ComponentProps<"input">, "type">) { return <Input {...props} type="checkbox" />; }
export function Radio(props: Omit<ComponentProps<"input">, "type">) { return <Input {...props} type="radio" />; }

/** Wrap a single control for implicit labeling, or supply htmlFor for a separate control.
 * Existing hint/error IDs stay explicit so server and client markup never invent different IDs. */
export function Field({ label, hint, error, children, className, ...props }: ComponentProps<"label"> & { label?: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  return <label {...props} data-cairn-field className={join(styles.field, className)}>
    {label && <span className={styles.label}>{label}</span>}{children}
    {hint && <span className={styles.hint}>{hint}</span>}
    {error && <span className={styles.fieldError}>{error}</span>}
  </label>;
}
export function Fieldset({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset {...props} data-cairn-fieldset className={join(styles.fieldset, className)} />;
}
export function Form({ className, ...props }: ComponentProps<"form">) {
  return <form {...props} data-cairn-form className={join(styles.form, className)} />;
}
export function FormActions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-cairn-form-actions className={join(styles.actions, className)} />;
}
export function FormSection({ title, description, className, children, ...props }: Omit<ComponentProps<"fieldset">, "title"> & { title?: ReactNode; description?: ReactNode }) {
  return <Fieldset {...props} className={join(styles.section, className)}>
    {title && <legend className={styles.legend}>{title}</legend>}
    {description && <p className={styles.sectionDescription}>{description}</p>}{children}
  </Fieldset>;
}
export type StatusTone = "neutral" | "success" | "warning" | "danger";
export function Status<T extends "div" | "p" | "span" = "div">({ as, tone = "neutral", className, role = "status", ...props }: ComponentProps<T> & { as?: T; tone?: StatusTone }) {
  return createElement(as ?? "div", { ...props, role, "data-cairn-status": true, "data-tone": tone, className: join(styles.status, className) });
}
export const Notice = Status;
export function ValidationMessage({ className, role = "alert", ...props }: ComponentProps<"p">) {
  return <p {...props} role={role} data-cairn-validation className={join(styles.validation, className)} />;
}
export function RadioGroup({ className, role = "radiogroup", ...props }: ComponentProps<"div">) {
  return <div {...props} role={role} data-cairn-radio-group className={join(styles.radioGroup, className)} />;
}
