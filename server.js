const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fakelavv-shop';

// MongoDB клиент
let db;
let client;

// In-memory для сессий и чата (не сохраняем в БД)
const sessions = new Map();
const messages = [];
const onlineUsers = new Map();

async function connectDB() {
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db('fakelavv-shop');
        console.log('✅ Подключено к MongoDB Atlas');
        
        // Создаём индексы
        await db.collection('users').createIndex({ username: 1 }, { unique: true });
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('reviews').createIndex({ username: 1 }, { unique: true });
        
    } catch (e) {
        console.error('❌ Ошибка подключения к MongoDB:', e);
        process.exit(1);
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/music', express.static(path.join(__dirname, 'music')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/examples', express.static(path.join(__dirname, 'examples')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

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
    
    const usersCount = await db.collection('users').countDocuments();
    const isFirstUser = usersCount === 0;
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
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
        await db.collection('users').insertOne(newUser);
        await db.collection('carts').insertOne({ username, items: [] });
        
        req.session.username = username;
        
        console.log(`✅ Новый пользователь: ${username} (IP: ${ip})`);
        
        res.json({ 
            success: true, 
            username,
            badges: newUser.badges,
            isOwner: isFirstUser,
            message: 'Регистрация успешна!'
        });
    } catch (e) {
        if (e.code === 11000) {
            return res.status(400).json({ error: 'Имя пользователя или email уже заняты' });
        }
        throw e;
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    const user = await db.collection('users').findOne({ username });
    
    if (!user || user.banned) {
        return res.status(400).json({ error: 'Неверные данные или аккаунт заблокирован' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    // Обновляем lastLogin и IP
    await db.collection('users').updateOne(
        { username },
        { 
            $set: { lastLogin: Date.now() },
            $addToSet: { ips: ip }
        }
    );
    
    req.session.username = username;
    
    console.log(`🔑 Вход: ${username} (IP: ${ip})`);
    
    res.json({
        success: true,
        username,
        badges: user.badges,
        isOwner: user.badges.includes('owner')
    });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.username) {
        return res.json({ loggedIn: false });
    }
    
    const user = await db.collection('users').findOne({ username: req.session.username });
    if (!user) {
        return res.json({ loggedIn: false });
    }
    
    res.json({
        loggedIn: true,
        username: req.session.username,
        badges: user.badges,
        email: user.email,
        isOwner: user.badges.includes('owner')
    });
});

// CART API
app.get('/api/cart', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const cart = await db.collection('carts').findOne({ username: req.session.username });
    res.json({ cart: cart?.items || [] });
});

app.post('/api/cart', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const { cart } = req.body;
    await db.collection('carts').updateOne(
        { username: req.session.username },
        { $set: { items: cart || [] } },
        { upsert: true }
    );
    
    res.json({ success: true });
});

// Reviews API
app.get('/api/reviews', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const userReview = await db.collection('reviews').findOne({ username: req.session.username });
    const otherReviews = await db.collection('reviews')
        .find({ username: { $ne: req.session.username } })
        .sort({ date: -1 })
        .toArray();
    
    res.json({ 
        reviews: otherReviews, 
        userReview: userReview || null 
    });
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
    
    const existing = await db.collection('reviews').findOne({ username });
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
    
    await db.collection('reviews').insertOne(review);
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
    
    const user = await db.collection('users').findOne({ username });
    const isOwner = user?.badges?.includes('owner');
    
    const review = await db.collection('reviews').findOne({ id: reviewId });
    if (!review) {
        return res.status(404).json({ error: 'Отзыв не найден' });
    }
    
    if (review.username !== username && !isOwner) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const update = {
        $set: {
            date: Date.now(),
            isAdminEdit: isOwner && review.username !== username
        }
    };
    
    if (rating !== undefined) update.$set.rating = parseInt(rating);
    if (text !== undefined) update.$set.text = text;
    
    await db.collection('reviews').updateOne({ id: reviewId }, update);
    
    console.log(`✏️ Отзыв отредактирован`);
    res.json({ success: true });
});

app.delete('/api/reviews/:id', async (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const reviewId = req.params.id;
    const username = req.session.username;
    
    const user = await db.collection('users').findOne({ username });
    const isOwner = user?.badges?.includes('owner');
    
    const review = await db.collection('reviews').findOne({ id: reviewId });
    if (!review) {
        return res.status(404).json({ error: 'Отзыв не найден' });
    }
    
    if (review.username !== username && !isOwner) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    await db.collection('reviews').deleteOne({ id: reviewId });
    console.log(`🗑️ Отзыв удалён`);
    
    res.json({ success: true });
});

