# CHATHSI Ultimate Build — QA Report

## Source package
Built from the latest available social-features archive. The package includes the previously implemented social feed, stories, private/group messaging, friends, stickers, chat streaks, presence, audio/video calling, wallet/gifts, admin appearance controls and moderation, with the new advertiser workflow described in `ADVERTISING_SYSTEM.md`.

## Automated checks performed in this build
- `npm run check` executed three times after the final edits.
- The check script validates JavaScript syntax for `src/server.js`, `src/sqlite-store.js`, `src/models.js`, and `public/app.js`.
- ZIP archive integrity (`unzip -t`) was checked after packaging.
- Source was reviewed for the new advertiser model registration, campaign submission validation, admin review routes, sponsored feed rendering, impression/click counters, and advert reporting.

## Not tested in this environment
- Dependencies are not installed in this build workspace, so no live SQLite/server integration test was run.
- No two-account browser test, camera/microphone hardware test, external-network WebRTC test, or live Render deployment test was run.
- Syntax checks are not a guarantee that every runtime or hosting issue is absent.

## Important limitations
- Advertising payment is manually verified by an administrator. There is no payment gateway, automatic billing, CPC/CPM charge calculation, or automatic budget deduction.
- Video calls require HTTPS, camera/microphone permission, and a working ICE route. TURN may be required on restrictive networks.
- The Render Free ephemeral filesystem can lose SQLite data and uploaded media on restart/redeploy. Use persistent storage and backups before real production use.
- Presence is process-local and resets when the server restarts; multi-instance hosting requires shared presence and a Socket.IO adapter.
