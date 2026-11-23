/**
 * Fotos espalhadas pelo fundo da tela de entrada. Os arquivos ficam em `public/fotos/` e NÃO
 * são versionados (o repositório é público): num clone novo a pasta não existe e o app
 * simplesmente não mostra as fotos. A posição de cada uma está em `styles.css` (`.bg-photo-N`).
 */
export interface BackgroundPhoto {
  src: string;
  className: string;
}

export const BACKGROUND_PHOTOS: readonly BackgroundPhoto[] = [
  { src: '/fotos/guri-1.jpg', className: 'bg-photo-1' },
  { src: '/fotos/guri-2.webp', className: 'bg-photo-2' },
  { src: '/fotos/guri-3.jpg', className: 'bg-photo-3' },
  { src: '/fotos/guri-4.jpg', className: 'bg-photo-4' },
  { src: '/fotos/guri-5.jpg', className: 'bg-photo-5' },
  { src: '/fotos/guri-6.jpg', className: 'bg-photo-6' },
  { src: '/fotos/guri-7.jpg', className: 'bg-photo-7' },
  { src: '/fotos/guri-8.jpg', className: 'bg-photo-8' },
  { src: '/fotos/guri-9.jpg', className: 'bg-photo-9' },
];
