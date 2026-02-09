const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(__dirname));

// Хранилище
const users = new Map();
const messages = [];

// Socket.io
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    
    socket.on('join', (data) => {
        const userId = 'User_' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const user = {
            id: userId,
            socketId: socket.id,
            badges: data.badges || ['new']
        };
        users.set(socket.id, user);
        socket.emit('userData', user);
        socket.emit('messageHistory', messages);
    });
    
    socket.on('sendMessage', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        const message = {
            id: Date.now(),
            userId: user.id,
            text: data.text,
            time: new Date().toLocaleTimeString('ru', {hour: '2-digit', minute:'2-digit'}),
            badges: user.badges
        };
        
        messages.push(message);
        io.emit('newMessage', message);
    });
    
    socket.on('disconnect', () => {
        users.delete(socket.id);
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
