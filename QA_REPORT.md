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
