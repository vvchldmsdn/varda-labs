export type MotionRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** Scale the final, fully laid out panel to the card without reflowing its content. */
export function panelTransformAtRect(panel: MotionRect, destination: MotionRect): string {
  const values = [panel.left, panel.top, panel.width, panel.height, destination.left, destination.top, destination.width, destination.height];
  if (!values.every(Number.isFinite) || panel.width <= 0 || panel.height <= 0 || destination.width <= 0 || destination.height <= 0) return "none";
  return `translate(${destination.left - panel.left}px, ${destination.top - panel.top}px) scale(${destination.width / panel.width}, ${destination.height / panel.height})`;
}

export const dialogMotion = {
  // Samples of the reference's unit-mass spring (stiffness 320, damping 28).
  homeOpen: { duration: 440, easing: "linear(0, 0.0759, 0.2401, 0.4265, 0.5987, 0.7402, 0.847, 0.9217, 0.9701, 0.9985, 1.0131, 1.0186, 1.0189, 1.0165, 1.013, 1.0095, 1.0064, 1.004, 1)" },
  homeClose: { duration: 270, easing: "linear(0, 0.0313, 0.1084, 0.2112, 0.3249, 0.439, 0.5468, 0.6441, 0.7288, 0.8003, 0.859, 0.9058, 0.942, 0.9692, 0.9889, 1.0025, 1.0112, 1.0164, 1)" },
  open: { duration: 320, easing: "cubic-bezier(.16,1,.3,1)" },
  close: { duration: 240, easing: "cubic-bezier(.4,0,.6,1)" },
  popoverOpen: { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
  popoverClose: { duration: 160, easing: "cubic-bezier(.3,0,.4,1)" },
} as const;
