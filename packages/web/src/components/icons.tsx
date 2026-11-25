// Ícones de traço simples; herdam a cor do texto (currentColor) e são decorativos para leitores
// de tela (o botão que os usa leva aria-label).
const iconProps = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export const EnterFullscreenIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const ExitFullscreenIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
);

/** Porta com seta saindo. */
export const LogOutIcon = () => (
  <svg {...iconProps}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const SoundOnIcon = () => (
  <svg {...iconProps}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const SoundOffIcon = () => (
  <svg {...iconProps}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="m16.5 9.5 5 5" />
    <path d="m21.5 9.5-5 5" />
  </svg>
);

/** Silhueta de "sem foto": cabeça e ombros, preenchida (ocupa o círculo do avatar). */
export const NoPhotoIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="12" cy="9" r="4.2" />
    <path d="M3.5 22c0-4.7 3.8-7.6 8.5-7.6s8.5 2.9 8.5 7.6z" />
  </svg>
);
