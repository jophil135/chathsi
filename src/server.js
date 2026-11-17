require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const M = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required. Copy .env.example to .env and set it.');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadDir, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 8) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) return cb(new Error('Only JPG, PNG, GIF and WEBP images are accepted.'));
    cb(null, true);
  }
});

const safeUser = u => ({
  id: u._id, username: u.username, email: u.email, displayName: u.displayName,
  bio: u.bio, avatar: u.avatar, role: u.role, premium: u.premium,
  premiumUntil: u.premiumUntil, walletBalance: u.walletBalance,
  followersCount: u.followers?.length || 0, followingCount: u.following?.length || 0,
  createdAt: u.createdAt
});
const tokenFor = u => jwt.sign({ id: u._id.toString() }, JWT_SECRET, { expiresIn: '7d' });
const auth = async (req, res, next) => {
  try {
    const token = req.cookies.chathsi || (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await M.User.findById(decoded.id);
    if (!user || user.isSuspended) return res.status(401).json({ error: 'Account unavailable.' });
    req.user = user; next();
  } catch { return res.status(401).json({ error: 'Your session has expired. Please log in again.' }); }
};
const admin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required.' });
const notify = async (user, actor, type, text, link = '') => {
  if (!user || String(user) === String(actor)) return;
  const n = await M.Notification.create({ user, actor, type, text, link });
  io.to(`user:${user}`).emit('notification', n);
};
const audit = (adminId, action, targetType = '', targetId = '', details = '') =>
  M.Audit.create({ admin: adminId, action, targetType, targetId: String(targetId || ''), details });
const makeRef = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const convoKey = (a, b) => [String(a), String(b)].sort().join(':');

async function seed() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (email && password && password !== 'ChangeThisPasswordBeforeDeploying123!') {
    const existing = await M.User.findOne({ email });
    if (!existing) {
      const passwordHash = await bcrypt.hash(password, 12);
      await M.User.create({ username: process.env.ADMIN_USERNAME || 'chathsi_admin', email, passwordHash, displayName: 'CHATHSI Admin', role: 'admin' });
      console.log(`Initial admin created: ${email}`);
    }
  } else {
    console.warn('Admin seed skipped. Set ADMIN_EMAIL and a strong non-example ADMIN_PASSWORD.');
  }
  const defaults = [
    ['paymentMethods', { bankTransfer: true, card: true, bankInstructions: 'Admin will provide verified bank transfer instructions here.' }],
    ['premiumPlans', [
      { key: 'plus', name: 'CHATHSI Plus', price: 2500, benefits: ['Premium badge', 'Profile themes', 'Creator analytics'] },
      { key: 'pro', name: 'CHATHSI Pro', price: 5000, benefits: ['Everything in Plus', 'Advanced creator tools', 'Priority support'] }
    ]],
    ['platform', { name: 'CHATHSI', tagline: 'Connect. Express. Belong.', allowRegistration: true }]
  ];
  for (const [key, value] of defaults) await M.Setting.updateOne({ key }, { $setOnInsert: { key, value } }, { upsert: true });
  const gifts = [
    ['Rose', 'A little appreciation', '🌹', 100],
    ['Diamond', 'A sparkling thank-you', '💎', 500],
    ['Trophy', 'Celebrate a creator', '🏆', 2000],
    ['Royal Crown', 'For someone special', '👑', 5000]
  ];
  for (const [name, description, emoji, value] of gifts)
    await M.Gift.updateOne({ name }, { $setOnInsert: { name, description, emoji, value, active: true } }, { upsert: true });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'CHATHSI API' }));
app.get('/api/config', async (_req, res) => {
  const methods = await M.Setting.findOne({ key: 'paymentMethods' }).lean();
  const plans = await M.Setting.findOne({ key: 'premiumPlans' }).lean();
  const platform = await M.Setting.findOne({ key: 'platform' }).lean();
  res.json({ paymentMethods: methods?.value || {}, premiumPlans: plans?.value || [], platform: platform?.value || {} });
});

