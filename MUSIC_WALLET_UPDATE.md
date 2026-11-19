# CHATHIS Music, Comments, Admin and Wallet Update

## Features included
- New Music navigation section for uploading and playing creator-owned audio. Supported audio types include MP3, WAV, OGG, AAC/M4A, FLAC and WEBM. Default upload limit: 30 MB (`MAX_SONG_MB`).
- Music is stored with the configured Cloudinary media storage. If Cloudinary is not configured, uploads use local temporary storage and can be lost after a Render restart.
- Post comment threads are independently scrollable and support replies.
- Reduced hover movement and layout instability; stable scroll gutters and reduced-motion support are included.
- Admin dashboard loads its data panels independently and shows a warning when one panel fails rather than blanking the whole page.
- If `ADMIN_EMAIL` exactly matches an existing account, startup promotes that account to admin (provided the admin seed configuration is valid). The existing password is not changed.
- Approved gift transfers add to a separate `withdrawableBalance`. Top-up credits do not. Gift earnings are consumed first when spending wallet credits, preventing already-spent earnings from being withdrawn later.
- Users can request withdrawals by entering bank name, account name and a 10-digit account number. Funds are reserved immediately; rejected requests restore the amount. Admins approve or reject requests.
- Admin can configure company bank name, account name and account number in Admin → Payment methods. These details appear in the wallet top-up dialog.

## Admin payout procedure
The app does not initiate a bank transfer automatically. The administrator must make the transfer using the company's banking channel, then select Approve in the withdrawal approvals panel. Select Reject if the payout cannot be made; the amount is returned to the user's withdrawable balance.

## Deployment notes
1. Replace the files from this ZIP in the existing GitHub repository; do not delete or recreate the CockroachDB database.
2. Keep existing Render environment variables, including `DATABASE_URL`, `DB_DRIVER`, `JWT_SECRET`, Cloudinary and Metered TURN settings.
3. Confirm `ADMIN_EMAIL` is the exact email address used by the admin account. The role promotion runs on server startup.
4. Redeploy on Render.
5. Check `/api/health`, log in as admin, configure the company bank details, upload a test song and test the withdrawal request/approval flow with a small test balance.

## Important limits
- The actual bank payout is manual and must be completed before the admin marks a withdrawal approved.
- Existing historical gift credits are not automatically reclassified as withdrawable earnings; only gift transfers approved after this update increase the new withdrawable balance.
- Existing local media files are not migrated to Cloudinary by this update.
- Static syntax and ZIP integrity checks were run. Live CockroachDB, Cloudinary upload, payment and Render deployment tests were not available in this build environment.
