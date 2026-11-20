# Chat stability and camera update

- Incoming private and group messages append to the existing message list instead of replacing the entire chat DOM. This preserves scroll position and drafts.
- Chat lists have bounded independent scrolling and no smooth-scroll animation.
- Post/story media selection is explicitly confirmed before upload.
- Stories support toggleable likes persisted on the story document.
- Camera uses browser getUserMedia and canvas capture, with safe visual filters and draggable emoji overlays. Camera access requires HTTPS and user permission.
- Admin can add/remove custom CSS filter presets. The endpoint only accepts a narrow allowlist of CSS filter functions; it does not execute JavaScript.
- Existing database collections are reused; no database reset or media migration is performed.
