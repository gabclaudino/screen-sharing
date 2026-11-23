/**
 * Fotos de perfil que a pessoa pode escolher (clicando no próprio ícone na lista de participantes).
 * Só as fotos listadas aqui podem ser escolhidas (as do fundo da tela de login não entram).
 * Para mudar as opções, edite esta lista: `id` é o que vai para o servidor e para os outros
 * (minúsculas, números, `-` ou `_`, até 32 caracteres), e `src` é o arquivo em `public/fotos/`
 * (essa pasta não é versionada: o repositório é público e as fotos são de pessoas).
 * Se o arquivo não existir, a foto aparece como a imagem padrão "sem foto".
 */
export interface ProfilePhoto {
  id: string;
  src: string;
  /** Texto alternativo / nome da opção no seletor. */
  label: string;
}

export const PROFILE_PHOTOS: readonly ProfilePhoto[] = [
  { id: 'perfil-1', src: '/fotos/perfil-1.png', label: 'Foto 1' },
  { id: 'perfil-2', src: '/fotos/perfil-2.webp', label: 'Foto 2' },
  { id: 'perfil-3', src: '/fotos/perfil-3.png', label: 'Foto 3' },
  { id: 'perfil-4', src: '/fotos/perfil-4.png', label: 'Foto 4' },
  { id: 'perfil-5', src: '/fotos/perfil-5.png', label: 'Foto 5' },
  { id: 'perfil-6', src: '/fotos/perfil-6.png', label: 'Foto 6' },
  { id: 'perfil-7', src: '/fotos/perfil-7.png', label: 'Foto 7' },
  { id: 'perfil-8', src: '/fotos/perfil-8.png', label: 'Foto 8' },
  { id: 'perfil-9', src: '/fotos/perfil-9.png', label: 'Foto 9' },
  { id: 'perfil-10', src: '/fotos/perfil-10.png', label: 'Foto 10' },
  { id: 'perfil-11', src: '/fotos/perfil-11.jpg', label: 'Foto 11' },
  { id: 'perfil-12', src: '/fotos/perfil-12.jpg', label: 'Foto 12' },
  { id: 'perfil-13', src: '/fotos/perfil-13.jpg', label: 'Foto 13' },
  { id: 'perfil-14', src: '/fotos/perfil-14.png', label: 'Foto 14' },
  { id: 'perfil-15', src: '/fotos/perfil-15.png', label: 'Foto 15' },
  { id: 'perfil-16', src: '/fotos/perfil-16.png', label: 'Foto 16' },
  { id: 'perfil-17', src: '/fotos/perfil-17.png', label: 'Foto 17' },
];

/** A foto de um id; `undefined` para sem id ou um id que esta versão do app não conhece. */
export function findProfilePhoto(
  id: string | null | undefined,
  photos: readonly ProfilePhoto[] = PROFILE_PHOTOS,
): ProfilePhoto | undefined {
  return id ? photos.find((photo) => photo.id === id) : undefined;
}