app.get('/api/admin/users', async (req, res) => {
    const admin = req.session.username ? 
        await db.collection('users').findOne({ username: req.session.username }) : null;
    
    if (!admin?.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const usersList = await db.collection('users').find().toArray();
    const bannedList = await db.collection('banned').find().toArray();
    const mutedList = await db.collection('muted').find().toArray();
    
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
    const admin = req.session.username ? 
        await db.collection('users').findOne({ username: req.session.username }) : null;
    
    if (!admin?.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const { action, targetUsername } = req.body;
    const target = await db.collection('users').findOne({ username: targetUsername });
    
    if (!target) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (target.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нельзя трогать Owner' });
    }
    
    switch(action) {
        case 'delete':
            await db.collection('users').deleteOne({ username: targetUsername });
            await db.collection('banned').insertOne({ username: targetUsername, date: Date.now() });
            await db.collection('carts').deleteOne({ username: targetUsername });
            for (const [sid, uname] of sessions) {
                if (uname === targetUsername) {
                    io.to(sid).emit('accountDeleted');
                }
            }
            console.log(`🗑️ Админ удалил аккаунт: ${targetUsername}`);
            break;
            
        case 'ban':
            await db.collection('banned').insertOne({ username: targetUsername, date: Date.now() });
            await db.collection('users').updateOne({ username: targetUsername }, { $set: { banned: true } });
            for (const [sid, uname] of sessions) {
                if (uname === targetUsername) {
                    io.to(sid).emit('banned');
                }
            }
            console.log(`🚫 Админ забанил: ${targetUsername}`);
            break;
            
        case 'unban':
            await db.collection('banned').deleteOne({ username: targetUsername });
            await db.collection('users').updateOne({ username: targetUsername }, { $set: { banned: false } });
            console.log(`✅ Админ разбанил: ${targetUsername}`);
            break;
            
        case 'mute':
            await db.collection('muted').insertOne({ username: targetUsername, date: Date.now() });
            await db.collection('users').updateOne({ username: targetUsername }, { $set: { muted: true } });
            console.log(`🔇 Админ замутил: ${targetUsername}`);
            break;
            
        case 'unmute':
            await db.collection('muted').deleteOne({ username: targetUsername });
            await db.collection('users').updateOne({ username: targetUsername }, { $set: { muted: false } });
            console.log(`🔊 Админ размутил: ${targetUsername}`);
            break;
    }
    
    res.json({ success: true, message: 'Действие выполнено' });
});

app.post('/api/admin/badge', async (req, res) => {
    const admin = req.session.username ? 
        await db.collection('users').findOne({ username: req.session.username }) : null;
    
    if (!admin?.badges?.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const { action, targetUsername, badge } = req.body;
    
    if (action === 'give') {
        await db.collection('users').updateOne(
            { username: targetUsername },
            { $addToSet: { badges: badge } }
        );
    } else if (action === 'remove') {
        if (badge === 'owner') {
            return res.status(403).json({ error: 'Нельзя забрать Owner' });
        }
        await db.collection('users').updateOne(
            { username: targetUsername },
            { $pull: { badges: badge } }
        );
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
        
        const user = await db.collection('users').findOne({ username });
        if (!user) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        if (user.banned) {
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
        broadcastOnlineList();
    });
    
    socket.on('sendMessage', async (data) => {
        const username = sessions.get(socket.id);
        
        if (!username) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        const user = await db.collection('users').findOne({ username });
        if (user?.muted) {
            socket.emit('error', { message: 'Вы замучены' });
            return;
        }
        
        const { text } = data;
        if (!text || text.trim().length === 0) return;
        if (text.length > 500) {
            socket.emit('error', { message: 'Сообщение слишком длинное' });
            return;
        }
        
        await db.collection('users').updateOne(
            { username },
            { $inc: { messagesCount: 1 } }
        );
        
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
    
    function broadcastOnlineList() {
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges,
            ip: u.ip
        }));
        io.emit('onlineList', onlineList);
    }
    
    socket.on('disconnect', () => {
        sessions.delete(socket.id);
        onlineUsers.delete(socket.id);
        broadcastOnlineList();
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запускаем сервер после подключения к БД
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🗄️  MongoDB: ${MONGODB_URI.replace(/:.*@/, ':****@')}`);
    });
});
