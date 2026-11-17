# CHATHSI — Social platform starter

A responsive social-network application built with Node.js, Express, MongoDB, Socket.IO and vanilla HTML/CSS/JavaScript.

## Included

- Account registration, login, logout and profile editing
- Public social feed, text/photo posts, likes, comments and repost-style sharing
- Follow/unfollow and user search
- Direct messages with Socket.IO real-time delivery while both users are online
- Stories with a 24-hour expiry window
- Notifications for likes, comments, follows, messages and gifts
- User blocking and reporting
- Wallet balances, top-up requests, gift inventory and gift transfer requests
- Admin dashboard for user moderation, payment-method toggles, gift catalogue, top-up approvals, gift-transfer approvals, free-gift issuance, premium plans and platform settings
- Audit events and ledger entries for wallet mutations
- Blue primary theme and purple/gold premium styling
- Footer: **Built by Jossy Studios**

## Confirmed CHATHSI wallet rules

1. Gift conversion is 100% of the gift's configured NGN face value.
2. Every top-up requires admin approval, including card top-up requests in this starter.
3. Every gift transfer requires admin approval.
4. Only administrators can issue free gifts.
5. A transfer request locks the gift item while pending.
6. When approved, the gift is consumed and the recipient receives the configured gift value as internal CHATHSI credits (100%). The consumed gift cannot be transferred again.
7. Internal credits are not cash and cannot be withdrawn in this starter.
8. Admin actions are recorded in an audit log. All wallet balance changes are represented by ledger entries.

## Run locally

Requirements: Node.js 20+ and MongoDB.

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

Set a strong `JWT_SECRET` and change `ADMIN_PASSWORD` before first launch. The server creates the initial administrator from the environment variables if that email does not already exist.

## Deployment

Deploy as a Node web service with a managed MongoDB database. Configure all `.env.example` variables in the hosting dashboard. Set `COOKIE_SECURE=true` behind HTTPS. Use persistent/private object storage for media in production; local `uploads/` is only a simple development storage option.

## Payments — important

This project includes admin-configurable payment method visibility and a manually reviewed top-up request flow. It does **not** collect card details and does not pretend to verify card payments. Before enabling real card or bank payments, an eligible business/account owner must onboard with a payment provider, configure provider-side checkout and signed webhooks, and reconcile provider references server-side. Never accept a screenshot or browser-side success callback as proof of payment. Do not store card numbers or CVVs.

## Before a public launch

This is a functional starter, not a completed compliance/security certification. Arrange a professional security review and add:
- Email verification and secure password-reset delivery
- Payment-provider integration and reconciliation
- Production object storage/CDN and malware/content scanning for uploads
- Rate limits tuned to real traffic, spam/abuse detection and moderation staffing
- Privacy policy, terms, community guidelines and data-retention procedures
- Backups, monitoring, error reporting and load testing
- Strong admin MFA and restricted admin access
- Legal/accounting review if credits ever become redeemable for money

Do not promise cash withdrawals or monetary returns from virtual gifts. This starter treats wallet amounts as platform-only credits.
