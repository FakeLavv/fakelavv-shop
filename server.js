const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(__dirname));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/music', express.static(path.join(__dirname, 'music')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/examples', express.static(path.join(__dirname, 'examples'))); // ← Добавьте эту строку

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Сайт запущен: http://localhost:${PORT}`);
    console.log(`🎵 Музыка: /music/`);
    console.log(`🖼️ Изображения: /images/`);
    console.log(`🎥 Видео: /videos/`);
    console.log(`📸 Примеры: /examples/`);
});