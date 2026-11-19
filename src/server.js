require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const M = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// Presence is tracked per authenticated socket so multiple tabs/devices do not
// incorrectly mark a member offline when only one connection closes.
const onlineUsers = new Map();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required. Copy .env.example to .env and set it.');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const voiceDir = path.resolve(process.env.VOICE_DIR || path.join(uploadDir, '..', 'voice-private'));
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(voiceDir, { recursive: true });
const cloudMediaEnabled = Boolean(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
if (cloudMediaEnabled && !process.env.CLOUDINARY_URL) {
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
}
if (!cloudMediaEnabled) console.warn('Persistent media storage is NOT configured. Uploaded images/videos will use local disk and may disappear on Render restarts. Configure Cloudinary before production uploads.');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadDir, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

const localStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`)
});
// Multer storage engine: stream uploads directly to Cloudinary so Render's
// ephemeral filesystem is never the source of truth for public media.
const cloudStorage = {
  _handleFile(_req, file, cb) {
    const folder = process.env.CLOUDINARY_MEDIA_FOLDER || 'chathis';
    const resourceType = (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) ? 'video' : 'image';
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: resourceType, use_filename: false, unique_filename: true }, (error, result) => {
      if (error) return cb(error);
      cb(null, { path: result.secure_url, filename: result.public_id, public_id: result.public_id, cloudinaryResourceType: resourceType, size: result.bytes, format: result.format });
    });
    file.stream.on('error', cb);
    file.stream.pipe(stream);
  },
  _removeFile(_req, file, cb) {
    if (!file.public_id) return cb(null);
    cloudinary.uploader.destroy(file.public_id, { resource_type: file.cloudinaryResourceType || 'image' }).then(() => cb(null), cb);
  }
};
const mediaStorage = cloudMediaEnabled ? cloudStorage : localStorage;
const imageUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: (Number(process.env.MAX_IMAGE_MB) || 12) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) return cb(new Error('Choose a JPG, PNG, GIF or WEBP image.'));
    cb(null, true);
  }
});
const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: (Number(process.env.MAX_MEDIA_MB) || 50) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const imageOk = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    const videoOk = /^video\/(mp4|webm|quicktime)$/.test(file.mimetype);
    if (!imageOk && !videoOk) return cb(new Error('Upload an image (JPG/PNG/GIF/WEBP) or video (MP4/WEBM/MOV).'));
    cb(null, true);
  }
});
const voiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, voiceDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase() || '.webm'}`)
});
const audioUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: (Number(process.env.MAX_SONG_MB) || 30) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^audio\/(mpeg|mp3|wav|ogg|opus|aac|mp4|x-m4a|flac|webm)/.test(file.mimetype)) return cb(new Error('Upload an MP3, WAV, OGG, AAC, M4A, FLAC or WEBM audio file.'));
    cb(null, true);
  }
});
const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: (Number(process.env.MAX_VOICE_MB) || 12) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^audio\/(webm|ogg|mpeg|mp4|wav|aac|mp4|3gpp)/.test(file.mimetype)) return cb(new Error('Unsupported audio format.'));
    cb(null, true);
  }
});

const safeUser = u => ({
  id: u._id, username: u.username, email: u.email, displayName: u.displayName,
  bio: u.bio, avatar: u.avatar, role: u.role, premium: u.premium,
  premiumUntil: u.premiumUntil, walletBalance: u.walletBalance, withdrawableBalance: Number(u.withdrawableBalance || 0),
  followersCount: u.followers?.length || 0, followingCount: u.following?.length || 0,
  createdAt: u.createdAt, isOnline: (onlineUsers.get(String(u._id))?.size || 0) > 0
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
// Admin-only one-time export for moving the current SQLite data into CockroachDB.
app.get('/api/admin/database-export', auth, admin, async (_req, res, next) => {
  try {
    if (typeof M.exportSnapshot !== 'function') return res.status(501).json({ error: 'Database export is unavailable.' });
    const snapshot = await M.exportSnapshot();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=chathis-database-export.json');
    res.send(JSON.stringify(snapshot));
  } catch (err) { next(err); }
});
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
      await M.User.create({ username: process.env.ADMIN_USERNAME || 'chathsi_admin', email, passwordHash, displayName: 'CHATHIS Admin', role: 'admin' });
      console.log(`Initial admin created: ${email}`);
    } else if (existing.role !== 'admin') {
      // The configured ADMIN_EMAIL is authoritative. Promote that exact account
      // so a previously registered admin email does not remain a normal user.
      existing.role = 'admin';
      await existing.save();
      console.log(`Configured admin account promoted: ${email}`);
    }
  } else {
    console.warn('Admin seed skipped. Set ADMIN_EMAIL and a strong non-example ADMIN_PASSWORD.');
  }
  const defaults = [
    ['paymentMethods', { bankTransfer: true, card: true, bankInstructions: 'Admin will provide verified bank transfer instructions here.', companyBankName: '', companyAccountName: '', companyAccountNumber: '' }],
    ['premiumPlans', [
      { key: 'plus', name: 'CHATHSI Plus', price: 2500, benefits: ['Premium badge', 'Profile themes', 'Creator analytics'] },
      { key: 'pro', name: 'CHATHSI Pro', price: 5000, benefits: ['Everything in Plus', 'Advanced creator tools', 'Priority support'] }
    ]],
    ['platform', { name: 'CHATHIS', tagline: 'Connect. Express. Belong.', allowRegistration: true }]
  ];
  for (const [key, value] of defaults) {
    await M.Setting.updateOne({ key }, { $setOnInsert: { key, value } }, { upsert: true });
    if (key === 'platform') { const saved = await M.Setting.findOne({ key }); if (saved?.value?.name === 'CHATHSI') { saved.value = { ...saved.value, name: 'CHATHIS' }; await saved.save(); } }
  }
  const gifts = [
    ['Rose', 'A little appreciation', '🌹', 100],
    ['Diamond', 'A sparkling thank-you', '💎', 500],
    ['Trophy', 'Celebrate a creator', '🏆', 2000],
    ['Royal Crown', 'For someone special', '👑', 5000]
  ];
  for (const [name, description, emoji, value] of gifts)
    await M.Gift.updateOne({ name }, { $setOnInsert: { name, description, emoji, value, active: true } }, { upsert: true });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'CHATHIS API', mediaStorage: cloudMediaEnabled ? 'cloudinary' : 'local-temporary' }));
