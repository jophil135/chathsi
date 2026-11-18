> **Build note:** See [ULTIMATE_BUILD_STATUS.md](./ULTIMATE_BUILD_STATUS.md) for exact implemented changes and outstanding production blockers. This version still uses SQLite.

# CHATHSI — Real-time Social Platform

A responsive social-network starter built with Node.js, Express, SQLite, Socket.IO and vanilla HTML/CSS/JavaScript. Main brand colour: blue; premium styling: purple and gold. Footer credit: **BUILT BY JOSSY STUDIOS**.

## Included features

- Registration, login, logout and editable user profiles
- Social feed with text/photo/video posts, likes, comments, sharing and photo/video/text filters
- Follow/unfollow, user search and blocking
- Direct messages with automatic Socket.IO delivery while both users are connected
- Live online/offline indicators in people lists, suggestions, recent chats and the open conversation header
- Presence tracks multiple tabs/devices for each account; a user is marked offline only after their last active socket disconnects
- Free browser-recorded voice messages with playback controls and authenticated audio access
- Free one-to-one voice calls and video calls using WebRTC
- Incoming and outgoing call ringtones, accept/reject, mute, camera toggle, call timer and hang-up
- 24-hour photo, video and text stories with a story viewer and previous/next navigation
- Live feed/story/profile updates, notifications and group chat updates
- Group chats with member/admin management, image/video sharing and live messages
- Reporting and admin moderation
- Wallet, top-up requests, gift catalogue and gift inventory
- Admin-issued free gifts
- Admin dashboard for user moderation, payment-method settings, gift management, top-up review, gift-transfer review, premium plans and platform settings
- Audit log and wallet ledger
- Admin-controlled global colours, light/dark/midnight/rose themes and seasonal decorations

## Important hosting and data warning

This ZIP is configured for the **Render Free web-service plan with temporary `/tmp` storage**, because that plan does not provide a Persistent Disk. It is a demo/testing deployment, not safe permanent storage. Render may replace the instance or clear temporary files during deploys/restarts. That can erase accounts, posts, messages, wallet records, stories and uploaded media. Do not use this ephemeral-storage deployment for real-money balances or as a permanent production social network.

For durable launch, move SQLite and uploads to persistent storage (a paid persistent disk) or migrate the database to managed PostgreSQL and media to object storage. A single SQLite file must not be shared across multiple app instances.

## Requirements

- Node.js 22 (pinned in `package.json` and `.node-version`)
- npm
- GitHub account and Render web service for hosted deployment

## Run locally

```bash
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Edit `.env` and set a long, random `JWT_SECRET`, a unique `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD`. For local development use `COOKIE_SECURE=false`; Render uses HTTPS and `COOKIE_SECURE=true`.

```env
NODE_ENV=development
PORT=3000
DATABASE_PATH=./data/chathsi.db
UPLOAD_DIR=./uploads
VOICE_DIR=./voice-private
COOKIE_SECURE=false
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
ADMIN_EMAIL=you@example.com
ADMIN_USERNAME=chathsi_admin
ADMIN_PASSWORD=replace-with-a-unique-strong-admin-password
```

Then run:

```bash
npm start
```

Open `http://localhost:3000`. The server creates the first administrator on startup only when `ADMIN_EMAIL` and a non-placeholder `ADMIN_PASSWORD` are configured. If that admin already exists, changing the environment variable does not automatically reset the password.

## Deploy the current demo build to Render Free

1. Download and extract this ZIP.
2. Open the extracted `CHATHSI` folder. Upload the **contents** of that folder to the root of your GitHub repository (not the ZIP file itself).
3. Commit the changes to the repository's `main` branch.
4. In Render, open your existing CHATHSI Web Service and confirm it is connected to the correct GitHub repository and `main` branch.
5. Use build command `npm install` and start command `npm start`.
6. In Render → Environment, set the following values. Keep `JWT_SECRET` and `ADMIN_PASSWORD` private and never commit them to GitHub.

