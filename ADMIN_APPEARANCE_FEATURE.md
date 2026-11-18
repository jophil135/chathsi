# Admin appearance controls

The administrator can now manage the platform-wide appearance from Admin control centre:

- Primary and secondary brand colours (validated six-digit hex colours)
- Light, dark, midnight-blue and rose themes
- Seasonal/event accents: celebration, Christmas, Valentine, Halloween, New Year and Nigeria Independence
- Optional event banner text (maximum 60 characters)

Settings are stored in the existing SQLite-backed `settings` collection under the `appearance` key. The public `/api/config` endpoint exposes the active appearance settings; only authenticated administrators can update them through `PATCH /api/admin/appearance`. Updates are audited and broadcast to connected clients over Socket.IO.

No database reset or migration is required. Existing installations receive safe defaults when no appearance setting exists. This update does not change wallet, gift, account, or message records.

## Validation performed

- `node --check src/server.js`
- `node --check public/app.js`

A live multi-user deployment test has not been performed; verify the theme from an administrator account and a separate ordinary account after deployment.
