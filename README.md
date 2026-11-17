# CHATHSI — SQLite Edition

A responsive social-network starter built with Node.js, Express, SQLite, Socket.IO and vanilla HTML/CSS/JavaScript. The database and local uploads are designed to live on a Render Persistent Disk. **MongoDB is not required.**

## Included features

- Registration, login, logout and editable user profiles
- Social feed with text/image posts, likes, comments and sharing
- Follow/unfollow, user search and blocking
- Direct messages with Socket.IO delivery while users are online
- Free browser-recorded voice messages with playback controls and authenticated audio access
- Free one-to-one browser voice calls using WebRTC and authenticated Socket.IO signalling
- Optional TURN server configuration for improved call connectivity on restrictive networks
- 24-hour stories
- Notifications
- Reporting and admin moderation
- Wallet, top-up requests, gift catalogue and gift inventory
- Admin-issued free gifts
- Admin dashboard for user moderation, payment-method settings, gift management, top-up review, gift-transfer review, premium plans and platform settings
- Audit log and wallet ledger
- Blue primary theme; purple/gold premium styling
- Footer: **BUILT BY JOSSY STUDIOS**

## Confirmed CHATHSI wallet rules

1. Gift conversion is 100% of the gift's configured NGN face value.
2. Every top-up request requires administrator approval, including card requests in this starter.
3. Every gift transfer requires administrator approval.
4. Only administrators can issue free gifts.
5. A gift is locked while its transfer request is pending.
6. When approved, the gift is consumed and the recipient receives its full configured face value as internal CHATHSI credits. A consumed gift cannot be transferred again.
7. Credits are platform-only credits in this starter; they are not cash and cannot be withdrawn.
8. Wallet purchases, top-up approvals and gift-transfer approvals use SQLite transactions to prevent duplicate approvals and concurrent overspending.
9. Admin actions and wallet changes are recorded in audit/ledger records.

## Requirements

- Node.js 20 or later
- npm
- A Render web service with a Persistent Disk for hosted deployment

## Run locally

```bash
npm install
cp .env.example .env
```

For local development, change these `.env` values to local paths and settings:

```env
NODE_ENV=development
PORT=3000
DATABASE_PATH=./data/chathsi.db
UPLOAD_DIR=./uploads
VOICE_DIR=./voice-private
COOKIE_SECURE=false
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=you@example.com
ADMIN_USERNAME=chathsi_admin
ADMIN_PASSWORD=replace-with-a-unique-strong-password
```

Then run:

```bash
npm start
```

Open `http://localhost:3000`.

The server creates the first administrator on startup only when `ADMIN_EMAIL` and a non-placeholder `ADMIN_PASSWORD` are configured. Keep the admin password and JWT secret private. If the admin already exists, changing the environment variable does not automatically reset that account's password.

## Deploy to Render with SQLite

1. Push the contents of this project folder to a GitHub repository.
2. In Render, choose **New → Web Service** and connect the repository.
3. Use Node as the runtime, `npm install` as the build command and `npm start` as the start command.
4. Choose a plan that supports a Persistent Disk. Render's free web-service plan cannot attach a persistent disk.
5. Create and attach a Persistent Disk with mount path `/var/data/chathsi`.
6. In Environment, set:

```env
NODE_ENV=production
DATABASE_PATH=/var/data/chathsi/chathsi.db
UPLOAD_DIR=/var/data/chathsi/uploads
VOICE_DIR=/var/data/chathsi/voice-private
MAX_VOICE_MB=10
COOKIE_SECURE=true
MAX_UPLOAD_MB=8
```

7. Add a long, random `JWT_SECRET`, plus a unique `ADMIN_EMAIL`, `ADMIN_USERNAME` and strong `ADMIN_PASSWORD`.
8. Save changes and deploy. The SQLite database file, public image uploads and private voice-message files are created under the mounted disk.
9. Test registration, login, posting, messaging, wallet actions and admin approvals.
10. Configure backups and periodically test restoring a backup before inviting real users.

A sample `render.yaml` is included as a starting point for a Render Blueprint. Review the service plan and disk size/pricing before applying it.

## Voice messaging and calling

