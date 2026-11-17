const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 24, match: /^[a-zA-Z0-9_]+$/ },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  displayName: { type: String, default: '', maxlength: 50 },
  bio: { type: String, default: '', maxlength: 180 },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  premium: { type: String, enum: ['free', 'plus', 'pro'], default: 'free' },
  premiumUntil: { type: Date, default: null },
  walletBalance: { type: Number, default: 0, min: 0 },
  followers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  isSuspended: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

const postSchema = new Schema({
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '', maxlength: 3000 },
  mediaUrl: { type: String, default: '' },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now }
  }],
  isRemoved: { type: Boolean, default: false }
}, { timestamps: true });

const messageSchema = new Schema({
  conversationKey: { type: String, required: true, index: true },
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 4000 },
  readAt: { type: Date, default: null }
}, { timestamps: true });

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, required: true },
  text: { type: String, required: true, maxlength: 180 },
  link: { type: String, default: '' },
  readAt: { type: Date, default: null }
}, { timestamps: true });

const giftSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  description: { type: String, default: '', maxlength: 160 },
  emoji: { type: String, default: '🎁' },
  value: { type: Number, required: true, min: 1 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const giftItemSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gift: { type: Schema.Types.ObjectId, ref: 'Gift', required: true },
  originalValue: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['available', 'pending', 'transferred'], default: 'available' },
  acquiredFrom: { type: String, enum: ['purchase', 'admin'], default: 'purchase' }
}, { timestamps: true });

const topupSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 100 },
  method: { type: String, enum: ['bank_transfer', 'card'], required: true },
  reference: { type: String, required: true, unique: true },
  proofUrl: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date }
}, { timestamps: true });

const giftTransferSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  giftItem: { type: Schema.Types.ObjectId, ref: 'GiftItem', required: true },
  value: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date }
}, { timestamps: true });

const ledgerSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['topup', 'gift_purchase', 'gift_received', 'admin_adjustment'], required: true },
  amount: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  reference: { type: String, required: true, index: true },
  description: { type: String, required: true, maxlength: 180 },
  actor: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const reportSchema = new Schema({
  reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['user', 'post'], required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open' }
}, { timestamps: true });

const storySchema = new Schema({
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, maxlength: 500, default: '' },
  mediaUrl: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  viewers: [{ type: Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const settingSchema = new Schema({
  key: { type: String, unique: true, required: true },
  value: Schema.Types.Mixed
}, { timestamps: true });

const auditSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  targetType: { type: String, default: '' },
  targetId: { type: String, default: '' },
  details: { type: String, default: '' }
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  Post: mongoose.model('Post', postSchema),
  Message: mongoose.model('Message', messageSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  Gift: mongoose.model('Gift', giftSchema),
  GiftItem: mongoose.model('GiftItem', giftItemSchema),
  Topup: mongoose.model('Topup', topupSchema),
  GiftTransfer: mongoose.model('GiftTransfer', giftTransferSchema),
  Ledger: mongoose.model('Ledger', ledgerSchema),
  Report: mongoose.model('Report', reportSchema),
  Story: mongoose.model('Story', storySchema),
  Setting: mongoose.model('Setting', settingSchema),
  Audit: mongoose.model('Audit', auditSchema)
};
