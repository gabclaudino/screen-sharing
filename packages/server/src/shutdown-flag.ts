import { existsSync, rmSync } from 'node:fs';

/**
 * Pedido de desligamento por arquivo: o `DESLIGAR.bat` cria `logs/desligar.flag` e o servidor, que
 * confere o arquivo a cada instante, encerra com educação (avisa todo mundo e sai). Assim o script
 * não precisa de senha nem de porta de controle, e não há nada para atacar pela rede: só quem
 * escreve na pasta do projeto consegue pedir.
 *
 * Um arquivo esquecido de uma execução anterior é apagado ao começar, para o servidor não
 * desligar logo ao subir. Devolve a função que para a vigilância.
 */
export function watchShutdownFlag(
  file: string,
  onShutdown: () => void,
  intervalMs = 500,
): () => void {
  rmSync(file, { force: true });
  let fired = false;
  const timer = setInterval(() => {
    if (fired || !existsSync(file)) return;
    fired = true;
    rmSync(file, { force: true });
    onShutdown();
  }, intervalMs);
  // A vigilância sozinha não deve manter o processo vivo.
  timer.unref();
  return () => clearInterval(timer);
}