- Voice messages are recorded in the browser with `MediaRecorder`, uploaded to `VOICE_DIR`, and stored as message metadata in SQLite. The audio endpoint requires login and verifies that the requester is a sender or recipient of that message.
- Voice calls use WebRTC peer connections; Socket.IO is used only for authenticated call signalling (invite, accept/reject, offer/answer, ICE candidates and hang-up). Audio is not routed through SQLite or stored on the server.
- Browser microphone access requires HTTPS (or localhost during development) and user permission. Test on the actual browsers/devices your community uses.
- The app includes a public STUN server as a basic connectivity aid. For reliable connections across strict NATs, configure a TURN provider using `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` in Render Environment. Use provider-issued, preferably short-lived credentials; never commit them to GitHub. TURN relay usage may cost money.
- Current calling scope is one-to-one voice only. Group calls and video calls are not implemented by this update.

## Storage and scaling notes

- The SQLite database is stored at `DATABASE_PATH`; the uploads folder is stored at `UPLOAD_DIR`.
- `DATABASE_PATH`, `UPLOAD_DIR` and `VOICE_DIR` must all be inside the Persistent Disk mount for data to survive deploys/restarts. Voice recordings are served through an authenticated route that checks conversation membership.
- Keep one web-service instance for this SQLite deployment. Do not scale this SQLite file across multiple service instances.
- Persistent Disk storage is a paid Render feature; the free web-service plan cannot attach one.
- Back up the database file and uploads. WAL mode is enabled; use SQLite's backup API or stop the service before copying database files so the backup is consistent.
- For high traffic or multiple app instances, migrate to managed PostgreSQL and object storage.

## Payments and virtual credits

This starter provides admin-controlled payment-method visibility and a manual top-up review queue. It does not collect card numbers/CVV and does not verify card payments automatically. A card top-up request in this starter is only a pending request; do not credit it until the actual provider confirms payment server-side.

Before accepting real payments, the account/business owner must onboard with a supported payment provider, implement hosted checkout and signed server-side webhooks, reconcile references, and obtain appropriate legal/accounting advice. Never trust a browser success message or payment screenshot as proof of payment. Never store card numbers or CVVs.

Wallet balances in this starter are internal platform credits, not bank deposits, e-money or withdrawable cash. Do not advertise cash redemption unless the product has been redesigned and reviewed for the relevant financial, consumer-protection and payment rules.

## Before public launch

- Add email verification and secure password-reset delivery.
- Add admin multi-factor authentication and restrict admin access.
- Add production media storage/CDN, file scanning and content moderation.
- Publish privacy policy, terms, community rules and data-retention information.
- Tune rate limits, spam protection, abuse reporting and moderation staffing.
- Set up monitoring, error alerts, backups, restore drills and load testing.
- Have the code and payment flows independently security-reviewed.


## Voice messaging and voice calls

CHATHSI includes browser-based voice notes and one-to-one voice calling for all account tiers.

- Voice notes use the browser `MediaRecorder` API and are uploaded to the private voice directory on the persistent Render disk.
- Voice note playback is served through an authenticated endpoint that checks that the signed-in user is a sender or recipient of that message.
- Voice calls use WebRTC for audio and Socket.IO for authenticated call signalling. Microphone access requires HTTPS and user permission.
- The default public STUN server helps peers discover network routes, but STUN-only calling is not reliable on every carrier-grade NAT, restrictive Wi-Fi or mobile network. For production reliability, configure a TURN service using `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL`. TURN may have a separate cost.

### Render disk paths

Mount the persistent disk at `/var/data/chathsi` and set:

```env
DATABASE_PATH=/var/data/chathsi/chathsi.db
UPLOAD_DIR=/var/data/chathsi/uploads
VOICE_DIR=/var/data/chathsi/voice-private
```

Set `MAX_VOICE_MB=12` (or a suitable limit) to control voice-note upload size. Voice-note media is private; do not expose the `VOICE_DIR` as a static directory.

### Voice feature checks before launch

1. Use HTTPS and grant microphone permission in the browser.
2. Test voice-note recording, cancellation, upload, playback, and access denial for a non-participant.
3. Test calls between two accounts on different networks and devices.
4. Configure and test TURN before relying on calls for public production use.
5. Test call rejection, hang-up, microphone mute, blocked-user restrictions, and reconnect behaviour.