app.get('/api/voice/:filename', auth, async (req, res) => {
  const filename = path.basename(req.params.filename);
  const audioUrl = `/api/voice/${filename}`;
  const message = await M.Message.findOne({ audioUrl, $or: [{ sender: req.user._id }, { recipient: req.user._id }] });
  if (!message) return res.status(404).json({ error: 'Voice message not found.' });
  return res.sendFile(path.join(voiceDir, filename));
});
app.get('/api/config', async (_req, res) => {
  const methods = await M.Setting.findOne({ key: 'paymentMethods' }).lean();
  const plans = await M.Setting.findOne({ key: 'premiumPlans' }).lean();
  const platform = await M.Setting.findOne({ key: 'platform' }).lean();
  const appearance = await M.Setting.findOne({ key: 'appearance' }).lean();
  // WebRTC ICE configuration. TURN_URLS accepts either a JSON array or a
  // comma-separated list. TURN_URL remains supported for older deployments.
  const iceServers = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;
  if (turnUsername && turnCredential) {
    let turnUrls = [];
    const configuredTurnUrls = process.env.TURN_URLS;
    if (configuredTurnUrls) {
      try {
        const parsed = JSON.parse(configuredTurnUrls);
        turnUrls = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        turnUrls = configuredTurnUrls.split(',');
      }
    } else if (process.env.TURN_URL) {
      turnUrls = [process.env.TURN_URL];
    }
    turnUrls = [...new Set(turnUrls.map(url => String(url).trim()).filter(url => /^(turn|turns):/i.test(url)))];
    if (turnUrls.length) iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
  }
  res.json({ paymentMethods: methods?.value || {}, premiumPlans: plans?.value || [], platform: platform?.value || {}, appearance: appearance?.value || { primary:'#2878f0', secondary:'#4c9bff', background:'#f5f8fc', surface:'#ffffff', text:'#15233b', mode:'light', decoration:'none', eventLabel:'' }, rtc: { iceServers } });
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
app.patch('/api/me', auth, imageUpload.single('avatar'), async (req, res) => {
  const { displayName, bio } = req.body;
  if (displayName !== undefined) req.user.displayName = String(displayName).slice(0, 50);
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 180);
  if (req.file) req.user.avatar = req.file.path.startsWith('http') ? req.file.path : `/uploads/${req.file.filename}`;
  await req.user.save();
  const updatedUser = safeUser(req.user);
  // Broadcast only public profile fields; never expose email, wallet balance or account controls.
  const publicProfile = { id: updatedUser.id, username: updatedUser.username, displayName: updatedUser.displayName, bio: updatedUser.bio, avatar: updatedUser.avatar, premium: updatedUser.premium, followersCount: updatedUser.followersCount, followingCount: updatedUser.followingCount };
  io.except(`user:${req.user._id}`).emit('profile:updated', { user: publicProfile });
  res.json({ user: updatedUser });
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
// Friend requests are separate from follows. A friendship is mutual only after acceptance.
app.post('/api/friends/request/:id', auth, async (req, res) => {
  const target = await M.User.findById(req.params.id);
  if (!target || target.isSuspended || String(target._id) === String(req.user._id)) return res.status(404).json({ error: 'Member not found.' });
  if (req.user.blockedUsers.some(id => String(id) === String(target._id)) || target.blockedUsers.some(id => String(id) === String(req.user._id))) return res.status(403).json({ error: 'Friend requests are unavailable.' });
  const existing = await M.FriendRequest.findOne({ $or: [{ sender: req.user._id, recipient: target._id }, { sender: target._id, recipient: req.user._id }] });
  if (existing) return res.status(409).json({ error: existing.status === 'accepted' ? 'You are already friends.' : 'A friend request already exists.' });
  const request = await M.FriendRequest.create({ sender: req.user._id, recipient: target._id, status: 'pending' });
  await notify(target._id, req.user._id, 'friend_request', `${req.user.username} sent you a friend request.`, '/explore');
  io.to(`user:${target._id}`).emit('friend:request', { requestId: request._id });
  res.status(201).json({ requestId: request._id, status: 'pending' });
});
app.get('/api/friends', auth, async (req, res) => {
  const [incoming, outgoing, accepted] = await Promise.all([
    M.FriendRequest.find({ recipient: req.user._id, status: 'pending' }).sort({ createdAt: -1 }),
    M.FriendRequest.find({ sender: req.user._id, status: 'pending' }).sort({ createdAt: -1 }),
    M.FriendRequest.find({ $or: [{ sender: req.user._id, status: 'accepted' }, { recipient: req.user._id, status: 'accepted' }] })
  ]);
  const hydrate = async (r, otherId) => { const u = await M.User.findById(otherId); return u ? { id: r._id, user: safeUser(u), createdAt: r.createdAt } : null; };
  res.json({ incoming: (await Promise.all(incoming.map(r => hydrate(r, r.sender)))).filter(Boolean), outgoing: (await Promise.all(outgoing.map(r => hydrate(r, r.recipient)))).filter(Boolean), friends: (await Promise.all(accepted.map(r => hydrate(r, String(r.sender) === String(req.user._id) ? r.recipient : r.sender)))).filter(Boolean) });
});
app.post('/api/friends/:requestId/respond', auth, async (req, res) => {
  const request = await M.FriendRequest.findById(req.params.requestId);
  if (!request || String(request.recipient) !== String(req.user._id) || request.status !== 'pending') return res.status(404).json({ error: 'Friend request not found.' });
  const action = req.body.action;
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Choose accept or decline.' });
  request.status = action === 'accept' ? 'accepted' : 'declined'; request.respondedAt = new Date().toISOString(); await request.save();
  if (action === 'accept') await notify(request.sender, req.user._id, 'friend_accepted', `${req.user.username} accepted your friend request.`, '/explore');
  io.to(`user:${request.sender}`).emit('friend:updated', { status: request.status });
  res.json({ status: request.status });
});
app.get('/api/streaks/:userId', auth, async (req, res) => {
  const other = await M.User.findById(req.params.userId);
  if (!other) return res.status(404).json({ error: 'Member not found.' });
  const key = convoKey(req.user._id, other._id);
  const messages = await M.Message.find({ conversationKey: key }).sort({ createdAt: 1 }).limit(5000);
  const days = [...new Set(messages.map(m => new Date(m.createdAt).toISOString().slice(0, 10)))].sort();
  let current = 0, best = 0, run = 0, previous = null;
  for (const day of days) { const d = new Date(day + 'T00:00:00Z'); run = previous && (d - previous) === 86400000 ? run + 1 : 1; best = Math.max(best, run); previous = d; }
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (days.length && [today, yesterday].includes(days[days.length - 1])) { current = 1; for (let i = days.length - 1; i > 0; i--) { if ((new Date(days[i] + 'T00:00:00Z') - new Date(days[i-1] + 'T00:00:00Z')) === 86400000) current++; else break; } }
  res.json({ current, best, activeToday: days.includes(today), days: days.length });
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
    .populate('comments.author', 'username displayName avatar')
    .populate('comments.replies.author', 'username displayName avatar');
  res.json({ posts });
});
app.post('/api/posts', auth, mediaUpload.single('media'), async (req, res) => {
  const text = String(req.body.text || '').trim();
  const mediaUrl = req.file ? (req.file.path.startsWith('http') ? req.file.path : `/uploads/${req.file.filename}`) : '';
  const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'video' : 'image') : '';
  const allowedMediaFilters = ['none','vivid','warm','cool','mono','vintage'];
  const mediaFilter = allowedMediaFilters.includes(req.body.mediaFilter) ? req.body.mediaFilter : 'none';
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Write something or attach a photo/video.' });
  const post = await M.Post.create({ author: req.user._id, text, mediaUrl, mediaType, mediaFilter });
  await post.populate('author', 'username displayName avatar premium');
  io.except(`user:${req.user._id}`).emit('feed:refresh', { type: 'post-created', postId: String(post._id) });
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
  await post.save();
  io.except(`user:${req.user._id}`).emit('feed:refresh', { type: 'post-liked', postId: String(post._id) });
  res.json({ liked: !liked, likes: post.likes.length });
});
app.post('/api/posts/:id/comments', auth, async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Comment must be 1–1000 characters.' });
  const post = await M.Post.findById(req.params.id);
  if (!post || post.isRemoved) return res.status(404).json({ error: 'Post not found.' });
  post.comments.push({ _id: makeRef('comment'), author: req.user._id, text, replies: [], createdAt: new Date().toISOString() }); await post.save();
  await notify(post.author, req.user._id, 'comment', `${req.user.username} commented on your post.`, `post:${post._id}`);
  await post.populate('comments.author', 'username displayName avatar');
  await post.populate('comments.replies.author', 'username displayName avatar');
  io.except(`user:${req.user._id}`).emit('feed:refresh', { type: 'post-commented', postId: String(post._id) });
  res.status(201).json({ comments: post.comments });
});
app.post('/api/posts/:id/comments/:commentId/replies', auth, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Write a reply first.' });
  const post = await M.Post.findById(req.params.id);
  if (!post || post.isRemoved) return res.status(404).json({ error: 'Post not found.' });
  const legacyIndex = String(req.params.commentId).startsWith('legacy-') ? Number(String(req.params.commentId).slice(7)) : -1;
  const comment = (post.comments || []).find((c, i) => String(c._id || c.id || `legacy-${i}`) === String(req.params.commentId));
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (!Array.isArray(comment.replies)) comment.replies = [];
  comment.replies.push({ _id: makeRef('reply'), author: req.user._id, text, createdAt: new Date().toISOString() });
  await post.save();
  await notify(post.author, req.user._id, 'comment_reply', `${req.user.username} replied to a comment on your post.`, `post:${post._id}`);
  io.except(`user:${req.user._id}`).emit('feed:refresh', { type: 'post-replied', postId: String(post._id) });
  res.status(201).json({ replies: comment.replies });
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
app.post('/api/stories', auth, mediaUpload.single('media'), async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  const mediaUrl = req.file ? (req.file.path.startsWith('http') ? req.file.path : `/uploads/${req.file.filename}`) : '';
  const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'video' : 'image') : '';
  const allowedMediaFilters = ['none','vivid','warm','cool','mono','vintage'];
  const mediaFilter = allowedMediaFilters.includes(req.body.mediaFilter) ? req.body.mediaFilter : 'none';
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Add a caption or choose a photo/video for your story.' });
  const story = await M.Story.create({ author: req.user._id, text, mediaUrl, mediaType, mediaFilter, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  await story.populate('author', 'username displayName avatar');
  io.except(`user:${req.user._id}`).emit('story:created', { storyId: String(story._id) });
  res.status(201).json({ story });
});

// Conversations: return one row per person the signed-in user has chatted with.
// The counterpart is always the OTHER participant, never the message sender by default.
app.get('/api/conversations', auth, async (req, res) => {
  const meId = String(req.user._id);
  const all = await M.Message.find({ $or: [{ sender: req.user._id }, { recipient: req.user._id }] }).sort({ createdAt: -1 }).limit(1000);
  const byUser = new Map();
  for (const message of all) {
    const senderId = String(message.sender);
    const recipientId = String(message.recipient);
    const otherId = senderId === meId ? recipientId : senderId;
    if (!otherId || otherId === meId || byUser.has(otherId)) continue;
    const other = await M.User.findById(otherId);
    if (!other || other.isSuspended) continue;
    const unread = await M.Message.countDocuments({ conversationKey: convoKey(meId, otherId), recipient: req.user._id, readAt: null });
    byUser.set(otherId, {
      user: safeUser(other),
      lastMessage: { text: message.text || '', audioUrl: message.audioUrl || '', createdAt: message.createdAt, senderId },
      unread
    });
  }
  res.json({ conversations: [...byUser.values()] });
});

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
// Stickers are first-class chat messages, stored as a safe catalogue key/emoji rather than arbitrary HTML.
const stickerCatalog = [
  { id:'heart', emoji:'💖', label:'Heart' }, { id:'laugh', emoji:'😂', label:'Laughing' }, { id:'love', emoji:'🥰', label:'In love' },
  { id:'fire', emoji:'🔥', label:'Fire' }, { id:'wow', emoji:'😮', label:'Wow' }, { id:'cry', emoji:'😭', label:'Crying' },
  { id:'clap', emoji:'👏', label:'Clapping' }, { id:'cool', emoji:'😎', label:'Cool' }, { id:'party', emoji:'🎉', label:'Celebration' },
  { id:'thanks', emoji:'🙏', label:'Thank you' }, { id:'hug', emoji:'🤗', label:'Hug' }, { id:'thumbs', emoji:'👍', label:'Thumbs up' },
  { id:'star', emoji:'⭐', label:'Star' }, { id:'sad', emoji:'😔', label:'Sad' }, { id:'wave', emoji:'👋', label:'Hello' }, { id:'rocket', emoji:'🚀', label:'Rocket' }
];
app.get('/api/stickers', auth, (_req, res) => res.json({ stickers: stickerCatalog }));
app.post('/api/messages/:userId/sticker', auth, async (req, res) => {
  const sticker = stickerCatalog.find(x => x.id === String(req.body.stickerId || ''));
  const recipient = await M.User.findById(req.params.userId);
  if (!sticker || !recipient || recipient.isSuspended) return res.status(400).json({ error: 'Sticker or recipient is unavailable.' });
  if (req.user.blockedUsers.some(id => String(id) === String(recipient._id)) || recipient.blockedUsers.some(id => String(id) === String(req.user._id))) return res.status(403).json({ error: 'Messaging is unavailable.' });
  const message = await M.Message.create({ conversationKey: convoKey(req.user._id, recipient._id), sender: req.user._id, recipient: recipient._id, text: sticker.emoji, messageType: 'sticker', stickerId: sticker.id });
  await message.populate('sender', 'username avatar'); io.to(`user:${recipient._id}`).emit('message', message);
  await notify(recipient._id, req.user._id, 'message', `New sticker from ${req.user.username}.`);
  res.status(201).json({ message });
});

// Group chats
const isGroupMember = (group, userId) => !!group && (group.members || []).some(id => String(id) === String(userId));
const leaveGroupSockets = (groupId, userId) => { for (const sock of io.sockets.sockets.values()) if (sock.userId === String(userId)) sock.leave(`group:${groupId}`); };
const isGroupAdmin = (group, userId) => !!group && (String(group.owner) === String(userId) || (group.admins || []).some(id => String(id) === String(userId)));
const groupSummary = async (group, userId) => {
  const members = await Promise.all((group.members || []).map(async id => { const u = await M.User.findById(id); return u ? { id: u._id, username: u.username, displayName: u.displayName, avatar: u.avatar } : null; }));
  const last = await M.GroupMessage.findOne({ group: group._id }).sort({ createdAt: -1 });
  return { id: group._id, name: group.name, description: group.description || '', avatar: group.avatar || '', owner: String(group.owner), admins: (group.admins || []).map(String), members: members.filter(Boolean), memberCount: members.filter(Boolean).length, isAdmin: isGroupAdmin(group,userId), lastMessage: last ? { text: last.text || '', sender: String(last.sender), createdAt: last.createdAt } : null };
};
app.get('/api/groups', auth, async (req, res) => {
  const groups = await M.Group.find({ members: req.user._id }).sort({ updatedAt: -1 }).limit(200);
  res.json({ groups: await Promise.all(groups.map(g => groupSummary(g, req.user._id))) });
});
app.post('/api/groups', auth, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0,60);
  const description = String(req.body.description || '').trim().slice(0,240);
  const usernames = Array.isArray(req.body.usernames) ? req.body.usernames : [];
  if (name.length < 2) return res.status(400).json({ error: 'Group name must contain at least 2 characters.' });
  if (usernames.length > 49) return res.status(400).json({ error: 'A group can have at most 50 members including you.' });
  const memberIds = [String(req.user._id)];
  for (const raw of usernames) {
    const username = String(raw || '').trim().replace(/^@/,''); if (!username) continue;
    const u = await M.User.findOne({ username });
    if (!u || u.isSuspended) return res.status(400).json({ error: `User @${username} was not found or is unavailable.` });
    if (!memberIds.includes(String(u._id))) memberIds.push(String(u._id));
  }
  const group = await M.Group.create({ name, description, owner: req.user._id, members: memberIds, admins: [String(req.user._id)] });
  for (const id of memberIds) { for (const sock of io.sockets.sockets.values()) if (sock.userId === id) sock.join(`group:${group._id}`); io.to(`user:${id}`).emit('group:updated', { groupId: group._id }); if (id !== String(req.user._id)) await notify(id, req.user._id, 'group', `You were added to ${name}.`, '/messages'); }
  res.status(201).json({ group: await groupSummary(group, req.user._id) });
});
app.get('/api/groups/:groupId/messages', auth, async (req, res) => {
  const group = await M.Group.findById(req.params.groupId);
  if (!isGroupMember(group, req.user._id)) return res.status(403).json({ error: 'You are not a member of this group.' });
  const messages = await M.GroupMessage.find({ group: group._id }).sort({ createdAt: 1 }).limit(300);
  const hydrated = await Promise.all(messages.map(async m => { const sender = await M.User.findById(m.sender); return { ...m.toJSON(), sender: sender ? { _id: sender._id, username: sender.username, avatar: sender.avatar } : null }; }));
  res.json({ group: await groupSummary(group, req.user._id), messages: hydrated });
});
app.post('/api/groups/:groupId/messages', auth, mediaUpload.single('media'), async (req, res) => {
  const group = await M.Group.findById(req.params.groupId);
  if (!isGroupMember(group, req.user._id)) return res.status(403).json({ error: 'You are not a member of this group.' });
  const sticker = stickerCatalog.find(x => x.id === String(req.body.stickerId || ''));
  const text = sticker ? sticker.emoji : String(req.body.text || '').trim().slice(0,4000);
  const mediaUrl = req.file ? (req.file.path.startsWith('http') ? req.file.path : `/uploads/${req.file.filename}`) : '';
  const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'video' : 'image') : '';
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Write a message or attach a photo/video.' });
  const message = await M.GroupMessage.create({ group: group._id, sender: req.user._id, text, mediaUrl, mediaType, messageType: sticker ? 'sticker' : 'text', stickerId: sticker?.id || '' });
  group.lastMessageAt = message.createdAt; await group.save();
  const payload = { ...message.toJSON(), sender: { _id: req.user._id, username: req.user.username, avatar: req.user.avatar } };
  io.to(`group:${group._id}`).emit('group:message', payload);
  for (const id of group.members || []) if (String(id) !== String(req.user._id)) await notify(id, req.user._id, 'group_message', `New message in ${group.name}.`, '/messages');
  res.status(201).json({ message: payload });
});
app.post('/api/groups/:groupId/members', auth, async (req, res) => {
  const group = await M.Group.findById(req.params.groupId);
  if (!isGroupAdmin(group, req.user._id)) return res.status(403).json({ error: 'Only group admins can add members.' });
  const username = String(req.body.username || '').trim().replace(/^@/,'');
  const user = await M.User.findOne({ username });
  if (!user || user.isSuspended) return res.status(404).json({ error: 'User not found.' });
  if (isGroupMember(group, user._id)) return res.status(409).json({ error: 'That user is already in the group.' });
  if ((group.members || []).length >= 50) return res.status(400).json({ error: 'This group has reached the 50-member limit.' });
  group.members.push(String(user._id)); await group.save();
  for (const sock of io.sockets.sockets.values()) if (sock.userId === String(user._id)) sock.join(`group:${group._id}`);
  io.to(`user:${user._id}`).emit('group:updated', { groupId: group._id });
  await notify(user._id, req.user._id, 'group', `You were added to ${group.name}.`, '/messages');
  res.json({ group: await groupSummary(group, req.user._id) });
});
app.patch('/api/groups/:groupId/members/:userId', auth, async (req, res) => {
  const group = await M.Group.findById(req.params.groupId);
  if (!isGroupAdmin(group, req.user._id)) return res.status(403).json({ error: 'Only group admins can manage members.' });
  const targetId = String(req.params.userId);
  if (!isGroupMember(group, targetId)) return res.status(404).json({ error: 'Member not found.' });
  if (targetId === String(group.owner)) return res.status(400).json({ error: 'The group owner cannot be removed or demoted.' });
  const action = String(req.body.action || '');
  if (action === 'remove') { group.members = group.members.filter(id => String(id) !== targetId); group.admins = (group.admins || []).filter(id => String(id) !== targetId); }
  else if (action === 'promote' && !(group.admins || []).some(id => String(id) === targetId)) group.admins.push(targetId);
  else if (action === 'demote') group.admins = (group.admins || []).filter(id => String(id) !== targetId);
  else return res.status(400).json({ error: 'Unsupported member action.' });
  await group.save(); if (action === 'remove') leaveGroupSockets(group._id, targetId); io.to(`user:${targetId}`).emit('group:updated', { groupId: group._id });
  res.json({ group: await groupSummary(group, req.user._id) });
});
app.delete('/api/groups/:groupId', auth, async (req, res) => {
  const group = await M.Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  if (String(group.owner) !== String(req.user._id)) return res.status(403).json({ error: 'Only the group owner can delete this group.' });
  await M.GroupMessage.deleteMany({ group: group._id });
  await M.Group.deleteMany({ _id: group._id });
  for (const id of group.members || []) { leaveGroupSockets(group._id, id); io.to(`user:${id}`).emit('group:updated', { groupId: group._id, deleted: true }); }
  res.json({ ok: true });
});
app.post('/api/groups/:groupId/leave', auth, async (req, res) => {
  const group = await M.Group.findById(req.params.groupId);
  if (!isGroupMember(group, req.user._id)) return res.status(404).json({ error: 'Group not found.' });
  if (String(group.owner) === String(req.user._id)) return res.status(400).json({ error: 'The owner must transfer ownership or delete the group before leaving.' });
  group.members = group.members.filter(id => String(id) !== String(req.user._id)); group.admins = (group.admins || []).filter(id => String(id) !== String(req.user._id));
  await group.save(); leaveGroupSockets(group._id, req.user._id); io.to(`user:${req.user._id}`).emit('group:updated', { groupId: group._id });
  res.json({ ok: true });
});

