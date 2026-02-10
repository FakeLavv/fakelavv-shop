const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Пути к файлам базы данных
const DB_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const BANNED_FILE = path.join(DB_DIR, 'banned.json');
const MUTED_FILE = path.join(DB_DIR, 'muted.json');
const REVIEWS_FILE = path.join(DB_DIR, 'reviews.json');

// Создаём папку data если нет
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Загрузка данных из файлов
function loadData() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            for (const [username, user] of Object.entries(data)) {
                users.set(username, user);
            }
            console.log(`📁 Загружено ${users.size} пользователей из базы`);
        }
        if (fs.existsSync(BANNED_FILE)) {
            const data = JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8'));
            data.forEach(u => bannedUsers.add(u));
        }
        if (fs.existsSync(MUTED_FILE)) {
            const data = JSON.parse(fs.readFileSync(MUTED_FILE, 'utf8'));
            data.forEach(u => mutedUsers.add(u));
        }
        if (fs.existsSync(REVIEWS_FILE)) {
            const data = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
            data.forEach(r => reviews.push(r));
            console.log(`📁 Загружено ${reviews.length} отзывов`);
        }
    } catch (e) {
        console.error('Ошибка загрузки данных:', e);
    }
}

// Сохранение данных в файлы
function saveUsers() {
    try {
        const data = Object.fromEntries(users);
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Ошибка сохранения users:', e);
    }
}

function saveBanned() {
    try {
        fs.writeFileSync(BANNED_FILE, JSON.stringify([...bannedUsers], null, 2));
    } catch (e) {
        console.error('Ошибка сохранения banned:', e);
    }
}

function saveMuted() {
    try {
        fs.writeFileSync(MUTED_FILE, JSON.stringify([...mutedUsers], null, 2));
    } catch (e) {
        console.error('Ошибка сохранения muted:', e);
    }
}

function saveReviews() {
    try {
        fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
    } catch (e) {
        console.error('Ошибка сохранения reviews:', e);
    }
}

// Хранилище в памяти
const users = new Map();
const sessions = new Map();
const messages = [];
const onlineUsers = new Map();
const bannedUsers = new Set();
const mutedUsers = new Set();
const reviews = [];

