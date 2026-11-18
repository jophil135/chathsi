# CHATHSI Chat Identity Fix

## Changes
- Added `GET /api/conversations`, which groups stored messages by the other participant relative to the authenticated account.
- Updated the Messages page to show actual recent conversations under the other participant's username, with unread counts and a last-message preview.
- Kept the people list as a way to start a new conversation.
- Updated the Socket.IO message handler to refresh the recent-chat list when a new message arrives while the Messages page is open.

## Validation
- `npm run check` passed: Node syntax checks for `src/server.js`, `src/sqlite-store.js`, `src/models.js`, and `public/app.js`.
- This is a source-level validation only. A live two-account test against the deployed Render service is still required.

## Deployment
Upload the changed `src/server.js` and `public/app.js` to the existing GitHub repository, commit, and push. Do not replace the deployed database or change storage settings as part of this fix.
