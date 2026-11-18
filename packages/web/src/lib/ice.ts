// Fase 7 troca isto por uma busca autenticada em /api/ice (com TURN). Até lá, só STUN público.
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
