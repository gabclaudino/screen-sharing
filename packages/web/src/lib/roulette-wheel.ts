/** Geometria da roleta: fatias iguais, a primeira começando no alto, em sentido horário. */

export const WHEEL_COLORS = [
  '#4c8dff',
  '#e5484d',
  '#30a46c',
  '#f5a524',
  '#8e4ec6',
  '#0ea5b7',
  '#e93d82',
  '#7a8b2f',
  '#d9622b',
  '#5b6ee1',
] as const;

/** Voltas completas antes de parar. */
const FULL_TURNS = 6;

/** Ponto na circunferência; o ângulo é em graus, 0 = topo, sentido horário. */
export function pointAt(angle: number, radius: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { x: round(radius * Math.sin(radians)), y: round(-radius * Math.cos(radians)) };
}

/** `d` do path SVG da fatia `index` de `count` (centro em 0,0). Exige `count` ≥ 2. */
export function slicePath(index: number, count: number, radius: number): string {
  const size = 360 / count;
  const from = pointAt(index * size, radius);
  const to = pointAt((index + 1) * size, radius);
  const largeArc = size > 180 ? 1 : 0;
  return `M0 0L${from.x} ${from.y}A${radius} ${radius} 0 ${largeArc} 1 ${to.x} ${to.y}Z`;
}

/** Ângulo do meio da fatia. */
export const sliceCenter = (index: number, count: number): number => ((index + 0.5) * 360) / count;

/**
 * Rotação final (graus, sentido horário) que deixa o meio da fatia `index` sob o ponteiro do topo,
 * depois de várias voltas a partir de `current`.
 */
export function targetRotation(current: number, index: number, count: number): number {
  const wanted = (360 - sliceCenter(index, count)) % 360;
  const offset = (((wanted - current) % 360) + 360) % 360;
  return current + FULL_TURNS * 360 + offset;
}

/** Nome que cabe na fatia. */
export function shortLabel(name: string, max = 14): string {
  const chars = [...name];
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join('')}…`;
}