app.post('/api/messages/:userId/voice', auth, voiceUpload.single('audio'), async (req, res) => {
  const recipient = await M.User.findById(req.params.userId);
  if (!recipient || recipient.isSuspended) return res.status(404).json({ error: 'Recipient not found.' });
  if (String(recipient._id) === String(req.user._id)) return res.status(400).json({ error: 'You cannot send a voice message to yourself.' });
  if (!req.file) return res.status(400).json({ error: 'Choose a voice recording first.' });
  if (req.user.blockedUsers.some(id => String(id) === String(recipient._id)) || recipient.blockedUsers.some(id => String(id) === String(req.user._id))) return res.status(403).json({ error: 'Messaging is unavailable.' });
  const duration = Math.max(0, Math.min(600, Number(req.body.duration) || 0));
  const message = await M.Message.create({ conversationKey: convoKey(req.user._id, recipient._id), sender: req.user._id, recipient: recipient._id, text: '', audioUrl: `/api/voice/${req.file.filename}`, audioMime: req.file.mimetype, audioDuration: duration });
  await message.populate('sender', 'username avatar');
  io.to(`user:${recipient._id}`).emit('message', message);
  await notify(recipient._id, req.user._id, 'message', `Voice message from ${req.user.username}.`);
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

// Community music library. Uploaders retain ownership of their own tracks.
app.get('/api/songs', auth, async (_req, res) => {
  const songs = await M.Song.find({ status: 'published' }).sort({ createdAt: -1 }).limit(150).populate('uploader', 'username displayName avatar');
  res.json({ songs });
});
app.post('/api/songs', auth, audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an audio file to upload.' });
  const title = String(req.body.title || '').trim().slice(0, 100);
  const artist = String(req.body.artist || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'Enter a song title.' });
  const audioUrl = req.file.path && req.file.path.startsWith('http') ? req.file.path : `/uploads/${req.file.filename}`;
  const song = await M.Song.create({ uploader: req.user._id, title, artist, genre: String(req.body.genre || 'Other').slice(0, 40), audioUrl, mimeType: req.file.mimetype, fileSize: Number(req.file.size || 0), status: 'published' });
  await song.populate('uploader', 'username displayName avatar');
  res.status(201).json({ song });
});
app.delete('/api/songs/:id', auth, async (req, res) => {
  const song = await M.Song.findById(req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found.' });
  if (String(song.uploader) !== String(req.user._id) && req.user.role !== 'admin') return res.status(403).json({ error: 'You can only remove your own uploads.' });
  song.status = 'removed'; await song.save(); res.json({ ok: true });
});

// Wallet, top-ups and gift catalogue
app.get('/api/wallet', auth, async (req, res) => {
  const [items, ledger, topups, transfers, withdrawals] = await Promise.all([
    M.GiftItem.find({ owner: req.user._id }).populate('gift').sort({ createdAt: -1 }),
    M.Ledger.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
    M.Topup.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20),
    M.GiftTransfer.find({ $or: [{ sender: req.user._id }, { recipient: req.user._id }] }).sort({ createdAt: -1 }).limit(20).populate('sender recipient', 'username'),
    M.Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20)
  ]);
  res.json({ balance: req.user.walletBalance, withdrawableBalance: Number(req.user.withdrawableBalance || 0), gifts: items, ledger, topups, transfers, withdrawals });
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
app.post('/api/wallet/withdrawals', auth, async (req, res) => {
  const amount = Math.floor(Number(req.body.amount));
  const accountNumber = String(req.body.accountNumber || '').replace(/\s/g, '');
  const accountName = String(req.body.accountName || '').trim().slice(0, 100);
  const bankName = String(req.body.bankName || '').trim().slice(0, 80);
  if (!Number.isSafeInteger(amount) || amount < 100) return res.status(400).json({ error: 'Minimum withdrawal is ₦100.' });
  if (!/^\d{10}$/.test(accountNumber) || !accountName || !bankName) return res.status(400).json({ error: 'Enter a valid 10-digit account number, account name and bank.' });
  const result = await M.atomicCreateWithdrawal(req.user._id, amount, { accountNumber, accountName, bankName });
  if (result.error) return res.status(409).json({ error: result.error });
  res.status(201).json({ withdrawal: result.withdrawal, message: 'Withdrawal request sent to the admin for approval.' });
});
app.post('/api/wallet/buy-gift', auth, async (req, res) => {
  const quantity = Math.max(1, Math.min(20, Math.floor(Number(req.body.quantity) || 1)));
  const result = await M.atomicPurchaseGift(req.user._id, req.body.giftId, quantity);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ items: result.items, balance: result.user.walletBalance });
});
app.post('/api/wallet/gift-transfer', auth, async (req, res) => {
  const recipient = await M.User.findOne({ username: String(req.body.username || '').trim() });
  if (!recipient || String(recipient._id) === String(req.user._id)) return res.status(404).json({ error: 'Enter a valid recipient username.' });
  if (req.user.blockedUsers.some(id => String(id) === String(recipient._id)) || recipient.blockedUsers.some(id => String(id) === String(req.user._id)))
    return res.status(403).json({ error: 'This transfer is unavailable.' });
  const result = await M.atomicCreateGiftTransfer(req.user._id, recipient._id, req.body.giftItemId);
  if (result.error) return res.status(409).json({ error: result.error });
  await notify(recipient._id, req.user._id, 'gift_pending', `${req.user.username} requested to send you a gift. It is awaiting admin approval.`);
  res.status(201).json({ transfer: result.transfer, message: 'Gift transfer submitted for admin approval.' });
});