```env
NODE_ENV=production
DATABASE_PATH=/tmp/chathsi.db
UPLOAD_DIR=/tmp/chathsi-uploads
VOICE_DIR=/tmp/chathsi-voice
COOKIE_SECURE=true
MAX_IMAGE_MB=8
MAX_MEDIA_MB=50
MAX_VOICE_MB=12
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_USERNAME=chathsi_admin
ADMIN_PASSWORD=your-unique-strong-password
JWT_SECRET=your-long-random-secret
```

7. Do **not** set a fixed `PORT`; Render supplies it automatically.
8. Save the environment settings and trigger a deploy. If dependencies fail to build, verify that the service is using Node 22 and clear the build cache before redeploying.
9. Open the deployed site in two separate browsers or private sessions, register two test users, and verify messages, online/offline status, voice calls and video calls in both directions.
10. Remember that `/tmp` is temporary. Back up nothing important there; migrate to persistent database and media storage before inviting real users or relying on wallet records.

The included `render.yaml` is a Free-plan, temporary-storage blueprint example. Review it before applying it to an existing service.

## Presence behaviour

- The server authenticates every Socket.IO connection using the HttpOnly CHATHSI session cookie; the browser cannot claim another user's identity.
- A member becomes online when their first authenticated socket connects.
- If the same member has multiple tabs/devices open, closing one tab does not mark them offline while another socket remains connected.
- The server broadcasts online/offline transitions; visible status labels update without a page refresh.
- Presence is in-memory and resets if the server process restarts. In a multi-instance deployment it must be moved to a shared presence store (for example Redis) before scaling horizontally.

## Voice messages and calls

- Voice messages use browser `MediaRecorder`, are uploaded to `VOICE_DIR`, and are served through an authenticated route that verifies the requester is a sender or recipient.
- Voice and video calls use WebRTC peer-to-peer media. Socket.IO carries authenticated call signalling only; audio/video is not recorded or stored by CHATHSI.
- Incoming and outgoing call tones are generated in the browser. Browser audio policies may require the user to interact with the site before sound can play.
- Microphone and camera permissions are required. Calls need HTTPS in production (localhost is permitted for local development).
- The default public STUN server may work for some network combinations but is not sufficient for every carrier/router. Configure a TURN provider in Render Environment for better reliability:

```env
TURN_URL=turn:your-turn-host:3478
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-secret
```

Use provider-issued credentials, preferably short-lived. Never commit TURN credentials to GitHub. TURN relay usage may cost money. Test on actual mobile networks and browsers; do not assume every network supports direct peer-to-peer connections.

## Wallet rules included in this starter

1. Gift conversion is 100% of the gift's configured NGN face value.
2. Every top-up request requires administrator approval.
3. Every gift transfer requires administrator approval.
4. Only administrators can issue free gifts.
5. Wallet credits are internal CHATHSI platform credits, not withdrawable cash.
6. Card payment is not automatically verified in this starter. Do not credit card requests until a real payment provider and signed server-side webhook verification are integrated.

## Checks

Run:

```bash
npm run check
```

This performs JavaScript syntax checks on the server, storage layer, models and browser application. It is not a substitute for two-account browser testing, microphone/camera permission testing, network/TURN testing or a production security review.

---

**BUILT BY JOSSY STUDIOS**

## Latest social/chat additions (v1.3.0)
- Live online/offline status via authenticated Socket.IO presence.
- Incoming/outgoing call tones and one-to-one audio/video WebRTC calls.
- Sticker picker in private and group chats.
- Friend requests with accept/decline and a friends list under Explore.
- Private chat streaks based on distinct UTC days with messages.

See `FRIENDS_STICKERS_STREAKS.md` and `REALTIME_CALLING_PRESENCE.md` for behavior and deployment caveats.

## Advertising

CHATHSI includes an advertiser submission page and admin approval workflow. Campaigns remain pending until an administrator confirms payment and approves the creative. Sponsored posts are labelled and reportable. See `ADVERTISING_SYSTEM.md` for the current scope and important billing limitations. No automated payment gateway, CPM/CPC billing, or sensitive-interest ad targeting is enabled.

