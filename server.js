const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// MongoDB URI - используй правильную строку из MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fakelavv-shop';

// MongoDB клиент
let db;
let client;

// In-memory для сессий и чата
const sessions = new Map();
const messages = [];
const onlineUsers = new Map();

async function connectDB() {
    try {
        client = new MongoClient(MONGODB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        db = client.db('fakelavv-shop');
        
        console.log('✅ Подключено к MongoDB Atlas');
        
        // Создаём коллекции если нет
        const collections = await db.listCollections().toArray();
        const collNames = collections.map(c => c.name);
        
        if (!collNames.includes('users')) {
            await db.createCollection('users');
            await db.collection('users').createIndex({ username: 1 }, { unique: true });
            await db.collection('users').createIndex({ email: 1 }, { unique: true });
        }
        if (!collNames.includes('carts')) await db.createCollection('carts');
        if (!collNames.includes('reviews')) {
            await db.createCollection('reviews');
            await db.collection('reviews').createIndex({ username: 1 }, { unique: true });
        }
        if (!collNames.includes('banned')) await db.createCollection('banned');
        if (!collNames.includes('muted')) await db.createCollection('muted');
        
    } catch (e) {
        console.error('❌ Ошибка подключения к MongoDB:', e.message);
        console.log('⚠️ Работаем без базы данных (данные будут теряться при перезапуске)');
        // Fallback - работаем без БД
        db = null;
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/music', express.static(path.join(__dirname, 'music')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// In-memory fallback storage
const memoryUsers = new Map();
const memoryCarts = new Map();
const memoryReviews = [];
const memoryBanned = new Set();
const memoryMuted = new Set();

// Helper functions для работы с БД или памятью
async function getUser(username) {
    if (db) return await db.collection('users').findOne({ username });
    return memoryUsers.get(username);
}

async function saveUser(user) {
    if (db) {
        await db.collection('users').insertOne(user);
    } else {
        memoryUsers.set(user.username, user);
    }
}

async function updateUser(username, update) {
    if (db) {
        await db.collection('users').updateOne({ username }, { $set: update });
    } else {
        const user = memoryUsers.get(username);
        if (user) Object.assign(user, update);
    }
}

// ===== API =====

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Имя пользователя: 3-20 символов' });
    }
    
    if (!/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'Неверный email' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }
    
    // Проверяем существование
    const existingUser = await getUser(username);
    if (existingUser) {
        return res.status(400).json({ error: 'Имя пользователя занято' });
    }
    
    if (db) {
        const existingEmail = await db.collection('users').findOne({ email });
        if (existingEmail) return res.status(400).json({ error: 'Email уже используется' });
    }
    
    const banned = db ? 
        await db.collection('banned').findOne({ username }) : 
        memoryBanned.has(username);
    
    if (banned) {
        return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Считаем пользователей для определения первого (owner)
    const userCount = db ? 
        await db.collection('users').countDocuments() : 
        memoryUsers.size;
    const isFirstUser = userCount === 0;
    
    const newUser = {
        username,
        email,
        password: hashedPassword,
        badges: isFirstUser ? ['owner', 'dev'] : ['new'],
        createdAt: Date.now(),
        lastLogin: Date.now(),
        ips: [ip],
        banned: false,
        muted: false,
        messagesCount: 0
    };
    
    try {
        await saveUser(newUser);
        
        // Создаём корзину
        if (db) {
            await db.collection('carts').insertOne({ username, items: [] });
        } else {
            memoryCarts.set(username, []);
        }
        
        req.session.username = username;
        
        console.log(`✅ Новый пользователь: ${username} (IP: ${ip}) ${isFirstUser ? '[OWNER]' : ''}`);
        
        res.json({ 
            success: true, 
            username,
            badges: newUser.badges,
            isOwner: isFirstUser,
            message: 'Регистрация успешна!'
        });
    } catch (e) {
        console.error('Ошибка регистрации:', e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    const banned = db ? 
        await db.collection('banned').findOne({ username }) : 
        memoryBanned.has(username);
    
    if (banned) {
        return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }
    
    const user = await getUser(username);
    if (!user) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    // Обновляем lastLogin и IP
    const update = {
        lastLogin: Date.now(),
        $addToSet: { ips: ip }
    };
    
    if (db) {
        await db.collection('users').updateOne(
            { username },
            { 
                $set: { lastLogin: Date.now() },
                $addToSet: { ips: ip }
            }
        );
    } else {
        user.lastLogin = Date.now();
        if (!user.ips.includes(ip)) user.ips.push(ip);
    }
    
    req.session.username = username;
    
    console.log(`🔑 Вход: ${username} (IP: ${ip})`);
    
    res.json({
        success: true,
        username,
        badges: user.badges,
        isOwner: user.badges?.includes('owner')
    });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.username) {
        return res.json({ loggedIn: false });
    }
    
    const user = await getUser(req.session.username);
    if (!user) {
        return res.json({ loggedIn: false });
    }
    
    res.json({
        loggedIn: true,
        username: req.session.username,
        badges: user.badges,
        email: user.email,
        isOwner: user.badges?.includes('owner')
    });
});

// CART API
app.get('/api/cart', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    let cart;
    if (db) {
        const doc = await db.collection('carts').findOne({ username: req.session.username });
        cart = doc?.items || [];
    } else {
        cart = memoryCarts.get(req.session.username) || [];
    }
    
    res.json({ cart });
});

app.post('/api/cart', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const { cart } = req.body;
    
    if (db) {
        await db.collection('carts').updateOne(
            { username: req.session.username },
            { $set: { items: cart || [] } },
            { upsert: true }
        );
    } else {
        memoryCarts.set(req.session.username, cart || []);
    }
    
    res.json({ success: true });
});

