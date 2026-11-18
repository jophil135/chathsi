# CHATHIS remaining updates — build status

## Included in this package
- Retains the CockroachDB/PostgreSQL-compatible persistence adapter and migration scripts from the inspected CockroachDB build.
- Retains profile image upload handling and its client-side upload progress indicator.
- Retains post/story media upload progress, story expiry metadata, online/offline presence, one-to-one voice/video call signalling, and the existing emoji sticker picker.
- Refines the story viewer into a more immersive responsive layout, including a full-height mobile presentation.
- Keeps comments in independently scrollable containers and chat messages in a scrollable area with a separate composer.
- Keeps the chat send flow explicitly awaiting the refresh after a successful send.

## Not completed or not verified — do not treat as production-ready
- **Gift earnings withdrawals:** the current wallet still needs a proper separate withdrawable-earnings ledger, reserved/pending withdrawal balance, and idempotent admin payout workflow. Purchased top-up credits must never become withdrawable. No cash-out flow is represented as complete in this package.
- **Group voice/video calls:** current WebRTC client and Socket.IO signalling support one-to-one calls only. A group mesh/SFU call implementation, participant UI, join/leave handling, and TURN-backed network testing are still required.
- **External GIF/sticker service:** current sticker picker is the existing built-in emoji catalogue. No external provider credentials or image-sticker upload flow has been integrated.
- **Full story experience:** the viewer has a visual layout refinement, but timed progress bars, automatic story advancement, view receipts, and full interaction parity with major social apps are not complete.
- **Production media storage:** uploaded media still uses the local filesystem. Configure durable object storage before relying on uploads across Render restarts/redeploys.
- **Live CockroachDB verification:** syntax checks pass, but this package has not been tested against the user's live CockroachDB cluster. Run `npm install` and `npm run db:check` in a staging environment before switching production traffic.

## Validation performed for this package
- `npm run check` — passed (Node.js syntax checks for server, stores, models and browser JavaScript).
- ZIP integrity check — performed after packaging.
- No live database, WebRTC, multi-device browser, payment, or real-device responsive tests were possible here.

## Deployment caution
Back up the GitHub repository and export any recoverable existing database before replacing production files. Do not remove the current database configuration or switch `DB_DRIVER`/`DATABASE_URL` until the staging database check and migration have succeeded. Never commit `.env`, database URLs, TURN credentials, or payment secrets.
