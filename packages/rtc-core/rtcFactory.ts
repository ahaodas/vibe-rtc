export type RTCPeerFactory = {
    createPeer: (cfg?: RTCConfiguration) => RTCPeerConnection
    createCandidate: (init: RTCIceCandidateInit) => RTCIceCandidate
    createDesc: (init: RTCSessionDescriptionInit) => RTCSessionDescription
}

export const WebRTCPeerFactory: RTCPeerFactory = {
    createPeer: (cfg) => new RTCPeerConnection(cfg),
    createCandidate: (init) => new RTCIceCandidate(init),
    createDesc: (init) => new RTCSessionDescription(init),
}
