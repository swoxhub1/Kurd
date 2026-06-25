const express = require('express');
const serverless = require('serverless-http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || "KurmanciKirmanckiTrEnSecret2026";
const MONGO_URI = process.env.MONGO_URI || "MDB_BAGLANTI_ADRESINIZI_BURAYA_YAZIN";

// --- 4 DİLLİ LOCALIZATION SİSTEMİ ---
const languages = {
  ku: {
    welcome: "Bi xêr hatî bo Foruma Nasyonalistên Kurd",
    founderTitle: "👑 Sazkar (Kurucu)",
    verifiedBadge: "✓ Mavi Tik",
    bannedMessage: "Hûn hatine qedexe kirin! Sedem: ",
    verifyRequired: "Ji bo parvekirinê, pêşî divê hûn E-peyam û SMS'a xwe piştrast bikin!",
    onlyFounder: "Ev kiryar tenê ji bo Sazkar e!",
    successPost: "Forum bi serkeftî hate parve kirin.",
    successBan: "Kullanıcı ji forumê hate dûrxistin."
  },
  zza: {
    welcome: "Xêr amay Forûmê Neteweperweranê Kurdan",
    founderTitle: "👑 Awanker (Kurucu)",
    verifiedBadge: "✓ Mavi Tik",
    bannedMessage: "Şoma amey qedexe kerdene! Sereb: ",
    verifyRequired: "Seba parvekerdene, verê nê guney şoma E-post u SMS'ê xo rast bikerê!",
    onlyFounder: "Ena karkerdene tena seba Awankerî ya!",
    successPost: "Forûm bi serkewtiş parve bi.",
    successBan: "Seba qedexekerdena ney tewr serkewte bi."
  },
  tr: {
    welcome: "Kürt Milliyetçileri Forumuna Hoş Geldiniz",
    founderTitle: "👑 Kurucu",
    verifiedBadge: "✓ Onaylı Rozet (Mavi Tik)",
    bannedMessage: "Yasaklandınız! Sebep: ",
    verifyRequired: "Paylaşım yapabilmek için önce E-posta ve SMS doğrulamalarını tamamlamalısınız!",
    onlyFounder: "Bu işlem sadece Kurucu yetkisindedir!",
    successPost: "Forum başarıyla paylaşıldı.",
    successBan: "Kullanıcı başarıyla forumdan uzaklaştırıldı."
  },
  en: {
    welcome: "Welcome to Kurdish Nationalist Forum",
    founderTitle: "👑 Founder",
    verifiedBadge: "✓ Verified Badge",
    bannedMessage: "You are banned! Reason: ",
    verifyRequired: "To post, you must first verify your Email and SMS authentication!",
    onlyFounder: "This action is strictly restricted to the Founder!",
    successPost: "Forum post successfully published.",
    successBan: "User has been successfully banned."
  }
};

// Dil Seçim Yakalayıcı (Headers veya Query parametresinden)
app.use((req, res, next) => {
  const userLang = req.headers['accept-language'] || req.query.lang || 'ku';
  req.lang = languages[userLang] ? userLang : 'ku';
  req.text = languages[req.lang];
  next();
});

// --- ŞEMALAR ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  isVerifiedBadge: { type: Boolean, default: false },
  role: { type: String, enum: ['Kurucu', 'Admin', 'Moderatör', 'Yazar', 'Standart'], default: 'Standart' },
  customTitle: { type: String, default: 'Nûner' },
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: '' },
  preferredLang: { type: String, default: 'ku' }
});

const ForumSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: { type: String, required: true },
  lang: { type: String, default: 'ku' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Forum = mongoose.models.Forum || mongoose.model('Forum', ForumSchema);

let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(MONGO_URI);
  isConnected = true;
}

// --- GÜVENLİK DUVARLARI ---
async function authMiddleware(req, res, next) {
  try {
    await connectDB();
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ hata: "No token provided" });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ hata: "User not found" });
    if (user.isBanned) return res.status(403).json({ hata: `${req.text.bannedMessage} ${user.banReason}` });
    
    req.user = user;
    req.text = languages[user.preferredLang || req.lang];
    next();
  } catch (err) {
    res.status(401).json({ hata: "Oturum geçersiz." });
  }
}

