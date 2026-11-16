/** Cosmetic ink width in CSS pixels. Plot geometry and pen settings are independent. */
export const DISPLAY_INK_PX = 0.9;
export function displayStrokeWorld(unitsPerPixel: number) {
  return Math.max(0.000001, unitsPerPixel) * DISPLAY_INK_PX;
}