// Reviews API
app.get('/api/reviews', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    let userReview, otherReviews;
    
    if (db) {
        userReview = await db.collection('reviews').findOne({ username: req.session.username });
        otherReviews = await db.collection('reviews')
            .find({ username: { $ne: req.session.username } })
            .sort({ date: -1 })
            .toArray();
    } else {
        userReview = memoryReviews.find(r => r.username === req.session.username);
        otherReviews = memoryReviews
            .filter(r => r.username !== req.session.username)
            .reverse();
    }
    
    res.json({ reviews: otherReviews, userReview: userReview || null });
});

app.post('/api/reviews', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const { rating, text } = req.body;
    const username = req.session.username;
    
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
    }
    
    // Проверяем существование отзыва
    let existing;
    if (db) {
        existing = await db.collection('reviews').findOne({ username });
    } else {
        existing = memoryReviews.find(r => r.username === username);
    }
    
    if (existing) {
        return res.status(400).json({ error: 'Вы уже оставили отзыв' });
    }
    
    const review = {
        id: uuidv4(),
        username,
        rating: parseInt(rating),
        text: text || '',
        date: Date.now(),
        isAdminEdit: false
    };
    
    if (db) {
        await db.collection('reviews').insertOne(review);
    } else {
        memoryReviews.push(review);
    }
    
    console.log(`⭐ Новый отзыв от ${username}: ${rating} звёзд`);
    res.json({ success: true, review });
});

app.put('/api/reviews/:id', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const { rating, text } = req.body;
    const reviewId = req.params.id;
    const username = req.session.username;
    
    const user = await getUser(username);
    const isOwner = user?.badges?.includes('owner');
    
    let review;
    if (db) {
        review = await db.collection('reviews').findOne({ id: reviewId });
    } else {
        review = memoryReviews.find(r => r.id === reviewId);
    }
    
    if (!review) {
        return res.status(404).json({ error: 'Отзыв не найден' });
    }
    
    if (review.username !== username && !isOwner) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const update = {
        date: Date.now(),
        isAdminEdit: isOwner && review.username !== username
    };
    if (rating !== undefined) update.rating = parseInt(rating);
    if (text !== undefined) update.text = text;
    
    if (db) {
        await db.collection('reviews').updateOne({ id: reviewId }, { $set: update });
    } else {
        Object.assign(review, update);
    }
    
    res.json({ success: true });
});

