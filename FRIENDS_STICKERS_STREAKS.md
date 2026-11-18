# CHATHSI Friends, Stickers and Streaks Update

## Friends
- Explore now shows incoming requests, accepted friends and outgoing requests.
- Members can send friend requests; recipients can accept or decline.
- Requests are stored in the SQLite document store and notifications are emitted to the recipient.
- A friendship is only created after acceptance. Following remains a separate feature.

## Stickers
- A built-in, searchable-by-screen-reader sticker catalogue is exposed through `/api/stickers`.
- Private and group chats can send approved sticker IDs. The server resolves IDs to its own emoji catalogue; clients cannot inject arbitrary sticker markup.
- Sticker picker buttons have accessible names and keyboard focus states.

## Chat streaks
- Private-chat streaks count distinct UTC calendar days with at least one message in the conversation.
- The API returns current streak, best streak, active-today status and total active days.
- A streak is informational; it does not award wallet credits or create financial value.

## Existing real-time features
- Authenticated Socket.IO presence, incoming/outgoing call tones, audio calls, video calls, and real-time post/message updates remain included.
- Video calls require HTTPS, camera/microphone permission and a working ICE route. Configure TURN for networks where STUN alone cannot establish a peer connection.
- Presence is in-memory per server process. A restart briefly clears presence while sockets reconnect; multi-instance hosting requires shared presence and a Socket.IO adapter.

## Storage warning
This package retains the prior Render ephemeral-storage configuration. SQLite data and uploads can be lost on restarts/redeployments. Use persistent storage or an external database/object store before real production use.