const checkKurucu = (req, res, next) => req.user.role === 'Kurucu' ? next() : res.status(403).json({ hata: req.text.onlyFounder });
const checkVerification = (req, res, next) => (req.user.isEmailVerified && req.user.isPhoneVerified) ? next() : res.status(403).json({ hata: req.text.verifyRequired });

// --- KULLANICI LOGICLERI ---
app.post('/api/auth/register', async (req, res) => {
  try {
    await connectDB();
    const { username, email, phone, password, preferredLang, secretCode } = req.body;
    let role = secretCode === "GIZLI_KURUCU_2026" ? 'Kurucu' : 'Standart';
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      username, email, phone, password: hashedPassword, role, preferredLang: preferredLang || 'ku',
      customTitle: role === 'Kurucu' ? languages[preferredLang || 'ku'].founderTitle : 'Nûner'
    });
    res.status(201).json({ mesaj: "Kayıt başarılı", userId: newUser._id });
  } catch (err) {
    res.status(400).json({ hata: "Kayıt başarısız, bilgiler benzersiz olmalıdır." });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  await connectDB();
  const { userId, code } = req.body; // Simüle kod: 2026
  if (code === "2026") {
    await User.findByIdAndUpdate(userId, { isEmailVerified: true, isPhoneVerified: true });
    return res.json({ mesaj: "Onay Başarılı!" });
  }
  res.status(400).json({ hata: "Kod geçersiz." });
});

app.post('/api/auth/login', async (req, res) => {
  await connectDB();
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ hata: "Hatalı şifre/kullanıcı adı" });
  if (user.isBanned) return res.status(403).json({ hata: "Girişiniz yasaklanmıştır." });
  
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, role: user.role, username: user.username });
});

// --- FORUM & ARAMA MOTORU ---
app.post('/api/forums', authMiddleware, checkVerification, async (req, res) => {
  const { title, content, category } = req.body;
  const newForum = await Forum.create({ title, content, category, lang: req.user.preferredLang, author: req.user._id });
  res.status(201).json({ mesaj: req.text.successPost, forum: newForum });
});

app.get('/api/search', async (req, res) => {
  await connectDB();
  const { q, type, filterLang } = req.query;
  if (type === 'user') {
    const users = await User.find({ $or: [{ username: { $regex: q, $options: 'i' } }, { customTitle: { $regex: q, $options: 'i' } }] }).select('-password -phone -email');
    return res.json(users);
  } else {
    let query = { $or: [{ title: { $regex: q, $options: 'i' } }, { content: { $regex: q, $options: 'i' } }] };
    if (filterLang) query.lang = filterLang;
    const forums = await Forum.find(query).populate('author', 'username role customTitle isVerifiedBadge');
    return res.json(forums);
  }
});

// --- KURUCU OPERASYONLARI ---
app.post('/api/admin/ban', authMiddleware, checkKurucu, async (req, res) => {
  const { targetUserId, reason } = req.body;
  const target = await User.findById(targetUserId);
  if (target.role === 'Kurucu') return res.status(403).json({ hata: "Kurucu engellenemez!" });
  target.isBanned = true; target.banReason = reason; await target.save();
  res.json({ mesaj: req.text.successBan });
});

app.post('/api/admin/title', authMiddleware, checkKurucu, async (req, res) => {
  const { targetUserId, role, customTitle } = req.body;
  const target = await User.findById(targetUserId);
  if (target.role === 'Kurucu') return res.status(403).json({ hata: "Değiştirilemez hesap." });
  await User.findByIdAndUpdate(targetUserId, { role, customTitle });
  res.json({ mesaj: "Rol/Unvan güncellendi." });
});

app.post('/api/admin/badge', authMiddleware, checkKurucu, async (req, res) => {
  const { targetUserId } = req.body;
  const target = await User.findById(targetUserId);
  target.isVerifiedBadge = !target.isVerifiedBadge; await target.save();
  res.json({ mesaj: "Mavi tik durumu güncellendi." });
});

app.delete('/api/admin/forum/:id', authMiddleware, checkKurucu, async (req, res) => {
  await Forum.findByIdAndDelete(req.params.id);
  res.json({ mesaj: "Silindi." });
});

module.exports.handler = serverless(app);
