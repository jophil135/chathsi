# CHATHSI Ultimate QA report

## Static checks performed in this build
- `node --check src/server.js` — passed
- `node --check src/sqlite-store.js` — passed
- `node --check src/models.js` — passed
- `node --check public/app.js` — passed
- Verified multipart profile updates use HTTP PATCH (matching `/api/me`).
- Verified progress UI is wired to XHR upload progress for profile pictures, feed posts/videos, stories, and advertiser media.
- Verified admin navigation is exposed only to admin-role accounts in desktop and mobile navigation, and `/admin` loads the admin page after authentication.

## Not performed
- No live Render deployment, browser end-to-end test, camera test, or persistent-database test was performed in this environment.
- Upload success still depends on correct Render environment variables, available disk space, network quality, and the deployed build being updated.

## Upload defaults
- Profile images: 12 MB (`MAX_IMAGE_MB`)
- Post/story/ad media: 50 MB (`MAX_MEDIA_MB`)
- Voice messages: 12 MB (`MAX_VOICE_MB`)


## Persistent media patch
- Added Cloudinary-backed Multer storage for image/video uploads when credentials are configured.
- Updated profile, post, story, group attachment and advert records to save the Cloudinary HTTPS URL.
- Added `/api/health` media-storage status and `PERSISTENT_MEDIA_SETUP.md`.
- Voice messages remain on local disk; this patch does not claim they are persistent.
- Requires a configured Cloudinary account and a live Render upload/restart test; those cannot be completed in this local build environment.


## Additional feature update
- Added a dedicated Music library with audio upload, playback, uploader attribution and owner/admin removal.
- Added scrollable comments and threaded replies.
- Reduced unnecessary hover motion and layout shifting; added stable scroll gutters and reduced-motion support.
- Admin dashboard now loads independent data requests with partial-failure messaging instead of failing the entire page when one panel endpoint errors.
- Configured `ADMIN_EMAIL` now promotes the exact existing account to admin on startup if necessary.
- Added separate withdrawable gift earnings. Gift transfers add to withdrawable earnings; purchased top-ups do not. Gift earnings are consumed before top-up credits during in-app gift purchases.
- Added admin-reviewed withdrawal requests and configurable company bank transfer details.
- Static JavaScript syntax checks pass. Live database, Cloudinary audio upload, bank payout and Render deployment tests have not been run in this environment.
