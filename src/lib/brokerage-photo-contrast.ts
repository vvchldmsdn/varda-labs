/** Prepare light and dark brokerage screenshots for the same local OCR worker. */
export function normalizeBrokerageContrast(pixels: Uint8ClampedArray) {
  const luminance = (i: number) => pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
  // Sample before binarizing. A light-gray caption and a dark panel can both
  // fall below the light-theme cutoff, losing every stroke on the panel.
  const stride = Math.max(1, Math.floor(pixels.length / (4 * 4096))) * 4;
  let dark = 0;
  let darkLuminance = 0;
  let lightLuminance = 0;
  let sampled = 0;
  for (let i = 0; i < pixels.length; i += stride) {
    const gray = luminance(i);
    if (gray < 112) {
      dark++;
      darkLuminance += gray;
    } else lightLuminance += gray;
    sampled++;
  }
  const darkBackground = dark > sampled / 2;
  const background = darkLuminance / Math.max(dark, 1);
  const foreground = lightLuminance / Math.max(sampled - dark, 1);
  const threshold = darkBackground ? background + Math.max(12, (foreground - background) * .15) : 220;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = luminance(i);
    const ink = darkBackground ? gray > threshold : gray < threshold;
    const value = ink ? 0 : 255;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
  }
}
