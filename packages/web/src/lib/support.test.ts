import { describe, expect, it } from 'vitest';
import { isRoomSupported } from './support';

describe('isRoomSupported', () => {
  it('exige WebRTC e WebSocket', () => {
    const fn = () => undefined;
    expect(isRoomSupported({ RTCPeerConnection: fn, WebSocket: fn })).toBe(true);
    expect(isRoomSupported({ WebSocket: fn })).toBe(false);
    expect(isRoomSupported({ RTCPeerConnection: fn })).toBe(false);
    expect(isRoomSupported({})).toBe(false);
    expect(isRoomSupported({ RTCPeerConnection: 'x', WebSocket: 1 })).toBe(false);
  });
});
