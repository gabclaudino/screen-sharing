export interface Size {
  width: number;
  height: number;
}

const MARGIN = 4;

/**
 * Posição (canto superior esquerdo) de um menu aberto no ponto (x, y) de um contêiner, sem
 * deixá-lo vazar para fora. Se não couber, vai para o canto mais próximo da margem.
 */
export function clampMenuPosition(
  point: { x: number; y: number },
  menu: Size,
  container: Size,
): { left: number; top: number } {
  const maxLeft = container.width - menu.width - MARGIN;
  const maxTop = container.height - menu.height - MARGIN;
  return {
    left: Math.max(MARGIN, Math.min(point.x, maxLeft)),
    top: Math.max(MARGIN, Math.min(point.y, maxTop)),
  };
}