// Загружаем данные при старте
loadData();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/music', express.static(path.join(__dirname, 'music')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
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
    
    if (users.has(username)) {
        return res.status(400).json({ error: 'Имя пользователя занято' });
    }
    
    for (const user of users.values()) {
        if (user.email === email) {
            return res.status(400).json({ error: 'Email уже используется' });
        }
    }
    
    if (bannedUsers.has(username)) {
        return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const isFirstUser = users.size === 0;
    
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
    
    users.set(username, newUser);
    saveUsers();
    
    req.session.username = username;
    
    console.log(`✅ Новый пользователь: ${username} (IP: ${ip}) ${isFirstUser ? '[OWNER]' : ''}`);
    
    res.json({ 
        success: true, 
        username,
        badges: newUser.badges,
        isOwner: isFirstUser,
        message: 'Регистрация успешна!'
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (bannedUsers.has(username)) {
        return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }
    
    const user = users.get(username);
    if (!user) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    user.lastLogin = Date.now();
    if (!user.ips.includes(ip)) {
        user.ips.push(ip);
    }
    
    saveUsers();
    
    req.session.username = username;
    
    console.log(`🔑 Вход: ${username} (IP: ${ip})`);
    
    res.json({
        success: true,
        username,
        badges: user.badges,
        isOwner: user.badges.includes('owner')
    });
});

app.get('/api/me', (req, res) => {
    if (req.session.username && users.has(req.session.username)) {
        const user = users.get(req.session.username);
        res.json({
            loggedIn: true,
            username: req.session.username,
            badges: user.badges,
            email: user.email,
            isOwner: user.badges.includes('owner')
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// Reviews API
app.get('/api/reviews', (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const userReview = reviews.find(r => r.username === req.session.username);
    const otherReviews = reviews.filter(r => r.username !== req.session.username).reverse();
    
    res.json({
        reviews: otherReviews,
        userReview: userReview || null
    });
});

app.post('/api/reviews', (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const { rating, text } = req.body;
    const username = req.session.username;
    
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
    }
    
    const existingIndex = reviews.findIndex(r => r.username === username);
    if (existingIndex !== -1) {
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
    
    reviews.push(review);
    saveReviews();
    
    console.log(`⭐ Новый отзыв от ${username}: ${rating} звёзд`);
    
    res.json({ success: true, review });
});

app.put('/api/reviews/:id', (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const { rating, text } = req.body;
    const reviewId = req.params.id;
    const username = req.session.username;
    const user = users.get(username);
    const isOwner = user && user.badges.includes('owner');
    
    const reviewIndex = reviews.findIndex(r => r.id === reviewId);
    if (reviewIndex === -1) {
        return res.status(404).json({ error: 'Отзыв не найден' });
    }
    
    const review = reviews[reviewIndex];
    
    // Только владелец отзыва или админ может редактировать
    if (review.username !== username && !isOwner) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    if (rating && (rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
    }
    
    review.rating = rating !== undefined ? parseInt(rating) : review.rating;
    review.text = text !== undefined ? text : review.text;
    review.isAdminEdit = isOwner && review.username !== username;
    review.date = Date.now();
    
    reviews[reviewIndex] = review;
    saveReviews();
    
    console.log(`✏️ Отзыв ${reviewId} отредактирован ${isOwner ? 'админом' : 'пользователем'}`);
    
    res.json({ success: true, review });
});

app.delete('/api/reviews/:id', (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    const reviewId = req.params.id;
    const username = req.session.username;
    const user = users.get(username);
    const isOwner = user && user.badges.includes('owner');
    
    const reviewIndex = reviews.findIndex(r => r.id === reviewId);
    if (reviewIndex === -1) {
        return res.status(404).json({ error: 'Отзыв не найден' });
    }
    
    const review = reviews[reviewIndex];
    
    // Владелец отзыва или админ может удалить
    if (review.username !== username && !isOwner) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    reviews.splice(reviewIndex, 1);
    saveReviews();
    
    console.log(`🗑️ Отзыв ${reviewId} удалён ${isOwner ? 'админом' : 'пользователем'}`);
    
    res.json({ success: true });
});

app.get('/api/admin/users', (req, res) => {
    const admin = req.session.username ? users.get(req.session.username) : null;
    if (!admin || !admin.badges.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const usersList = Array.from(users.entries()).map(([username, user]) => ({
        username,
        email: user.email,
        badges: user.badges,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        ips: user.ips || [],
        banned: bannedUsers.has(username),
        muted: mutedUsers.has(username),
        messagesCount: user.messagesCount || 0,
        online: Array.from(onlineUsers.values()).some(u => u.username === username)
    }));
    
    res.json({ users: usersList });
});

app.post('/api/admin/action', (req, res) => {
    const admin = req.session.username ? users.get(req.session.username) : null;
    if (!admin || !admin.badges.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const { action, targetUsername } = req.body;
    const target = users.get(targetUsername);
    
    if (!target) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (target.badges.includes('owner')) {
        return res.status(403).json({ error: 'Нельзя трогать Owner' });
    }
    
    switch(action) {
        case 'delete':
            users.delete(targetUsername);
            bannedUsers.add(targetUsername);
            saveUsers();
            saveBanned();
            for (const [sid, uname] of sessions) {
                if (uname === targetUsername) {
                    io.to(sid).emit('accountDeleted');
                }
            }
            console.log(`🗑️ Админ удалил аккаунт: ${targetUsername}`);
            break;
            
        case 'ban':
            bannedUsers.add(targetUsername);
            target.banned = true;
            saveBanned();
            saveUsers();
            for (const [sid, uname] of sessions) {
                if (uname === targetUsername) {
                    io.to(sid).emit('banned');
                }
            }
            console.log(`🚫 Админ забанил: ${targetUsername}`);
            break;
            
        case 'unban':
            bannedUsers.delete(targetUsername);
            target.banned = false;
            saveBanned();
            saveUsers();
            console.log(`✅ Админ разбанил: ${targetUsername}`);
            break;
            
        case 'mute':
            mutedUsers.add(targetUsername);
            target.muted = true;
            saveMuted();
            saveUsers();
            console.log(`🔇 Админ замутил: ${targetUsername}`);
            break;
            
        case 'unmute':
            mutedUsers.delete(targetUsername);
            target.muted = false;
            saveMuted();
            saveUsers();
            console.log(`🔊 Админ размутил: ${targetUsername}`);
            break;
    }
    
    res.json({ success: true, message: 'Действие выполнено' });
});

app.post('/api/admin/badge', (req, res) => {
    const admin = req.session.username ? users.get(req.session.username) : null;
    if (!admin || !admin.badges.includes('owner')) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    const { action, targetUsername, badge } = req.body;
    const target = users.get(targetUsername);
    
    if (!target) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (action === 'give') {
        if (!target.badges.includes(badge)) {
            target.badges.push(badge);
            saveUsers();
            updateUserBadges(targetUsername, target.badges);
        }
    } else if (action === 'remove') {
        if (badge === 'owner') {
            return res.status(403).json({ error: 'Нельзя забрать Owner' });
        }
        target.badges = target.badges.filter(b => b !== badge);
        saveUsers();
        updateUserBadges(targetUsername, target.badges);
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
    
    socket.on('joinChat', (data) => {
        const { username } = data;
        
        if (!username || !users.has(username)) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        if (bannedUsers.has(username)) {
            socket.emit('banned');
            return;
        }
        
        const user = users.get(username);
        
        sessions.set(socket.id, username);
        onlineUsers.set(socket.id, {
            username,
            badges: user.badges,
            ip: ip,
            socketId: socket.id
        });
        
        socket.emit('chatHistory', messages.slice(-50));
        
        io.emit('userJoined', {
            username,
            badges: user.badges,
            onlineCount: onlineUsers.size
        });
        
        broadcastOnlineList();
    });
    
    socket.on('sendMessage', (data) => {
        const username = sessions.get(socket.id);
        
        if (!username) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        if (mutedUsers.has(username)) {
            socket.emit('error', { message: 'Вы замучены' });
            return;
        }
        
        const { text } = data;
        if (!text || text.trim().length === 0) return;
        if (text.length > 500) {
            socket.emit('error', { message: 'Сообщение слишком длинное' });
            return;
        }
        
        const user = users.get(username);
        user.messagesCount = (user.messagesCount || 0) + 1;
        saveUsers();
        
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
    
    socket.on('adminCommand', (data) => {
        const username = sessions.get(socket.id);
        if (!username) return;
        
        const user = users.get(username);
        if (!user.badges.includes('owner')) {
            socket.emit('error', { message: 'Нет прав' });
            return;
        }
        
        const { command, targetUsername, badge } = data;
        const target = users.get(targetUsername);
        
        if (!target) {
            socket.emit('error', { message: 'Пользователь не найден' });
            return;
        }
        
        if (command === 'giveBadge') {
            if (!target.badges.includes(badge)) {
                target.badges.push(badge);
                saveUsers();
                updateUserBadges(targetUsername, target.badges);
                socket.emit('success', `Бейджик ${badge} выдан ${targetUsername}`);
            }
        } else if (command === 'removeBadge') {
            target.badges = target.badges.filter(b => b !== badge);
            saveUsers();
            updateUserBadges(targetUsername, target.badges);
            socket.emit('success', `Бейджик ${badge} удалён у ${targetUsername}`);
        }
    });
    
    function updateUserBadges(targetUsername, newBadges) {
        for (const [sid, uname] of sessions) {
            if (uname === targetUsername) {
                const onlineUser = onlineUsers.get(sid);
                if (onlineUser) {
                    onlineUser.badges = newBadges;
                }
                io.to(sid).emit('badgeUpdate', newBadges);
            }
        }
        broadcastOnlineList();
    }
    
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
        io.emit('onlineCount', onlineUsers.size);
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 База данных: ${DB_DIR}`);
});
