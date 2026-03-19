const DEFAULT_TURN_URLS = [
    'turn:a.relay.metered.ca:80?transport=udp',
    'turn:a.relay.metered.ca:80?transport=tcp',
    'turn:a.relay.metered.ca:443',
    'turns:a.relay.metered.ca:443?transport=tcp',
]

const DEFAULT_STUN_URLS = [
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
]

export function createDemoRtcConfiguration(): RTCConfiguration {
    const turnUsername = import.meta.env.VITE_METERED_USER
    const turnCredential = import.meta.env.VITE_METERED_CREDENTIAL

    return {
        iceServers: [
            { urls: DEFAULT_STUN_URLS },
            ...(turnUsername && turnCredential
                ? [
                      {
                          urls: DEFAULT_TURN_URLS,
                          username: turnUsername,
                          credential: turnCredential,
                      } satisfies RTCIceServer,
                  ]
                : []),
        ],
        iceCandidatePoolSize: 10,
    }
}