// CHATHSI Ads: contextual, age-appropriate campaigns. Every campaign is reviewed by an admin.
const safeAdUrl = value => { try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; } };
app.get('/api/ads', auth, async (req, res) => {
  const now = new Date().toISOString();
  const ads = await M.Advert.find({ status: 'approved', paymentStatus: 'approved', startsAt: { $lte: now }, endsAt: { $gte: now } }).sort({ createdAt: -1 }).limit(3);
  res.json({ ads: ads.filter(a => Number(a.budget || 0) > Number(a.spent || 0)).map(a => ({ id:a._id, businessName:a.businessName, headline:a.headline, body:a.body, mediaUrl:a.mediaUrl, destinationUrl:a.destinationUrl, placement:a.placement })) });
});
app.post('/api/ads/:id/impression', auth, async (req,res)=>{const ad=await M.Advert.findById(req.params.id);if(!ad||ad.status!=='approved')return res.status(404).json({error:'Ad unavailable.'});ad.impressions=Number(ad.impressions||0)+1;await ad.save();res.json({ok:true})});
app.post('/api/ads/:id/click', auth, async (req,res)=>{const ad=await M.Advert.findById(req.params.id);if(!ad||ad.status!=='approved')return res.status(404).json({error:'Ad unavailable.'});ad.clicks=Number(ad.clicks||0)+1;await ad.save();res.json({ok:true,url:ad.destinationUrl})});
app.post('/api/ads/:id/report', auth, async (req,res)=>{const ad=await M.Advert.findById(req.params.id);if(!ad)return res.status(404).json({error:'Advert not found.'});const reason=String(req.body.reason||'').trim().slice(0,500);if(!reason)return res.status(400).json({error:'Please provide a reason.'});await M.Report.create({reporter:req.user._id,targetType:'advert',targetId:ad._id,reason});res.status(201).json({ok:true})});
app.post('/api/advertiser/campaigns', auth, mediaUpload.single('media'), async (req,res)=>{
  const businessName=String(req.body.businessName||'').trim().slice(0,80), headline=String(req.body.headline||'').trim().slice(0,100), body=String(req.body.body||'').trim().slice(0,500), destinationUrl=safeAdUrl(req.body.destinationUrl);
  const budget=Number(req.body.budget), startsAt=new Date(req.body.startsAt), endsAt=new Date(req.body.endsAt);
  if(!businessName||!headline||!body||!destinationUrl||!Number.isFinite(budget)||budget<1000||!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt||endsAt<=new Date())return res.status(400).json({error:'Complete all fields. Use an HTTPS destination, budget of at least ₦1,000, and valid future campaign dates.'});
  const ad=await M.Advert.create({advertiser:req.user._id,businessName,headline,body,destinationUrl,budget,spent:0,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),mediaUrl:req.file?(req.file.path.startsWith('http')?req.file.path:`/uploads/${req.file.filename}`):'',placement:['feed','discover','communities'].includes(req.body.placement)?req.body.placement:'feed',status:'pending',paymentStatus:'pending'});
  await M.Audit.create({admin:req.user._id,targetType:'advert',targetId:ad._id,details:'Advertiser submitted campaign for review.'});
  res.status(201).json({campaign:ad,message:'Campaign submitted. It will not run until an admin approves the advert and payment.'});
});
app.get('/api/advertiser/campaigns', auth, async (req,res)=>{const campaigns=await M.Advert.find({advertiser:req.user._id}).sort({createdAt:-1}).limit(100);res.json({campaigns})});

