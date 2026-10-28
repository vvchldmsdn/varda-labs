import { createElement, type ElementType, type JSX } from "react";
import { Button, Field, Fieldset, Form, Input, PageTitle, SectionTitle, Select, Status, Textarea } from "@/components/cairn-ui";

const elements: Partial<Record<keyof JSX.IntrinsicElements, ElementType>> = {
  button: Button, label: Field, fieldset: Fieldset, form: Form,
  input: Input, select: Select, textarea: Textarea, h1: PageTitle,
  h2: SectionTitle, h3: SectionTitle,
};

/** Locale wrappers keep native behavior while sharing the same visual contract. */
export function createLocalizedUiElement(tag: keyof JSX.IntrinsicElements, attributes: Record<string, unknown>) {
  if (tag === "input" && attributes.type === "hidden") return createElement(tag, attributes);
  if ((tag === "div" || tag === "p" || tag === "span") && ["alert", "status"].includes(String(attributes.role))) {
    return createElement(Status, { ...attributes, as: tag, tone: attributes.role === "alert" ? "danger" : "neutral" });
  }
  const presentation: Record<string, unknown> = tag === "h3" ? { level: "h3" } : {};
  if (tag === "button") {
    const className = String(attributes.className ?? "");
    presentation.variant = /danger|negative|delete|remove/i.test(className) ? "danger"
      : attributes.type === "submit" || /primary/i.test(className) ? "primary"
      : "aria-pressed" in attributes ? "selection" : "secondary";
  }
  return createElement(elements[tag] ?? tag, { ...presentation, ...attributes });
}
