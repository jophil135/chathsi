# CHATHIS build status — 18 November 2026

This archive is based on the latest saved CHATHSI project ZIP supplied in the conversation. It contains the existing social app and the following implemented changes in this build:

- Default product display name corrected to **CHATHIS**.
- Admin-only API and dashboard form to change the platform display name (1–32 characters).
- Chat text draft is restored after the conversation view is re-rendered, preventing an incoming refresh from clearing the recipient's unsent text.
- CSS improvements for independently scrollable comment areas, chat message panes, mobile chat controls, and responsive story media.
- Premium plan cards and the sidebar premium banner use a black-and-gold treatment.
- Reduced-motion preferences are respected.

## Important items not yet implemented or verified

This is an improved working base, **not a completed production release of every requested feature**. The original app is still SQLite-backed. CockroachDB migration is not implemented in this archive. Do not set `DATABASE_URL` and assume the application is using CockroachDB.

The original wallet still treats gift value as platform wallet credits. It does not yet maintain a separate withdrawable gift-earnings ledger, reserve funds during withdrawal review, or implement user withdrawal requests and admin payout confirmation. Purchased top-up credits must remain non-withdrawable in the planned implementation.

The current Socket.IO call signalling is one-to-one. Group WebRTC calls and their participant/room lifecycle are not implemented here. Voice/video calls still need real multi-network testing and a configured TURN service for reliable connectivity. External GIF/sticker provider integration is not implemented; the current picker is the built-in sticker catalogue.

The archive retains the existing profile upload implementation and media upload plumbing. It has not been independently verified against a live hosting environment or real mobile devices. The upload progress component should be tested with the actual hosting storage configuration.

## Before production deployment

1. Keep the existing database and uploads backed up. Do not delete or overwrite them.
2. Do not change Render's database environment until a CockroachDB adapter and data migration have been implemented and tested.
3. Use a persistent object-storage service for user-uploaded media; Render's ephemeral filesystem is not durable across all deployment/restart scenarios.
4. Configure TURN credentials for WebRTC and test calls on different networks and devices.
5. Run `npm install`, then `npm run check`, and test all flows in a staging deployment before promoting this build.

The package has not been tested against a live CockroachDB cluster because no cluster connection was supplied. No claim of line-by-line human review or three complete review passes is made.