// Authentication
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;
    if (!username || !/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!password || password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    const registration = await M.Setting.findOne({ key: 'platform' });
    if (registration?.value?.allowRegistration === false) return res.status(403).json({ error: 'Registration is currently closed.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await M.User.create({ username, email, passwordHash, displayName: displayName || username });
    res.cookie('chathsi', tokenFor(user), { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 86400000 });
    res.status(201).json({ user: safeUser(user) });
  } catch (e) { res.status(400).json({ error: e.code === 11000 ? 'Username or email is already registered.' : 'Could not create account.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const user = await M.User.findOne({ email: String(req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash)) || user.isSuspended)
    return res.status(401).json({ error: 'Email or password is incorrect, or the account is unavailable.' });
  user.lastSeen = new Date(); await user.save();
  res.cookie('chathsi', tokenFor(user), { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 86400000 });
  res.json({ user: safeUser(user) });
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('chathsi'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: safeUser(req.user) }));
app.patch('/api/me', auth, upload.single('avatar'), async (req, res) => {
  const { displayName, bio } = req.body;
  if (displayName !== undefined) req.user.displayName = String(displayName).slice(0, 50);
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 180);
  if (req.file) req.user.avatar = `/uploads/${req.file.filename}`;
  await req.user.save(); res.json({ user: safeUser(req.user) });
});

// Users, follows, blocking
app.get('/api/users', auth, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  const users = await M.User.find({ _id: { $ne: req.user._id }, isSuspended: false, $or: [{ username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { displayName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }).limit(30);
  res.json({ users: users.map(safeUser) });
});
app.post('/api/users/:id/follow', auth, async (req, res) => {
  if (String(req.user._id) === req.params.id) return res.status(400).json({ error: 'You cannot follow yourself.' });
  const target = await M.User.findById(req.params.id);
  if (!target || target.isSuspended) return res.status(404).json({ error: 'User not found.' });
  const following = req.user.following.some(id => String(id) === String(target._id));
  if (following) {
    req.user.following.pull(target._id); target.followers.pull(req.user._id);
  } else {
    req.user.following.addToSet(target._id); target.followers.addToSet(req.user._id);
    await notify(target._id, req.user._id, 'follow', `${req.user.username} followed you.`);
  }
  await Promise.all([req.user.save(), target.save()]);
  res.json({ following: !following });
});
app.post('/api/users/:id/block', auth, async (req, res) => {
  if (String(req.user._id) === req.params.id) return res.status(400).json({ error: 'You cannot block yourself.' });
  const target = await M.User.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  req.user.blockedUsers.addToSet(target._id); await req.user.save(); res.json({ ok: true });
});

// Posts
app.get('/api/posts', auth, async (req, res) => {
  const posts = await M.Post.find({ isRemoved: false }).sort({ createdAt: -1 }).limit(60)
    .populate('author', 'username displayName avatar premium')
    .populate('comments.author', 'username displayName avatar');
  res.json({ posts });
});
app.post('/api/posts', auth, upload.single('media'), async (req, res) => {
  const text = String(req.body.text || '').trim();
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : '';
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Write something or attach an image.' });
  const post = await M.Post.create({ author: req.user._id, text, mediaUrl });
  await post.populate('author', 'username displayName avatar premium');
  res.status(201).json({ post });
});
app.post('/api/posts/:id/like', auth, async (req, res) => {
  const post = await M.Post.findById(req.params.id);
  if (!post || post.isRemoved) return res.status(404).json({ error: 'Post not found.' });
  const liked = post.likes.some(id => String(id) === String(req.user._id));
  if (liked) post.likes.pull(req.user._id); else {
    post.likes.addToSet(req.user._id);
    await notify(post.author, req.user._id, 'like', `${req.user.username} liked your post.`, `post:${post._id}`);
  }
  await post.save(); res.json({ liked: !liked, likes: post.likes.length });
});
app.post('/api/posts/:id/comments', auth, async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Comment must be 1–1000 characters.' });
  const post = await M.Post.findById(req.params.id);
  if (!post || post.isRemoved) return res.status(404).json({ error: 'Post not found.' });
  post.comments.push({ author: req.user._id, text }); await post.save();
  await notify(post.author, req.user._id, 'comment', `${req.user.username} commented on your post.`, `post:${post._id}`);
  await post.populate('comments.author', 'username displayName avatar');
  res.status(201).json({ comments: post.comments });
});
app.post('/api/posts/:id/report', auth, async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Please provide a reason.' });
  await M.Report.create({ reporter: req.user._id, targetType: 'post', targetId: req.params.id, reason });
  res.status(201).json({ ok: true });
});

// Stories
app.get('/api/stories', auth, async (_req, res) => {
  const stories = await M.Story.find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).populate('author', 'username avatar');
  res.json({ stories });
});
app.post('/api/stories', auth, upload.single('media'), async (req, res) => {
  const text = String(req.body.text || '').slice(0, 500);
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : '';
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Add text or an image to your story.' });
  const story = await M.Story.create({ author: req.user._id, text, mediaUrl, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  res.status(201).json({ story });
});

// Messages
app.get('/api/messages/:userId', auth, async (req, res) => {
  const other = await M.User.findById(req.params.userId);
  if (!other) return res.status(404).json({ error: 'User not found.' });
  if (req.user.blockedUsers.some(id => String(id) === String(other._id)) || other.blockedUsers.some(id => String(id) === String(req.user._id)))
    return res.status(403).json({ error: 'Messaging is unavailable.' });
  const key = convoKey(req.user._id, other._id);
  const messages = await M.Message.find({ conversationKey: key }).sort({ createdAt: 1 }).limit(200).populate('sender', 'username avatar');
  await M.Message.updateMany({ conversationKey: key, recipient: req.user._id, readAt: null }, { readAt: new Date() });
  res.json({ messages, user: safeUser(other) });
});
app.post('/api/messages/:userId', auth, async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 4000) return res.status(400).json({ error: 'Message must be 1–4000 characters.' });
  const recipient = await M.User.findById(req.params.userId);
  if (!recipient || recipient.isSuspended) return res.status(404).json({ error: 'Recipient not found.' });
  if (req.user.blockedUsers.some(id => String(id) === String(recipient._id)) || recipient.blockedUsers.some(id => String(id) === String(req.user._id)))
    return res.status(403).json({ error: 'Messaging is unavailable.' });
  const message = await M.Message.create({ conversationKey: convoKey(req.user._id, recipient._id), sender: req.user._id, recipient: recipient._id, text });
  await message.populate('sender', 'username avatar');
  io.to(`user:${recipient._id}`).emit('message', message);
  await notify(recipient._id, req.user._id, 'message', `New message from ${req.user.username}.`);
  res.status(201).json({ message });
});

// Notifications
app.get('/api/notifications', auth, async (req, res) => {
  const items = await M.Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(60).populate('actor', 'username avatar');
  res.json({ notifications: items });
});
app.post('/api/notifications/read', auth, async (req, res) => {
  await M.Notification.updateMany({ user: req.user._id, readAt: null }, { readAt: new Date() });
  res.json({ ok: true });
});

// Wallet, top-ups and gift catalogue
app.get('/api/wallet', auth, async (req, res) => {
  const [items, ledger, topups, transfers] = await Promise.all([
    M.GiftItem.find({ owner: req.user._id }).populate('gift').sort({ createdAt: -1 }),
    M.Ledger.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
    M.Topup.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20),
    M.GiftTransfer.find({ $or: [{ sender: req.user._id }, { recipient: req.user._id }] }).sort({ createdAt: -1 }).limit(20).populate('sender recipient', 'username')
  ]);
  res.json({ balance: req.user.walletBalance, gifts: items, ledger, topups, transfers });
});
app.get('/api/gifts', auth, async (_req, res) => res.json({ gifts: await M.Gift.find({ active: true }).sort({ value: 1 }) }));
app.post('/api/wallet/topups', auth, async (req, res) => {
  const amount = Math.floor(Number(req.body.amount));
  const method = req.body.method;
  if (!Number.isFinite(amount) || amount < 100 || amount > 10000000) return res.status(400).json({ error: 'Top-up amount must be between ₦100 and ₦10,000,000.' });
  if (!['bank_transfer', 'card'].includes(method)) return res.status(400).json({ error: 'Choose a supported payment method.' });
  const config = await M.Setting.findOne({ key: 'paymentMethods' });
  const methods = config?.value || {};
  if (method === 'bank_transfer' && !methods.bankTransfer) return res.status(403).json({ error: 'Bank transfer is currently unavailable.' });
  if (method === 'card' && !methods.card) return res.status(403).json({ error: 'Card payment is currently unavailable.' });
  // This creates a review request only. No money is collected and no credit is added here.
  const reference = makeRef('TOPUP');
  const topup = await M.Topup.create({ user: req.user._id, amount, method, reference, proofUrl: String(req.body.proofUrl || '').slice(0, 500) });
  res.status(201).json({ topup, message: 'Request submitted for administrator review. Your wallet has not been credited yet.' });
});
app.post('/api/wallet/buy-gift', auth, async (req, res) => {
  const gift = await M.Gift.findOne({ _id: req.body.giftId, active: true });
  const quantity = Math.max(1, Math.min(20, Math.floor(Number(req.body.quantity) || 1)));
  if (!gift) return res.status(404).json({ error: 'Gift not found.' });
  const total = gift.value * quantity;
  if (req.user.walletBalance < total) return res.status(400).json({ error: 'Insufficient CHATHSI credits. Top up your wallet first.' });
  req.user.walletBalance -= total;
  await req.user.save();
  const items = await M.GiftItem.create(Array.from({ length: quantity }, () => ({ owner: req.user._id, gift: gift._id, originalValue: gift.value, acquiredFrom: 'purchase' })));
  await M.Ledger.create({ user: req.user._id, type: 'gift_purchase', amount: -total, balanceAfter: req.user.walletBalance, reference: makeRef('GIFTBUY'), description: `Purchased ${quantity} × ${gift.name}` });
  res.status(201).json({ items, balance: req.user.walletBalance });
});
app.post('/api/wallet/gift-transfer', auth, async (req, res) => {
  const recipient = await M.User.findOne({ username: String(req.body.username || '').trim() });
  if (!recipient || String(recipient._id) === String(req.user._id)) return res.status(404).json({ error: 'Enter a valid recipient username.' });
  if (req.user.blockedUsers.some(id => String(id) === String(recipient._id)) || recipient.blockedUsers.some(id => String(id) === String(req.user._id)))
    return res.status(403).json({ error: 'This transfer is unavailable.' });
  const item = await M.GiftItem.findOne({ _id: req.body.giftItemId, owner: req.user._id, status: 'available' }).populate('gift');
  if (!item) return res.status(404).json({ error: 'Available gift not found.' });
  item.status = 'pending'; await item.save();
  const transfer = await M.GiftTransfer.create({ sender: req.user._id, recipient: recipient._id, giftItem: item._id, value: item.originalValue });
  await notify(recipient._id, req.user._id, 'gift_pending', `${req.user.username} requested to send you a gift. It is awaiting admin approval.`);
  res.status(201).json({ transfer, message: 'Gift transfer submitted for admin approval.' });
});

