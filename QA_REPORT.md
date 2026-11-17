# CHATHSI SQLite + Voice Edition — QA report

## Voice features added

- Free voice-message recording using the browser MediaRecorder API.
- Voice-message upload endpoint with file-size and MIME allowlists.
- Voice files stored outside the public static uploads directory.
- Authenticated voice playback endpoint that verifies the logged-in user is a participant in the message.
- Message records include voice type, audio URL, MIME type and duration.
- Free one-to-one voice calling using WebRTC.
- Socket.IO signalling events for invite, accept, reject, offer, answer, ICE candidates and hang-up.
- Signalling derives sender identity from the authenticated socket session and checks account status and block relationships.
- Optional TURN configuration through server environment variables; public STUN is the fallback.
- UI controls for recording/sending voice notes, playback, starting calls, accepting/rejecting calls, mute and hang-up.

## Existing platform architecture retained

- SQLite via better-sqlite3; MongoDB is not required.
- Render Persistent Disk paths for database, public uploads and private voice media.
- Social feed, likes, comments, profiles, follows, stories, notifications, admin tools, wallet, gifts and premium membership.
- Wallet rules: 100% gift-value credit, admin approval for all top-ups and gift transfers, and admin-only free gift issuance.
- Blue main theme, purple/gold premium treatment and Jossy Studios footer.

## Automated checks performed for this revision

1. `npm run check` passed: Node syntax checks for server, SQLite adapter, models and browser application.
2. `package.json` JSON parsing passed.
3. `render.yaml` YAML parsing passed where the local YAML parser is available.
4. Static route checks confirmed the voice upload endpoint, authenticated voice playback endpoint and call configuration endpoint.
5. Static socket checks confirmed all required call-signalling event handlers are present.
6. Static UI checks confirmed recording, playback, calling, accept/reject, mute and hang-up controls are present.
7. Static storage checks confirmed voice files are stored outside the public `/uploads` static directory and `VOICE_DIR` is on the Render disk in the Blueprint.
8. ZIP archive integrity passed after packaging.

## Not yet verified / production caveats

- A live browser-to-browser WebRTC call was not run in this build environment. Test with two separate accounts, devices and networks after deployment.
- A TURN service is not bundled. STUN-only calling will fail on some restrictive networks; configure a TURN provider for production reliability.
- Browser microphone permission and HTTPS are required.
- Voice calls are one-to-one audio only. Video calling and group calls are not included.
- Dependency installation and full HTTP integration tests against the final deployed Render service remain to be performed.
- Run a security review, backup/restore drill and load test before public launch.


## Voice feature review (added)

- Added free voice-note recording and playback in private chats.
- Added authenticated voice-media retrieval restricted to conversation participants.
- Added Socket.IO call invite/accept/reject/end and WebRTC offer/answer/ICE relays.
- Added microphone mute, call duration, incoming call prompt, and end-call controls.
- Added configurable STUN/TURN settings and persistent private voice storage.

Limitations requiring staging validation: browser microphone permission and real two-network WebRTC tests cannot be fully simulated by static checks. STUN-only connectivity is not guaranteed on all networks; configure TURN for production reliability. The current UI implements one-to-one voice calls; video and group calls remain future work.