app.delete('/api/reviews/:id', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const reviewId = req.params.id;
    const username = req.session.username;
    
    const user = await getUser(username);
    const isOwner = user?.badges?.includes('owner');
    
    let review;
    if (db) {
        review = await db.collection('reviews').findOne({ id: reviewId });
    } else {
        review = memoryReviews.find(r => r.id === reviewId);
    }
    
    if (!review) {
        return res.status(404).json({ error: 'Отзыв не найден' });
    }
    
    if (review.username !== username && !isOwner) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    if (db) {
        await db.collection('reviews').deleteOne({ id: reviewId });
    } else {
        const idx = memoryReviews.findIndex(r => r.id === reviewId);
        if (idx > -1) memoryReviews.splice(idx, 1);
    }
    
    res.json({ success: true });
});

// Admin API
app.get('/api/admin/users', async (req, res) => {
    const admin = req.session.username ? await getUser(req.session.username) : null;
    if (!admin?.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    let usersList, bannedList, mutedList;
    
    if (db) {
        usersList = await db.collection('users').find().toArray();
        bannedList = await db.collection('banned').find().toArray();
        mutedList = await db.collection('muted').find().toArray();
    } else {
        usersList = Array.from(memoryUsers.values());
        bannedList = Array.from(memoryBanned).map(u => ({ username: u }));
        mutedList = Array.from(memoryMuted).map(u => ({ username: u }));
    }
    
    const bannedSet = new Set(bannedList.map(b => b.username));
    const mutedSet = new Set(mutedList.map(m => m.username));
    
    const result = usersList.map(u => ({
        username: u.username,
        email: u.email,
        badges: u.badges,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
        ips: u.ips || [],
        banned: bannedSet.has(u.username),
        muted: mutedSet.has(u.username),
        messagesCount: u.messagesCount || 0,
        online: Array.from(onlineUsers.values()).some(ou => ou.username === u.username)
    }));
    
    res.json({ users: result });
});

app.post('/api/admin/action', async (req, res) => {
    const admin = req.session.username ? await getUser(req.session.username) : null;
    if (!admin?.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const { action, targetUsername } = req.body;
    const target = await getUser(targetUsername);
    
    if (!target) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (target.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нельзя трогать Owner' });
    }
    
    switch(action) {
        case 'delete':
            if (db) {
                await db.collection('users').deleteOne({ username: targetUsername });
                await db.collection('banned').insertOne({ username: targetUsername, date: Date.now() });
                await db.collection('carts').deleteOne({ username: targetUsername });
            } else {
                memoryUsers.delete(targetUsername);
                memoryBanned.add(targetUsername);
                memoryCarts.delete(targetUsername);
            }
            for (const [sid, uname] of sessions) {
                if (uname === targetUsername) {
                    io.to(sid).emit('accountDeleted');
                }
            }
            console.log(`🗑️ Админ удалил аккаунт: ${targetUsername}`);
            break;
            
        case 'ban':
            if (db) {
                await db.collection('banned').insertOne({ username: targetUsername, date: Date.now() });
                await db.collection('users').updateOne({ username: targetUsername }, { $set: { banned: true } });
            } else {
                memoryBanned.add(targetUsername);
                target.banned = true;
            }
            for (const [sid, uname] of sessions) {
                if (uname === targetUsername) {
                    io.to(sid).emit('banned');
                }
            }
            console.log(`🚫 Админ забанил: ${targetUsername}`);
            break;
            
        case 'unban':
            if (db) {
                await db.collection('banned').deleteOne({ username: targetUsername });
                await db.collection('users').updateOne({ username: targetUsername }, { $set: { banned: false } });
            } else {
                memoryBanned.delete(targetUsername);
                target.banned = false;
            }
            console.log(`✅ Админ разбанил: ${targetUsername}`);
            break;
            
        case 'mute':
            if (db) {
                await db.collection('muted').insertOne({ username: targetUsername, date: Date.now() });
                await db.collection('users').updateOne({ username: targetUsername }, { $set: { muted: true } });
            } else {
                memoryMuted.add(targetUsername);
                target.muted = true;
            }
            console.log(`🔇 Админ замутил: ${targetUsername}`);
            break;
            
        case 'unmute':
            if (db) {
                await db.collection('muted').deleteOne({ username: targetUsername });
                await db.collection('users').updateOne({ username: targetUsername }, { $set: { muted: false } });
            } else {
                memoryMuted.delete(targetUsername);
                target.muted = false;
            }
            console.log(`🔊 Админ размутил: ${targetUsername}`);
            break;
    }
    
    res.json({ success: true, message: 'Действие выполнено' });
});

app.post('/api/admin/badge', async (req, res) => {
    const admin = req.session.username ? await getUser(req.session.username) : null;
    if (!admin?.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const { action, targetUsername, badge } = req.body;
    
    if (action === 'give') {
        if (db) {
            await db.collection('users').updateOne(
                { username: targetUsername },
                { $addToSet: { badges: badge } }
            );
        } else {
            const user = memoryUsers.get(targetUsername);
            if (user && !user.badges.includes(badge)) user.badges.push(badge);
        }
    } else if (action === 'remove') {
        if (badge === 'owner') {
            return res.status(403).json({ error: 'Нельзя забрать Owner' });
        }
        if (db) {
            await db.collection('users').updateOne(
                { username: targetUsername },
                { $pull: { badges: badge } }
            );
        } else {
            const user = memoryUsers.get(targetUsername);
            if (user) user.badges = user.badges.filter(b => b !== badge);
        }
    }
    
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ===== SOCKET.IO =====

io.on('connection', (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    socket.on('joinChat', async (data) => {
        const { username } = data;
        
        const user = await getUser(username);
        if (!user) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        if (user.banned || (db ? await db.collection('banned').findOne({ username }) : memoryBanned.has(username))) {
            socket.emit('banned');
            return;
        }
        
        sessions.set(socket.id, username);
        onlineUsers.set(socket.id, {
            username,
            badges: user.badges,
            ip: ip,
            socketId: socket.id
        });
        
        socket.emit('chatHistory', messages.slice(-50));
        
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges,
            ip: u.ip
        }));
        io.emit('onlineList', onlineList);
    });
    
    socket.on('sendMessage', async (data) => {
        const username = sessions.get(socket.id);
        
        if (!username) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        const user = await getUser(username);
        
        const muted = db ? 
            await db.collection('muted').findOne({ username }) : 
            memoryMuted.has(username);
        
        if (muted || user?.muted) {
            socket.emit('error', { message: 'Вы замучены' });
            return;
        }
        
        const { text } = data;
        if (!text || text.trim().length === 0) return;
        if (text.length > 500) {
            socket.emit('error', { message: 'Сообщение слишком длинное' });
            return;
        }
        
        // Увеличиваем счётчик сообщений
        if (db) {
            await db.collection('users').updateOne({ username }, { $inc: { messagesCount: 1 } });
        } else {
            user.messagesCount = (user.messagesCount || 0) + 1;
        }
        
        const message = {
            id: uuidv4(),
            username,
            text: text.trim(),
            time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
            badges: user.badges,
            timestamp: Date.now()
        };
        
        messages.push(message);
        if (messages.length > 100) messages.shift();
        
        io.emit('newMessage', message);
    });
    
    socket.on('disconnect', () => {
        sessions.delete(socket.id);
        onlineUsers.delete(socket.id);
        
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges,
            ip: u.ip
        }));
        io.emit('onlineList', onlineList);
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запускаем сервер
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        if (db) {
            console.log('✅ MongoDB подключена - данные сохраняются');
        } else {
            console.log('⚠️ MongoDB не подключена - данные в памяти (будут потеряны при перезапуске)');
        }
    });
});
