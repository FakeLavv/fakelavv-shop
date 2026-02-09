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
app.use(express.static(__dirname));
app.use('/music', express.static(path.join(__dirname, 'music')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Хранилище пользователей (в памяти, для продакшена используй MongoDB/Postgres)
const users = new Map(); // username -> {password, email, badges, createdAt}
const sessions = new Map(); // socket.id -> username
const messages = []; // История сообщений (последние 100)
const onlineUsers = new Map(); // socket.id -> {username, badges}

// ===== API РЕГИСТРАЦИИ И АВТОРИЗАЦИИ =====

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    // Валидация
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
    
    // Проверка существования
    if (users.has(username)) {
        return res.status(400).json({ error: 'Имя пользователя занято' });
    }
    
    // Проверка email
    for (const user of users.values()) {
        if (user.email === email) {
            return res.status(400).json({ error: 'Email уже используется' });
        }
    }
    
    // Хеширование пароля
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Создание пользователя
    const newUser = {
        username,
        email,
        password: hashedPassword,
        badges: ['new'],
        createdAt: Date.now(),
        lastLogin: Date.now()
    };
    
    users.set(username, newUser);
    
    // Автоматический вход
    req.session.username = username;
    
    console.log(`✅ Новый пользователь: ${username}`);
    
    res.json({ 
        success: true, 
        username,
        badges: newUser.badges,
        message: 'Регистрация успешна!'
    });
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = users.get(username);
    if (!user) {
        return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    user.lastLogin = Date.now();
    req.session.username = username;
    
    console.log(`🔑 Вход: ${username}`);
    
    res.json({
        success: true,
        username,
        badges: user.badges
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
            email: user.email
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
    
    // Присоединение к чату (только для авторизованных)
    socket.on('joinChat', (data) => {
        const { username } = data;
        
        if (!username || !users.has(username)) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        const user = users.get(username);
        
        // Сохраняем сессию
        sessions.set(socket.id, username);
        onlineUsers.set(socket.id, {
            username,
            badges: user.badges
        });
        
        // Отправляем историю сообщений (последние 50)
        socket.emit('chatHistory', messages.slice(-50));
        
        // Уведомляем всех о новом пользователе
        io.emit('userJoined', {
            username,
            badges: user.badges,
            onlineCount: onlineUsers.size
        });
        
        // Отправляем список онлайн
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges
        }));
        io.emit('onlineList', onlineList);
        
        console.log(`💬 ${username} вошёл в чат`);
    });
    
    // Отправка сообщения
    socket.on('sendMessage', (data) => {
        const username = sessions.get(socket.id);
        
        if (!username) {
            socket.emit('error', { message: 'Необходима авторизация' });
            return;
        }
        
        const { text } = data;
        if (!text || text.trim().length === 0) {
            return;
        }
        
        if (text.length > 500) {
            socket.emit('error', { message: 'Сообщение слишком длинное (макс 500 символов)' });
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
        
        // Сохраняем в историю
        messages.push(message);
        if (messages.length > 100) {
            messages.shift(); // Удаляем старые
        }
        
        // Отправляем всем
        io.emit('newMessage', message);
        
        console.log(`💬 ${username}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    });
    
    // Админ команды (только для Owner)
    socket.on('adminCommand', (data) => {
        const username = sessions.get(socket.id);
        if (!username) return;
        
        const user = users.get(username);
        if (!user.badges.includes('owner')) {
            socket.emit('error', { message: 'Нет прав' });
            return;
        }
        
        const { command, targetUsername, badge } = data;
        
        if (command === 'giveBadge') {
            const target = users.get(targetUsername);
            if (target) {
                if (!target.badges.includes(badge)) {
                    target.badges.push(badge);
                    // Обновляем у онлайн пользователя если есть
                    for (const [sid, uname] of sessions) {
                        if (uname === targetUsername) {
                            const onlineUser = onlineUsers.get(sid);
                            if (onlineUser) {
                                onlineUser.badges = target.badges;
                            }
                            io.to(sid).emit('badgeUpdate', target.badges);
                        }
                    }
                    socket.emit('success', `Бейджик ${badge} выдан ${targetUsername}`);
                }
            }
        } else if (command === 'removeBadge') {
            const target = users.get(targetUsername);
            if (target) {
                target.badges = target.badges.filter(b => b !== badge);
                for (const [sid, uname] of sessions) {
                    if (uname === targetUsername) {
                        const onlineUser = onlineUsers.get(sid);
                        if (onlineUser) {
                            onlineUser.badges = target.badges;
                        }
                        io.to(sid).emit('badgeUpdate', target.badges);
                    }
                }
                socket.emit('success', `Бейджик ${badge} удалён у ${targetUsername}`);
            }
        }
    });
    
    // Отключение
    socket.on('disconnect', () => {
        const username = sessions.get(socket.id);
        if (username) {
            console.log(`👋 ${username} вышел из чата`);
        }
        
        sessions.delete(socket.id);
        onlineUsers.delete(socket.id);
        
        // Обновляем список онлайн
        const onlineList = Array.from(onlineUsers.values()).map(u => ({
            username: u.username,
            badges: u.badges
        }));
        io.emit('onlineList', onlineList);
        io.emit('onlineCount', onlineUsers.size);
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`👥 Пользователей: ${users.size}`);
});
