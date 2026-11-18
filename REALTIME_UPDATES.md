# CHATHSI automatic live updates

The existing authenticated Socket.IO connection now receives server-side update events after successful database writes.

- New text/photo/video posts: `feed:refresh`
- Post likes and comments: `feed:refresh`
- New image/video/text stories: `story:created`
- Profile/avatar changes: `profile:updated` (public profile fields only)
- Private messages and voice messages: existing `message` event
- Group messages, including attached images/videos: existing `group:message` event
- Group membership changes: existing `group:updated` event

The browser refreshes the visible feed without requiring a manual reload and preserves the post composer draft and selected feed filter. The server remains the source of truth: the browser fetches the latest records after receiving an event. Socket.IO authenticates each connection using the existing HttpOnly session cookie.

## Deployment and verification

Deploy the complete project to Render. Open CHATHSI in two separate browser sessions/accounts. Publish a post, comment, like, story, upload a profile picture, send a private message, and send a group message from one session. Verify the other session updates without refreshing. Also test video uploads. This archive has passed JavaScript syntax and ZIP integrity checks; a live two-account Render test has not been performed here.
