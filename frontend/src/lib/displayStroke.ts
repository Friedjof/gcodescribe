/** Cosmetic ink width in CSS pixels. Plot geometry and pen settings are independent. */
export const DISPLAY_INK_PX = 0.9;
/** Paper stays white in both UI themes; bitmap ink must match --ink. */
export const DISPLAY_INK_COLOR = "#171a20";
export function displayStrokeWorld(unitsPerPixel: number) {
  return Math.max(0.000001, unitsPerPixel) * DISPLAY_INK_PX;
}
