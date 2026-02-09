const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
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
    cookie: { secure: false }
}));

// Хранилище (в памяти)
const users = new Map();
const sessions = new Map();
const messages = [];
const onlineUsers = new Map();

// ===== API РЕГИСТРАЦИИ =====

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
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
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Первый пользователь = Owner
    const isFirstUser = users.size === 0;
    
    const newUser = {
        username,
        email,
        password: hashedPassword,
        badges: isFirstUser ? ['owner', 'dev'] : ['new'],
        createdAt: Date.now(),
        lastLogin: Date.now()
    };
    
    users.set(username, newUser);
    
    req.session.username = username;
    
    console.log(`✅ Новый пользователь: ${username} ${isFirstUser ? '(OWNER)' : ''}`);
    
    res.json({ 
        success: true, 
        username,
        badges: newUser.badges,
        isOwner: isFirstUser,
        message: 'Регистрация успешна!'
    });
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = users.get(username);
    if (!user) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    user.lastLogin = Date.now();
    req.session.username = username;
    
    console.log(`🔑 Вход: ${username}`);
    
    res.json({
        success: true,
        username,
        badges: user.badges,
        isOwner: user.badges.includes('owner')
    });
});

// Проверка сессии
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

// Выход
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ===== SOCKET.IO ЧАТ =====

io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    
    socket.on('joinChat', (data) => {
        const { username } = data;
        
        if (!username || !users.has(username)) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        const user = users.get(username);
        
        sessions.set(socket.id, username);
        onlineUsers.set(socket.id, {
            username,
            badges: user.badges
        });
        
        socket.emit('chatHistory', messages.slice(-50));
        
        io.emit('userJoined', {
            username,
            badges: user.badges,
            onlineCount: onlineUsers.size
        });
        
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges
        }));
        io.emit('onlineList', onlineList);
        
        console.log(`💬 ${username} вошёл в чат`);
    });
    
    socket.on('sendMessage', (data) => {
        const username = sessions.get(socket.id);
        
        if (!username) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        const { text } = data;
        if (!text || text.trim().length === 0) return;
        if (text.length > 500) {
            socket.emit('error', { message: 'Сообщение слишком длинное' });
            return;
        }
        
        const user = users.get(username);
        
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
    
    // Админ команды
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
                updateUserBadges(targetUsername, target.badges);
                socket.emit('success', `Бейджик ${badge} выдан ${targetUsername}`);
            }
        } else if (command === 'removeBadge') {
            target.badges = target.badges.filter(b => b !== badge);
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
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges
        }));
        io.emit('onlineList', onlineList);
    }
    
    socket.on('disconnect', () => {
        const username = sessions.get(socket.id);
        if (username) {
            console.log(`👋 ${username} вышел`);
        }
        
        sessions.delete(socket.id);
        onlineUsers.delete(socket.id);
        
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges
        }));
        io.emit('onlineList', onlineList);
        io.emit('onlineCount', onlineUsers.size);
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
