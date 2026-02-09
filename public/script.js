function loadExamples() {
    console.log('📷 Загрузка примеров работ из папок');
    
    const examplesGrid = document.getElementById('examplesGrid');
    const exampleTypeBtns = document.querySelectorAll('.example-type-btn');
    
    // Примеры работ из локальных папок (исправлены описания из вашего файла)
    const examples = {
        photo: [
            { 
                title: "Дизайн логотипа", 
                desc: "Профессиональный дизайн логотипа", 
                media: "examples/image/photo1.jpg", 
                type: "photo"
            },
            { 
                title: "Дизайн приложения", 
                desc: "Дизайн приложения", 
                media: "examples/image/photo2.jpg", 
                type: "photo"
            },
            { 
                title: "Дизайн баннера", 
                desc: "Рекламный баннер для соцсетей", 
                media: "examples/image/photo3.jpg", 
                type: "photo"
            },
            { 
                title: "Дизайн аватарки", 
                desc: "Дизайн аватарки", 
                media: "examples/image/photo4.jpg", 
                type: "photo"
            },
            { 
                title: "Дизайн сайта", 
                desc: "Полный дизайн веб-сайта", 
                media: "examples/image/photo5.jpg", 
                type: "photo"
            },
            { 
                title: "Дизайн обложки", 
                desc: "Дизайн обложки", 
                media: "examples/image/photo6.jpg", 
                type: "photo"
            }
        ],
        video: [
            { 
                title: "Анимация логотипа", 
                desc: "Анимированный логотип", 
                media: "examples/video/video1.mp4", 
                type: "video"
            },
            { 
                title: "Презентация проекта", 
                desc: "Видео-презентация проекта", 
                media: "examples/video/video2.mp4", 
                type: "video"
            },
            { 
                title: "Рекламный ролик", 
                desc: "Короткий рекламный ролик", 
                media: "examples/video/video3.mp4", 
                type: "video"
            }
        ]
    };
    
    // Функция для проверки доступности файла
    function checkFileExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url + '?' + new Date().getTime(); // Добавляем timestamp для избежания кэша
        });
    }
    
    // Функция для создания элемента медиа
    async function createMediaElement(example, type) {
        const mediaContainer = document.createElement('div');
        mediaContainer.className = 'example-media-container';
        mediaContainer.style.position = 'relative';
        mediaContainer.style.height = '200px';
        mediaContainer.style.overflow = 'hidden';
        mediaContainer.style.borderRadius = '15px 15px 0 0';
        mediaContainer.style.background = 'linear-gradient(45deg, #111111, #333333, #555555)';
        mediaContainer.style.display = 'flex';
        mediaContainer.style.alignItems = 'center';
        mediaContainer.style.justifyContent = 'center';
        mediaContainer.style.color = '#888888';
        
        // Сначала проверяем, существует ли файл
        const fileExists = await checkFileExists(example.media);
        
        if (!fileExists) {
            console.error(`❌ Файл не найден: ${example.media}`);
            mediaContainer.innerHTML = `
                <div style="text-align: center;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <div>Файл не найден</div>
                    <div style="font-size: 0.8rem; margin-top: 5px;">${example.media}</div>
                </div>
            `;
            return mediaContainer;
        }
        
        console.log(`✅ Файл найден: ${example.media}`);
        
        if (type === 'photo') {
            // Для фото
            const img = document.createElement('img');
            img.className = 'example-media';
            img.alt = example.title;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.transition = 'opacity 0.3s ease';
            img.style.opacity = '0';
            
            img.onload = function() {
                console.log(`✅ Фото загружено: ${example.media}`);
                img.style.opacity = '1';
                mediaContainer.style.background = 'none';
            };
            
            img.onerror = function() {
                console.error(`❌ Ошибка загрузки фото: ${example.media}`);
                mediaContainer.innerHTML = `
                    <div style="text-align: center;">
                        <i class="fas fa-image" style="font-size: 2rem; margin-bottom: 10px;"></i>
                        <div>${example.title}</div>
                        <div style="font-size: 0.8rem; margin-top: 5px;">(ошибка загрузки)</div>
                    </div>
                `;
            };
            
            img.src = example.media;
            mediaContainer.innerHTML = '';
            mediaContainer.appendChild(img);
            
        } else {
            // Для видео
            const video = document.createElement('video');
            video.className = 'example-media';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'metadata';
            
            const source = document.createElement('source');
            source.src = example.media;
            source.type = 'video/mp4';
            video.appendChild(source);
            
            // Обработчики ошибок для видео
            video.onerror = function() {
                console.error(`❌ Ошибка загрузки видео: ${example.media}`);
                mediaContainer.innerHTML = `
                    <div style="text-align: center;">
                        <i class="fas fa-video" style="font-size: 2rem; margin-bottom: 10px;"></i>
                        <div>${example.title}</div>
                        <div style="font-size: 0.8rem; margin-top: 5px;">(ошибка загрузки)</div>
                    </div>
                `;
            };
            
            video.oncanplay = function() {
                console.log(`✅ Видео загружено: ${example.media}`);
                mediaContainer.style.background = 'none';
            };
            
            mediaContainer.innerHTML = '';
            mediaContainer.appendChild(video);
        }
        
        return mediaContainer;
    }
    
    // Функция для отображения примеров
    async function showExamples(type) {
        const examplesData = examples[type] || [];
        
        // Очищаем сетку
        examplesGrid.innerHTML = '<div style="text-align: center; padding: 20px; color: #888888;">Загрузка примеров...</div>';
        
        // Создаем элементы асинхронно
        const exampleCards = [];
        
        for (let i = 0; i < examplesData.length; i++) {
            const example = examplesData[i];
            
            const card = document.createElement('div');
            card.className = 'example-card';
            card.style.animationDelay = `${i * 0.05}s`;
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            
            // Создаем контейнер для медиа
            const mediaContainer = await createMediaElement(example, type);
            
            // Создаем блок с информацией
            const infoDiv = document.createElement('div');
            infoDiv.className = 'example-info';
            infoDiv.innerHTML = `
                <h3 class="example-title">${example.title}</h3>
                <p class="example-desc">${example.desc}</p>
            `;
            
            // Добавляем элементы в карточку
            card.appendChild(mediaContainer);
            card.appendChild(infoDiv);
            
            exampleCards.push(card);
        }
        
        // Очищаем и добавляем все карточки
        examplesGrid.innerHTML = '';
        exampleCards.forEach(card => {
            examplesGrid.appendChild(card);
            // Анимация появления
            setTimeout(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 10);
        });
        
        console.log(`✅ Загружено ${exampleCards.length} примеров типа "${type}"`);
    }
    
    // Показываем фото по умолчанию
    showExamples('photo');
    
    // Обработчики для кнопок переключения
    exampleTypeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.getAttribute('data-type');
            
            // Удаляем активный класс у всех кнопок
            exampleTypeBtns.forEach(b => b.classList.remove('active'));
            
            // Добавляем активный класс текущей кнопке
            this.classList.add('active');
            
            // Показываем соответствующие примеры
            showExamples(type);
        });
    });
}
function loadFAQ() {
    const faqGrid = document.querySelector('.faq-grid');
    if (faqGrid) {
        const faqs = [
            {
                icon: 'fa-clock',
                question: 'Сколько выполняется заказ?',
                answer: 'Срок выполнения зависит от сложности работы: от 1 часа до 24 часов. Срочные заказы выполняются в приоритетном порядке с доплатой +50% к стоимости. Мы всегда стараемся выполнить работу как можно быстрее.'
            },
            {
                icon: 'fa-user-secret',
                question: 'Насколько анонимно?',
                answer: 'Полная анонимность гарантирована. Все данные шифруются, не хранятся на серверах и удаляются сразу после выполнения работы. Используются безопасные каналы связи. Никакая личная информация не передается третьим лицам.'
            },
            {
                icon: 'fa-ban',
                question: 'Возврат средств?',
                answer: 'ВОЗВРАТА НЕТ. Все услуги оказываются в цифровом формате и не подлежат возврату после начала выполнения. Перед оплатой вы получаете полную консультацию и согласовываете все детали работы.'
            },
            {
                icon: 'fa-headset',
                question: 'Есть ли поддержка?',
                answer: 'Поддержка 24/7 в Telegram. Отвечаем в течение 5-15 минут в рабочее время, в нерабочее - до 1 часа. Помогаем на всех этапах работы, от консультации до внедрения.'
            },
            {
                icon: 'fa-shield-alt',
                question: 'Какие гарантии?',
                answer: 'Гарантия на выполненные работы - 14 дней. Если возникнут проблемы по нашей вине, бесплатно исправим. Гарантируем качество и соблюдение сроков. Все работы тестируются перед сдачей.'
            },
            {
                icon: 'fa-credit-card',
                question: 'Способы оплаты?',
                answer: 'ЮMoney (Яндекс.Деньги), банковские карты, криптовалюта (BTC, USDT). Все платежи анонимны. После оплаты сразу приступаем к работе. Подробные инструкции по оплате предоставляются.'
            },
            {
                icon: 'fa-lock',
                question: 'Конфиденциальность данных?',
                answer: 'Мы не передаем третьим лицам любые данные клиентов. Все рабочие процессы защищены, чаты автоматически очищаются после завершения проекта. Ваша безопасность - наш приоритет.'
            },
            {
                icon: 'fa-exchange-alt',
                question: 'Можно ли внести правки?',
                answer: 'Да, до 3 правок включены в стоимость (кроме услуг категории "Чёрнуха"). Дополнительные правки обсуждаются индивидуально. Мы всегда идем навстречу клиентам.'
            },
            {
                icon: 'fa-exclamation-triangle',
                question: 'Юридическая ответственность?',
                answer: 'Мы не несем ответственности за использование предоставленных услуг в незаконных целях. Все услуги предоставляются исключительно в образовательных и ознакомительных целях.'
            },
            {
                icon: 'fa-file-contract',
                question: 'Нужно ли заключать договор?',
                answer: 'Договор не требуется. Все условия оговариваются устно в Telegram. Мы дорожим своей репутацией и выполняем все взятые на себя обязательства.'
            }
        ];
        
        faqGrid.innerHTML = faqs.map((faq, index) => `
            <div class="faq-card slide-in-right" style="animation-delay: ${index * 0.1}s;">
                <h3><i class="fas ${faq.icon}"></i> ${faq.question}</h3>
                <p>${faq.answer}</p>
            </div>
        `).join('');
        
        console.log('✅ FAQ загружено: ' + faqs.length + ' вопросов');
    }
}