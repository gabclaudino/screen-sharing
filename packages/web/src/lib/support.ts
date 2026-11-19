/** O navegador tem o mínimo para entrar na sala: WebRTC e WebSocket. */
export function isRoomSupported(
  env: { RTCPeerConnection?: unknown; WebSocket?: unknown } = globalThis,
): boolean {
  return typeof env.RTCPeerConnection === 'function' && typeof env.WebSocket === 'function';
}
