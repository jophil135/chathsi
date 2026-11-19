# CHATHIS persistent media setup

This build streams public image/video uploads to Cloudinary when configured. This covers profile pictures, feed posts, stories, group-chat attachments and advert media. CockroachDB continues to store the records and the Cloudinary HTTPS URL.

## 1. Create Cloudinary credentials
1. Create/sign in to a Cloudinary account at https://cloudinary.com/.
2. Open the Cloudinary Console / Dashboard.
3. Copy the Cloud name, API Key and API Secret. Treat the API Secret as a password. Never put it in frontend JavaScript or commit it to GitHub.

## 2. Add Render environment variables
In Render, open the CHATHIS web service, then Environment, then add:
- `CLOUDINARY_CLOUD_NAME` = your Cloudinary cloud name
- `CLOUDINARY_API_KEY` = your Cloudinary API key
- `CLOUDINARY_API_SECRET` = your Cloudinary API secret
- `CLOUDINARY_MEDIA_FOLDER` = `chathis`

Alternatively set only `CLOUDINARY_URL` using the complete URL shown by Cloudinary. Do not set both methods unless you know which takes precedence. Do not share the URL; it contains credentials.

Save changes and redeploy.

## 3. Verify before uploading more media
Open `https://YOUR-CHATHIS-DOMAIN/api/health`. The JSON must report `"mediaStorage":"cloudinary"`. If it says `local-temporary`, do not rely on uploads surviving a restart: check the three Cloudinary values and redeploy.

Upload a new test story photo, open it from a second browser/device, restart the Render service, then open it again. The photo should remain visible. Old stories whose local files have already disappeared cannot be reconstructed by this migration; re-upload those photos.

## Scope and limitations
- Existing records are not deleted or migrated by this change. Existing local files are not automatically copied to Cloudinary.
- Voice-message audio still uses the existing local private directory in this build. It can still be lost on Render restart/redeploy. A separate private object-storage migration with authenticated access is required before claiming voice messages are durable.
- Cloudinary usage is subject to your account's plan, quotas and content policies.
- The app intentionally reports whether Cloudinary is configured through `/api/health`; it never exposes credentials.