## Important deployment note

The default SQLite database and uploaded media are stored on the service filesystem. On hosts with ephemeral filesystems, they can be lost during restarts or redeploys. Use persistent storage or a managed database/object store before treating this as a production social network or storing real wallet balances.

## Admin dashboard and media uploads
- After signing in with an account whose role is `admin`, choose **Admin panel** in the desktop sidebar or **Admin** in the mobile navigation.
- Direct dashboard URL: `/admin` (for example, `https://your-domain.onrender.com/admin`). You must already be signed in as an administrator.
- Profile pictures accept JPG/JPEG, PNG, GIF and WEBP up to 12 MB by default. The profile form uses a PATCH multipart upload and displays upload progress.
- Photo/video posts and stories display a live percentage progress bar while the browser sends the file. The media upload limit remains 50 MB by default (`MAX_MEDIA_MB`).
- If a profile picture still fails, check the browser's Network response and Render logs for the returned upload error. Render's temporary filesystem can also discard uploaded files after restarts unless persistent storage is configured.

## CockroachDB setup and SQLite data migration

This build uses CockroachDB through the PostgreSQL wire protocol and the `pg` driver when `DB_DRIVER=cockroach`. The old SQLite adapter remains available during the staged export phase with `DB_DRIVER=sqlite`. CockroachDB schema setup runs at startup; multi-statement wallet/gift operations use SERIALIZABLE transactions and retry SQLSTATE `40001` with bounded backoff.

### Configure CockroachDB

1. Create a CockroachDB cluster and database.
2. Copy the PostgreSQL connection string from the cluster's connection details. It should include the host, port, database, username, password, and TLS mode.
3. Add it to Render as `DATABASE_URL`, but keep `DB_DRIVER=sqlite` until the export has been imported. Never commit the connection string to GitHub.
4. If your provider gives you a CA certificate, set `DATABASE_CA_CERT` in Render to the certificate contents. TLS verification is enabled by default; do not disable it in production.
5. After the snapshot import succeeds, change Render `DB_DRIVER` to `cockroach` and deploy. Startup creates the `documents` JSONB table and indexes, then seeds the administrator and default settings only when they do not already exist.

### Export/import existing data

Deploy this build first with `DB_DRIVER=sqlite` so it continues using the SQLite adapter. The old SQLite deployment can then export a JSON snapshot using the admin-only endpoint `GET /api/admin/database-export`. Sign in as an administrator in the same browser and open `/api/admin/database-export`; keep the downloaded file private because it contains account records and password hashes.

To import the snapshot into a new CockroachDB database, on a trusted computer:

1. Install Node.js 22 and download the project source.
2. Run `npm install`.
3. Put `DATABASE_URL=your-full-connection-string` in a local `.env` file (do not commit it).
4. Run `node scripts/import-snapshot.js path/to/chathis-database-export.json`.
5. Confirm the import count, then set the same `DATABASE_URL` in Render and deploy the CockroachDB version.
6. Keep the export file private and delete it securely after verifying the migration. Only then switch `DB_DRIVER` to `cockroach` in Render and redeploy.

**Important storage limitation:** the previous Render configuration used `/tmp/chathsi.db`, which is ephemeral. Render may discard files in `/tmp` when a service restarts or redeploys. If the old SQLite file is no longer present, this application cannot recover those records from CockroachDB; use an existing backup if you have one. Do not assume that deploying this update will preserve a `/tmp` database.

### Database utilities

- `npm run check` checks JavaScript syntax.
- `npm run db:check` verifies the configured CockroachDB connection and prints database/version details.
- `npm run db:import -- path/to/chathis-database-export.json` imports an admin-exported snapshot. Existing document IDs are not overwritten.

The JSONB document adapter preserves the existing model API while moving storage to CockroachDB. It currently filters model queries in application memory, so this is a compatibility migration rather than a final high-scale relational schema. Add collection-specific SQL indexes and query methods as usage grows.
