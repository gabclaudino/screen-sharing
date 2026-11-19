import { NAME_MAX_LENGTH } from '@screenshare/shared';
import { isValidName } from './profile';

/**
 * Valida o formulário de entrada. A senha é sempre obrigatória: não existe "sessão ativa" que
 * dispense a senha, nem depois de sair da sala nem ao recarregar a página.
 * Devolve a mensagem de erro, ou `null` se estiver tudo certo.
 */
export function validateJoin(name: string, password: string): string | null {
  if (!isValidName(name)) return `Digite um nome de 1 a ${NAME_MAX_LENGTH} caracteres.`;
  if (password === '') return 'Digite a senha de acesso.';
  return null;
}