// Admin
app.get('/api/admin/ads', auth, admin, async (_req,res)=>{const ads=await M.Advert.find().sort({createdAt:-1}).limit(200).populate('advertiser','username email');res.json({ads})});
app.post('/api/admin/ads/:id/review', auth, admin, async (req,res)=>{const ad=await M.Advert.findById(req.params.id);if(!ad)return res.status(404).json({error:'Campaign not found.'});const status=['approved','rejected','paused'].includes(req.body.status)?req.body.status:'';const paymentStatus=['approved','rejected','pending'].includes(req.body.paymentStatus)?req.body.paymentStatus:ad.paymentStatus;if(!status)return res.status(400).json({error:'Invalid campaign status.'});ad.status=status;ad.paymentStatus=paymentStatus;ad.adminNote=String(req.body.note||'').slice(0,500);ad.reviewedBy=req.user._id;ad.reviewedAt=new Date().toISOString();await ad.save();await M.Audit.create({admin:req.user._id,targetType:'advert',targetId:ad._id,details:`Campaign ${status}; payment ${paymentStatus}.`});res.json({campaign:ad})});
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
app.get('/api/admin/withdrawals', auth, admin, async (_req, res) => res.json({ withdrawals: await M.Withdrawal.find().sort({ createdAt: -1 }).limit(200).populate('user', 'username email') }));
app.post('/api/admin/withdrawals/:id/review', auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
  const result = await M.atomicReviewWithdrawal(req.params.id, req.user._id, status, req.body.note);
  if (result.error) return res.status(409).json({ error: result.error });
  await audit(req.user._id, `withdrawal_${status}`, 'withdrawal', req.params.id, result.withdrawal?.reference || '');
  if (status === 'approved') await notify(result.user, req.user._id, 'withdrawal_approved', 'Your withdrawal request was approved.');
  else await notify(result.user, req.user._id, 'withdrawal_rejected', 'Your withdrawal request was rejected and the amount was returned to your withdrawable balance.');
  res.json({ withdrawal: result.withdrawal });
});
app.get('/api/admin/topups', auth, admin, async (_req, res) => res.json({ topups: await M.Topup.find().sort({ createdAt: -1 }).limit(200).populate('user', 'username email') }));
app.post('/api/admin/topups/:id/review', auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
  const result = await M.atomicReviewTopup(req.params.id, req.user._id, status, req.body.note);
  if (result.error) return res.status(409).json({ error: result.error });
  const topup = await M.Topup.findById(req.params.id);
  if (status === 'approved') await notify(result.user, req.user._id, 'topup_approved', `Your ₦${topup.amount.toLocaleString()} top-up was approved.`);
  await audit(req.user._id, `topup_${status}`, 'topup', topup._id, topup.adminNote);
  res.json({ topup });
});
app.get('/api/admin/transfers', auth, admin, async (_req, res) => res.json({ transfers: await M.GiftTransfer.find().sort({ createdAt: -1 }).limit(200).populate('sender recipient', 'username email').populate({ path: 'giftItem', populate: { path: 'gift' } }) }));
app.post('/api/admin/transfers/:id/review', auth, admin, async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
  const result = await M.atomicReviewGiftTransfer(req.params.id, req.user._id, status, req.body.note);
  if (result.error) return res.status(409).json({ error: result.error });
  const transfer = await M.GiftTransfer.findById(req.params.id);
  if (status === 'approved') await notify(result.recipient, req.user._id, 'gift_received', `Your gift transfer was approved. ₦${Number(result.value).toLocaleString()} CHATHSI credits were added.`);
  else await notify(result.sender, req.user._id, 'gift_rejected', 'Your gift transfer was declined. The gift is available in your inventory again.');
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
    bankInstructions: req.body.bankInstructions !== undefined ? String(req.body.bankInstructions).slice(0, 1000) : (current.bankInstructions || ''),
    companyBankName: req.body.companyBankName !== undefined ? String(req.body.companyBankName).trim().slice(0, 80) : (current.companyBankName || ''),
    companyAccountName: req.body.companyAccountName !== undefined ? String(req.body.companyAccountName).trim().slice(0, 100) : (current.companyAccountName || ''),
    companyAccountNumber: req.body.companyAccountNumber !== undefined ? String(req.body.companyAccountNumber).replace(/\s/g, '').slice(0, 20) : (current.companyAccountNumber || '')
  };
  await M.Setting.updateOne({ key: 'paymentMethods' }, { $set: { value: next } }, { upsert: true });
  await audit(req.user._id, 'payment_methods_updated', 'setting', 'paymentMethods', JSON.stringify(next));
  res.json({ paymentMethods: next });
});
app.patch('/api/admin/platform', auth, admin, async (req, res) => {
  const current = (await M.Setting.findOne({ key: 'platform' }))?.value || {};
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(name)) return res.status(400).json({ error: 'Enter an app name of 1–32 letters, numbers, spaces, dots, underscores or hyphens.' });
  const next = { ...current, name };
  await M.Setting.updateOne({ key: 'platform' }, { $set: { value: next } }, { upsert: true });
  await audit(req.user._id, 'platform_name_updated', 'setting', 'platform', name);
  res.json({ platform: next });
});
app.patch('/api/admin/appearance', auth, admin, async (req, res) => {
  const hex = value => /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : null;
  const modes = ['light', 'dark', 'midnight', 'rose'];
  const decorations = ['none', 'celebration', 'christmas', 'valentine', 'halloween', 'newyear', 'independence'];
  const current = (await M.Setting.findOne({ key: 'appearance' }))?.value || {};
  const primary = hex(req.body.primary) || current.primary || '#2878f0';
  const secondary = hex(req.body.secondary) || current.secondary || '#4c9bff';
  const background = hex(req.body.background) || current.background || '#f5f8fc';
  const surface = hex(req.body.surface) || current.surface || '#ffffff';
  const text = hex(req.body.text) || current.text || '#15233b';
  const mode = modes.includes(req.body.mode) ? req.body.mode : (current.mode || 'light');
  const decoration = decorations.includes(req.body.decoration) ? req.body.decoration : (current.decoration || 'none');
  const eventLabel = String(req.body.eventLabel || '').trim().slice(0, 60);
  const next = { primary, secondary, background, surface, text, mode, decoration, eventLabel };
  await M.Setting.updateOne({ key: 'appearance' }, { $set: { value: next } }, { upsert: true });
  await audit(req.user._id, 'appearance_updated', 'setting', 'appearance', JSON.stringify(next));
  io.emit('appearance:updated', next);
  res.json({ appearance: next });
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
io.on('connection', async socket => {
  socket.join(`user:${socket.userId}`);
  const userSockets = onlineUsers.get(socket.userId) || new Set();
  const wasOffline = userSockets.size === 0;
  userSockets.add(socket.id);
  onlineUsers.set(socket.userId, userSockets);
  if (wasOffline) io.emit('presence:update', { userId: socket.userId, online: true });
  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(socket.userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (!sockets.size) {
        onlineUsers.delete(socket.userId);
        io.emit('presence:update', { userId: socket.userId, online: false });
      }
    }
  });
  const memberGroups = await M.Group.find({ members: socket.userId });
  memberGroups.forEach(group => socket.join(`group:${group._id}`));
  socket.on('group:typing', async ({ groupId, active }) => {
    const group = await M.Group.findById(String(groupId || ''));
    if (isGroupMember(group, socket.userId)) socket.to(`group:${group._id}`).emit('group:typing', { groupId: group._id, userId: socket.userId, active: !!active });
  });
  socket.on('typing', ({ recipientId, active }) => {
    if (recipientId) io.to(`user:${recipientId}`).emit('typing', { userId: socket.userId, active: !!active });
  });
  const relayCallSignal = async (event, payload = {}) => {
    const recipientId = String(payload.recipientId || '');
    if (!recipientId || recipientId === socket.userId || recipientId.length > 80) return;
    const recipient = await M.User.findById(recipientId);
    const caller = await M.User.findById(socket.userId);
    if (!recipient || !caller || recipient.isSuspended || caller.isSuspended) return;
    if (caller.blockedUsers.some(id => String(id) === recipientId) || recipient.blockedUsers.some(id => String(id) === socket.userId)) return;
    const safePayload = { ...payload, recipientId: undefined, from: socket.userId };
    io.to(`user:${recipientId}`).emit(event, safePayload);
  };
  ['call:invite','call:accept','call:reject','call:end','call:offer','call:answer','call:ice'].forEach(event => {
    socket.on(event, payload => {
      if (event === 'call:invite' && !['audio','video'].includes(payload?.callType)) return;
      relayCallSignal(event, payload).catch(err => console.error('Call signalling error:', err.message));
    });
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err instanceof multer.MulterError || err.message?.startsWith('Choose an image') || err.message?.startsWith('Upload an image') ? 400 : 500;
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. Check the upload limit and try a smaller file.' : (err.message || 'Server error.');
  res.status(status).json({ error: message });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

(async () => {
  try { if (typeof M.init === 'function') await M.init(); await seed(); server.listen(PORT, () => console.log(`CHATHIS running on ${PORT} using ${String(process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'cockroach' : 'sqlite')).toLowerCase() === 'cockroach' ? 'CockroachDB' : `SQLite at ${process.env.DATABASE_PATH || 'data/chathsi.db'}`}`)); }
  catch (err) { console.error('CHATHSI startup failed:', err); process.exit(1); }
})();
