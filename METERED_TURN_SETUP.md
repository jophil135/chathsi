# Metered TURN setup for CHATHIS

CHATHIS now accepts multiple TURN endpoints from the server environment and passes them to the browser through `/api/config`. TURN credentials are read only by the server and are not hard-coded in frontend files.

## Render environment variables

Set these in Render → CHATHIS → Environment:

```env
STUN_URL=stun:stun.relay.metered.ca:80
TURN_URLS=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
TURN_USERNAME=YOUR_ROTATED_METERED_TURN_USERNAME
TURN_CREDENTIAL=YOUR_ROTATED_METERED_TURN_CREDENTIAL
```

Use the newly generated username and credential from Metered. Do not paste them into GitHub, source code, `.env.example`, or chat. Since the previous credential was exposed in chat, revoke/rotate it before deploying this update.

`TURN_URLS` can be a comma-separated list as shown above or a JSON array. The older `TURN_URL` variable remains supported for deployments using one TURN endpoint. If `TURN_URLS` is set, it takes precedence over `TURN_URL`. The app will only add TURN endpoints when both `TURN_USERNAME` and `TURN_CREDENTIAL` are set.

## Deploy and verify

1. Replace the changed files in GitHub using the paths listed in the update instructions.
2. Add/update the four Render environment variables above. Keep the username and credential only in Render.
3. Trigger a Render deploy and wait for it to finish.
4. While signed in, open `https://YOUR-CHATHIS-DOMAIN/api/config` and inspect `rtc.iceServers`. It should contain one STUN entry and one TURN entry whose `urls` is an array of four URLs. The response includes ICE credentials for browser WebRTC use, so do not share or publish the response.
5. Test voice and video calls on two separate networks/devices. A successful page load alone does not prove TURN relay connectivity.

If calls still fail, check Render logs and Metered usage/allowed endpoints. Also confirm both devices have microphone/camera permission and are using HTTPS.