// Admin
app.get('/api/admin/overview', auth, admin, async (_req, res) => {
  const [users, posts, pendingTopups, pendingTransfers, reports, ledger] = await Promise.all([
    M.User.countDocuments(), M.Post.countDocuments({ isRemoved: false }),
    M.Topup.countDocuments({ status: 'pending' }), M.GiftTransfer.countDocuments({ status: 'pending' }),
    M.Report.countDocuments({ status: 'open' }), M.Ledger.countDocuments()
  ]);
  res.json({ users, posts, pendingTopups, pendingTransfers, openReports: reports, ledgerEntries: ledger });
});
app.get('/api/admin/users', auth, admin, async (_req, res) => {
  const users = await M.User.find().sort({ createdAt: -1 }).limit(200);
  res.json({ users: users.map(safeUser) });
});
app.patch('/api/admin/users/:id', auth, admin, async (req, res) => {
  const user = await M.User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (String(user._id) === String(req.user._id) && req.body.isSuspended === true) return res.status(400).json({ error: 'You cannot suspend your own admin account.' });
  if (typeof req.body.isSuspended === 'boolean') user.isSuspended = req.body.isSuspended;
  if (['free', 'plus', 'pro'].includes(req.body.premium)) user.premium = req.body.premium;
  await user.save(); await audit(req.user._id, 'user_updated', 'user', user._id, `suspended=${user.isSuspended}; premium=${user.premium}`);
  res.json({ user: safeUser(user) });
});
app.get('/api/admin/topups', auth, admin, async (_req, res) => res.json({ topups: await M.Topup.find().sort({ createdAt: -1 }).limit(200).populate('user', 'username email') }));
app.post('/api/admin/topups/:id/review', auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
  const topup = await M.Topup.findById(req.params.id);
  if (!topup || topup.status !== 'pending') return res.status(409).json({ error: 'Top-up is not pending.' });
  if (status === 'approved') {
    const user = await M.User.findById(topup.user);
    if (!user) return res.status(404).json({ error: 'Top-up user no longer exists.' });
    user.walletBalance += topup.amount; await user.save();
    await M.Ledger.create({ user: user._id, type: 'topup', amount: topup.amount, balanceAfter: user.walletBalance, reference: topup.reference, description: `Approved ${topup.method} top-up`, actor: req.user._id });
    await notify(user._id, req.user._id, 'topup_approved', `Your ₦${topup.amount.toLocaleString()} top-up was approved.`);
  }
  topup.status = status; topup.adminNote = String(req.body.note || '').slice(0, 500); topup.reviewedBy = req.user._id; topup.reviewedAt = new Date(); await topup.save();
  await audit(req.user._id, `topup_${status}`, 'topup', topup._id, topup.adminNote);
  res.json({ topup });
});
app.get('/api/admin/transfers', auth, admin, async (_req, res) => res.json({ transfers: await M.GiftTransfer.find().sort({ createdAt: -1 }).limit(200).populate('sender recipient', 'username email').populate({ path: 'giftItem', populate: { path: 'gift' } }) }));
app.post('/api/admin/transfers/:id/review', auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
  const transfer = await M.GiftTransfer.findById(req.params.id);
  if (!transfer || transfer.status !== 'pending') return res.status(409).json({ error: 'Transfer is not pending.' });
  const item = await M.GiftItem.findById(transfer.giftItem);
  if (!item || item.status !== 'pending' || String(item.owner) !== String(transfer.sender)) return res.status(409).json({ error: 'Gift item is no longer eligible.' });
  if (status === 'approved') {
    const recipient = await M.User.findById(transfer.recipient);
    if (!recipient) return res.status(404).json({ error: 'Recipient no longer exists.' });
    item.status = 'transferred'; await item.save();
    // The gift is consumed (not re-transferable); full face value is credited as internal CHATHSI credits exactly once.
    recipient.walletBalance += transfer.value; await recipient.save();
    await M.Ledger.create({ user: recipient._id, type: 'gift_received', amount: transfer.value, balanceAfter: recipient.walletBalance, reference: `TRANSFER_${transfer._id}`, description: 'Gift transfer value credited (100%)', actor: req.user._id });
    await notify(recipient._id, req.user._id, 'gift_received', `Your gift transfer was approved. ₦${transfer.value.toLocaleString()} CHATHSI credits were added.`);
  } else {
    item.status = 'available'; await item.save();
    await notify(transfer.sender, req.user._id, 'gift_rejected', 'Your gift transfer was declined. The gift is available in your inventory again.');
  }
  transfer.status = status; transfer.adminNote = String(req.body.note || '').slice(0, 500); transfer.reviewedBy = req.user._id; transfer.reviewedAt = new Date(); await transfer.save();
  await audit(req.user._id, `gift_transfer_${status}`, 'gift_transfer', transfer._id, transfer.adminNote);
  res.json({ transfer });
});
app.post('/api/admin/gifts', auth, admin, async (req, res) => {
  const { name, description, emoji } = req.body;
  const value = Math.floor(Number(req.body.value));
  if (!name || !Number.isFinite(value) || value < 1) return res.status(400).json({ error: 'Gift name and a positive value are required.' });
  const gift = await M.Gift.create({ name: String(name).slice(0, 40), description: String(description || '').slice(0, 160), emoji: String(emoji || '🎁').slice(0, 8), value, active: req.body.active !== false });
  await audit(req.user._id, 'gift_created', 'gift', gift._id, `${gift.name}: ${gift.value}`);
  res.status(201).json({ gift });
});
app.patch('/api/admin/gifts/:id', auth, admin, async (req, res) => {
  const gift = await M.Gift.findById(req.params.id);
  if (!gift) return res.status(404).json({ error: 'Gift not found.' });
  if (req.body.name !== undefined) gift.name = String(req.body.name).slice(0, 40);
  if (req.body.description !== undefined) gift.description = String(req.body.description).slice(0, 160);
  if (req.body.emoji !== undefined) gift.emoji = String(req.body.emoji).slice(0, 8);
  if (req.body.value !== undefined) gift.value = Math.max(1, Math.floor(Number(req.body.value)));
  if (typeof req.body.active === 'boolean') gift.active = req.body.active;
  await gift.save(); await audit(req.user._id, 'gift_updated', 'gift', gift._id, gift.name);
  res.json({ gift });
});
app.post('/api/admin/gifts/issue', auth, admin, async (req, res) => {
  const user = await M.User.findOne({ username: String(req.body.username || '').trim() });
  const gift = await M.Gift.findById(req.body.giftId);
  const quantity = Math.max(1, Math.min(100, Math.floor(Number(req.body.quantity) || 1)));
  if (!user || !gift) return res.status(404).json({ error: 'User or gift not found.' });
  const items = await M.GiftItem.create(Array.from({ length: quantity }, () => ({ owner: user._id, gift: gift._id, originalValue: gift.value, acquiredFrom: 'admin' })));
  await notify(user._id, req.user._id, 'admin_gift', `An administrator gifted you ${quantity} × ${gift.name}.`);
  await audit(req.user._id, 'free_gift_issued', 'user', user._id, `${quantity} × ${gift.name}`);
  res.status(201).json({ items });
});
app.get('/api/admin/gifts', auth, admin, async (_req, res) => res.json({ gifts: await M.Gift.find().sort({ value: 1 }) }));
app.patch('/api/admin/payment-methods', auth, admin, async (req, res) => {
  const current = (await M.Setting.findOne({ key: 'paymentMethods' }))?.value || {};
  const next = {
    bankTransfer: typeof req.body.bankTransfer === 'boolean' ? req.body.bankTransfer : !!current.bankTransfer,
    card: typeof req.body.card === 'boolean' ? req.body.card : !!current.card,
    bankInstructions: req.body.bankInstructions !== undefined ? String(req.body.bankInstructions).slice(0, 1000) : (current.bankInstructions || '')
  };
  await M.Setting.updateOne({ key: 'paymentMethods' }, { $set: { value: next } }, { upsert: true });
  await audit(req.user._id, 'payment_methods_updated', 'setting', 'paymentMethods', JSON.stringify(next));
  res.json({ paymentMethods: next });
});
app.patch('/api/admin/plans', auth, admin, async (req, res) => {
  if (!Array.isArray(req.body.plans)) return res.status(400).json({ error: 'Plans must be an array.' });
  const plans = req.body.plans.filter(p => ['plus', 'pro'].includes(p.key)).map(p => ({
    key: p.key, name: String(p.name || '').slice(0, 50), price: Math.max(0, Math.floor(Number(p.price) || 0)),
    benefits: Array.isArray(p.benefits) ? p.benefits.slice(0, 12).map(x => String(x).slice(0, 100)) : []
  }));
  await M.Setting.updateOne({ key: 'premiumPlans' }, { $set: { value: plans } }, { upsert: true });
  await audit(req.user._id, 'premium_plans_updated', 'setting', 'premiumPlans');
  res.json({ plans });
});
app.get('/api/admin/reports', auth, admin, async (_req, res) => res.json({ reports: await M.Report.find().sort({ createdAt: -1 }).limit(200).populate('reporter', 'username') }));
app.post('/api/admin/reports/:id/resolve', auth, admin, async (req, res) => {
  const status = ['reviewed', 'dismissed'].includes(req.body.status) ? req.body.status : 'reviewed';
  const report = await M.Report.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  await audit(req.user._id, 'report_resolved', 'report', report._id, status); res.json({ report });
});
app.delete('/api/admin/posts/:id', auth, admin, async (req, res) => {
  const post = await M.Post.findByIdAndUpdate(req.params.id, { isRemoved: true }, { new: true });
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  await audit(req.user._id, 'post_removed', 'post', post._id); res.json({ ok: true });
});
app.get('/api/admin/audit', auth, admin, async (_req, res) => res.json({ audit: await M.Audit.find().sort({ createdAt: -1 }).limit(200).populate('admin', 'username') }));
app.get('/api/admin/ledger', auth, admin, async (_req, res) => res.json({ ledger: await M.Ledger.find().sort({ createdAt: -1 }).limit(300).populate('user', 'username') }));

// Socket authentication: no client-supplied user identity is trusted.
io.use(async (socket, next) => {
  try {
    // The session cookie is HttpOnly; read it from the handshake rather than exposing it to browser JS.
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookiePair = cookieHeader.split(';').map(x => x.trim()).find(x => x.startsWith('chathsi='));
    const token = cookiePair ? decodeURIComponent(cookiePair.slice('chathsi='.length)) : '';
    if (!token) return next(new Error('Authentication required'));
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await M.User.findById(decoded.id);
    if (!user || user.isSuspended) return next(new Error('Account unavailable'));
    socket.userId = String(user._id); next();
  } catch { next(new Error('Invalid session')); }
});
io.on('connection', socket => {
  socket.join(`user:${socket.userId}`);
  socket.on('typing', ({ recipientId, active }) => {
    if (recipientId) io.to(`user:${recipientId}`).emit('typing', { userId: socket.userId, active: !!active });
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: err.message || 'Server error.' });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chathsi')
  .then(async () => { await seed(); server.listen(PORT, () => console.log(`CHATHSI running on ${PORT}`)); })
  .catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
