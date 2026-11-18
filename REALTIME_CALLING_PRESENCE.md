# CHATHSI — Presence, Ringtones and Video Calling

## Online/offline status

Presence is derived from authenticated Socket.IO connections on the server. Each account has a set of active socket IDs. The server announces `presence:update` only when an account changes between zero and one active sockets, so multiple tabs do not cause false offline transitions. Client UI updates status labels in place. Presence is intentionally not persisted in SQLite because it describes live connections.

## Calling

Voice and video calls use the same one-to-one WebRTC flow. The caller sends a call invitation with `callType: audio|video`; the recipient accepts or rejects. Both sides acquire the required media with `getUserMedia`, exchange SDP offer/answer and ICE candidates through authenticated Socket.IO events, and send media peer-to-peer. Video calls show local and remote previews, with microphone mute and camera on/off controls. Incoming and outgoing ring tones are synthesized locally with Web Audio; they are not uploaded or saved.

Calls time out if unanswered. Calls require HTTPS, device permissions and a working ICE path. STUN-only connectivity is not guaranteed; configure TURN credentials for restrictive mobile/carrier networks.

## Deployment limitations

The included Render Free setup uses ephemeral `/tmp` storage and a single process. The online map is process-local. If the service restarts, all members will reconnect and presence will be rebuilt. If scaling to multiple instances, use a shared Socket.IO adapter and shared presence store such as Redis. Do not horizontally scale this SQLite deployment.
