/**
 * Limite da captura de tela: 1080p. Uma tela maior (1440p, 4K, ultrawide) é reduzida antes do
 * envio. Com o mesmo bitrate, menos pixels dão uma imagem bem mais nítida: o codificador não
 * precisa "esticar" poucos bits sobre uma tela enorme (que vira blocos e borrão).
 */
export const MAX_CAPTURE_WIDTH = 1920;
export const MAX_CAPTURE_HEIGHT = 1080;

/**
 * Restrições do `getDisplayMedia`. `max` faz o Chrome/Edge já capturarem reduzido (menos trabalho
 * de CPU também); a proporção da tela é mantida.
 */
export function displayMediaVideoConstraints(frameRate = 30): MediaTrackConstraints {
  return {
    frameRate: { ideal: frameRate },
    width: { max: MAX_CAPTURE_WIDTH },
    height: { max: MAX_CAPTURE_HEIGHT },
  };
}

/**
 * Quantas vezes é preciso reduzir a imagem para caber no limite (`scaleResolutionDownBy`);
 * 1 = já cabe, não mexe. Rede de segurança para navegadores que ignoram o `max` da captura.
 */
export function downscaleFactor(
  width: number | undefined,
  height: number | undefined,
  maxWidth = MAX_CAPTURE_WIDTH,
  maxHeight = MAX_CAPTURE_HEIGHT,
): number {
  if (!width || !height || width <= 0 || height <= 0) return 1;
  return Math.max(1, width / maxWidth, height / maxHeight);
}
