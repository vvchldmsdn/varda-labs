export type MotionRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** Scale the final, fully laid out panel to the card without reflowing its content. */
export function panelTransformAtRect(panel: MotionRect, destination: MotionRect): string {
  const values = [panel.left, panel.top, panel.width, panel.height, destination.left, destination.top, destination.width, destination.height];
  if (!values.every(Number.isFinite) || panel.width <= 0 || panel.height <= 0 || destination.width <= 0 || destination.height <= 0) return "none";
  return `translate(${destination.left - panel.left}px, ${destination.top - panel.top}px) scale(${destination.width / panel.width}, ${destination.height / panel.height})`;
}

export const dialogMotion = {
  open: { duration: 320, easing: "cubic-bezier(.16,1,.3,1)" },
  close: { duration: 240, easing: "cubic-bezier(.4,0,.6,1)" },
  popoverOpen: { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
  popoverClose: { duration: 160, easing: "cubic-bezier(.3,0,.4,1)" },
} as const;
