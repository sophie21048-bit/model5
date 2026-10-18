// ================================
// СООБЩИТЬ О ПРЕПЯТСТВИИ
// Фото + координаты + (необязательно) проверка моделью Roboflow
// ================================

// ВАЖНО: вставьте сюда свои данные из Roboflow (инструкция в README).
const CURB_CONFIG = {
    // Идентификатор модели: скопируйте его на странице Models
    // (кнопка копирования рядом с Model URL)
    MODEL_ID: "s-workspace-6oush/curbs-qavhj-4-rfdetr-small-t1",

    // Запасной вариант ID (необязательно). Если первый не подойдёт, сайт попробует этот.
    // Например, короткий вид "проект/номер версии": "curbs-qavhj/4"
    MODEL_ID_ALT: "curbs-qavhj/4",

    // Publishable Key из Roboflow: Settings -> API Keys
    API_KEY: "rf_A0B9nvbgXCeqfsLibxCZFsQ6MoZ2",

    // Адрес облачного API Roboflow (менять не нужно)
    ENDPOINT: "https://serverless.roboflow.com",

    // Максимальная ширина фото при отправке (px). Большие панорамы уменьшаются.
    MAX_WIDTH: 1600,

    // Сколько секунд ждать ответ модели (первый запуск может быть медленным)
    TIMEOUT_SECONDS: 60
};

(function () {
    function byId(id) {
        return document.getElementById(id);
    }

    const fileInput = byId("curbFile");
    const runButton = byId("curbRun");
    const thresholdInput = byId("curbThreshold");
    const thresholdValue = byId("curbThresholdValue");
    const statusEl = byId("curbStatus");
    const canvas = byId("curbCanvas");
    const typeSelect = byId("curbType");
    const coordsInput = byId("curbCoords");
    const pickButton = byId("curbPick");
    const locateButton = byId("curbLocate");
    const commentInput = byId("curbComment");
    const saveButton = byId("curbSave");
    const saveMessage = byId("curbSaveMessage");
    const countEl = byId("curbCount");
    const exportButton = byId("curbExport");
    const listEl = byId("curbList");

    if (!fileInput || !canvas || !saveButton) {
        return;
    }

    const ctx = canvas.getContext("2d");

    let currentImage = null;   // фото без рамок
    let predictions = [];      // ответ модели


    // ---------- Сообщения ----------

    function setStatus(text, isError) {
        statusEl.textContent = text;
        statusEl.classList.toggle("is-error", Boolean(isError));
    }

    function setSaveMessage(text, isError) {
        saveMessage.textContent = text;
        saveMessage.classList.toggle("is-error", Boolean(isError));
    }

    function isConfigured() {
        return (
            CURB_CONFIG.MODEL_ID &&
            CURB_CONFIG.API_KEY &&
            !CURB_CONFIG.MODEL_ID.startsWith("ВСТАВЬТЕ") &&
            !CURB_CONFIG.API_KEY.startsWith("ВСТАВЬТЕ")
        );
    }


    // ---------- Фото ----------

    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.onerror = function () {
                reject(new Error("Не удалось прочитать файл."));
            };

            reader.onload = function () {
                const img = new Image();

                img.onerror = function () {
                    reject(new Error("Не удалось открыть изображение. Попробуйте JPG или PNG."));
                };

                img.onload = function () {
                    const scale = Math.min(1, CURB_CONFIG.MAX_WIDTH / img.width);
                    const w = Math.round(img.width * scale);
                    const h = Math.round(img.height * scale);

                    canvas.width = w;
                    canvas.height = h;
                    ctx.drawImage(img, 0, 0, w, h);

                    resolve({ width: w, height: h });
                };

                img.src = reader.result;
            };

            reader.readAsDataURL(file);
        });
    }

    // Маленькая копия фото для сохранения в базе
    function makeThumbnail() {
        if (!currentImage) {
            return "";
        }

        try {
            const full = document.createElement("canvas");
            full.width = currentImage.width;
            full.height = currentImage.height;
            full.getContext("2d").putImageData(currentImage, 0, 0);

            const width = 240;
            const height = Math.round(currentImage.height * width / currentImage.width);

            const small = document.createElement("canvas");
            small.width = width;
            small.height = height;
            small.getContext("2d").drawImage(full, 0, 0, width, height);

            return small.toDataURL("image/jpeg", 0.6);
        } catch (error) {
            return "";
        }
    }


    // ---------- Модель Roboflow ----------

    async function detectWith(modelId) {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        const base64 = dataUrl.split(",")[1];

        const url =
            CURB_CONFIG.ENDPOINT + "/" + modelId +
            "?api_key=" + encodeURIComponent(CURB_CONFIG.API_KEY) +
            "&confidence=10";

        const controller = new AbortController();
        const timer = setTimeout(function () {
            controller.abort();
        }, CURB_CONFIG.TIMEOUT_SECONDS * 1000);

        let response;

        try {
            response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: base64,
                signal: controller.signal
            });
        } catch (error) {
            console.error(error);

            if (error && error.name === "AbortError") {
                throw new Error(
                    "Модель не ответила за " + CURB_CONFIG.TIMEOUT_SECONDS +
                    " секунд. Первый запрос бывает долгим: попробуйте ещё раз."
                );
            }

            const hint = location.protocol === "file:"
                ? " Сайт открыт как файл: откройте его по ссылке github.io."
                : " Отключите VPN и блокировщики рекламы и попробуйте снова.";

            throw new Error(
                "Не удалось связаться с Roboflow." + hint +
                " Подробности: " + (error && error.message ? error.message : error)
            );
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            let details = "";
            try { details = await response.text(); } catch (e) {}
            console.error("Ответ Roboflow:", response.status, details);

            if (response.status === 401 || response.status === 403) {
                throw new Error("Roboflow не принял ключ (ошибка " + response.status + "). Проверьте API_KEY.");
            }

            if (response.status === 404) {
                throw new Error("Модель не найдена (ошибка 404). Проверьте MODEL_ID: он должен быть скопирован целиком.");
            }

            throw new Error("Модель вернула ошибку " + response.status + ".");
        }

        const data = await response.json();
        return data.predictions || [];
    }

    // Пробуем основной ID, затем запасной
    async function detect() {
        const ids = [CURB_CONFIG.MODEL_ID, CURB_CONFIG.MODEL_ID_ALT]
            .map(function (id) { return (id || "").trim(); })
            .filter(function (id) { return id && !id.startsWith("ВСТАВЬТЕ"); });

        let lastError = null;

        for (const id of ids) {
            try {
                const result = await detectWith(id);
                console.log("Модель ответила, рабочий ID:", id);
                return result;
            } catch (error) {
                console.warn("ID не подошёл:", id, error);
                lastError = error;
            }
        }

        throw lastError || new Error("Не указан ID модели.");
    }

    function visiblePredictions() {
        const threshold = Number(thresholdInput.value) / 100;

        return predictions.filter(function (p) {
            return p.confidence >= threshold;
        });
    }

    // Рамки поверх фото
    function draw() {
        if (!currentImage) {
            return;
        }

        ctx.putImageData(currentImage, 0, 0);

        const visible = visiblePredictions();

        const lineWidth = Math.max(2, Math.round(canvas.width / 400));
        const fontSize = Math.max(12, Math.round(canvas.width / 70));

        ctx.lineWidth = lineWidth;
        ctx.font = "600 " + fontSize + "px Manrope, system-ui, sans-serif";
        ctx.textBaseline = "top";

        visible.forEach(function (p) {
            const x = p.x - p.width / 2;
            const y = p.y - p.height / 2;

            ctx.strokeStyle = "#82505f";
            ctx.strokeRect(x, y, p.width, p.height);

            const label = "бордюр " + Math.round(p.confidence * 100) + "%";
            const textWidth = ctx.measureText(label).width;
            const pad = 4;

            ctx.fillStyle = "#82505f";
            ctx.fillRect(x, y, textWidth + pad * 2, fontSize + pad * 2);

            ctx.fillStyle = "#ffffff";
            ctx.fillText(label, x + pad, y + pad);
        });

        if (visible.length === 0) {
            setStatus("Модель не нашла бордюров при пороге " + thresholdInput.value + "%. Можно снизить порог.");
        } else {
            setStatus("Модель нашла бордюров: " + visible.length + ". Выберите тип препятствия и укажите место.");
        }
    }

    fileInput.addEventListener("change", async function () {
        const file = fileInput.files && fileInput.files[0];

        if (!file) {
            return;
        }

        try {
            setStatus("Загружаю фото...");
            const size = await loadImage(file);

            canvas.hidden = false;
            currentImage = ctx.getImageData(0, 0, size.width, size.height);
            predictions = [];
            runButton.hidden = false;

            setStatus("Фото загружено. Можно проверить его моделью или сразу указать тип и место.");
        } catch (error) {
            console.error(error);
            setStatus(error.message || "Не удалось открыть фото.", true);
        }

        // Позволяет выбрать то же самое фото ещё раз
        fileInput.value = "";
    });

    runButton.addEventListener("click", async function () {
        if (!currentImage) {
            setStatus("Сначала выберите фото.", true);
            return;
        }

        if (!isConfigured()) {
            setStatus("В файле curb-model.js не указаны ID модели и ключ Roboflow.", true);
            return;
        }

        runButton.disabled = true;

        try {
            setStatus("Модель ищет бордюры...");
            predictions = await detect();
            draw();
        } catch (error) {
            console.error(error);
            setStatus(error.message || "Не удалось обработать фото.", true);
        } finally {
            runButton.disabled = false;
        }
    });

    thresholdInput.addEventListener("input", function () {
        thresholdValue.textContent = thresholdInput.value + "%";
        draw();
    });


    // ---------- Координаты ----------

    pickButton.addEventListener("click", function () {
        const mapEl = byId("map");

        const ok = window.RouteApp && window.RouteApp.requestMapPick(function (coords) {
            coordsInput.value = window.RouteApp.formatCoordinates(coords);
            setSaveMessage("Место выбрано на карте.");
            saveButton.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        if (!ok) {
            setSaveMessage("Карта ещё не загрузилась.", true);
            return;
        }

        setSaveMessage("Нажмите на карте место, где находится препятствие.");

        if (mapEl) {
            mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    });

    locateButton.addEventListener("click", function () {
        if (!navigator.geolocation) {
            setSaveMessage("Браузер не поддерживает определение геопозиции.", true);
            return;
        }

        setSaveMessage("Определяю геопозицию...");

        navigator.geolocation.getCurrentPosition(
            function (position) {
                coordsInput.value = window.RouteApp.formatCoordinates([
                    position.coords.latitude,
                    position.coords.longitude
                ]);
                setSaveMessage("Геопозиция добавлена.");
            },
            function () {
                setSaveMessage("Не удалось определить геопозицию. Разрешите доступ или укажите место на карте.", true);
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    });


    // ---------- Сохранение в базу ----------

    saveButton.addEventListener("click", function () {
        const coords = window.RouteApp.parseCoordinates(coordsInput.value);

        if (!coords) {
            setSaveMessage("Укажите координаты в виде «43.5855, 39.7231» или нажмите «Указать на карте».", true);
            return;
        }

        const type = typeSelect.value;

        const item = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: type,
            lat: coords[0],
            lon: coords[1],
            comment: commentInput.value.trim(),
            createdAt: new Date().toISOString(),
            curbsFound: currentImage && predictions.length ? visiblePredictions().length : null,
            thumb: makeThumbnail()
        };

        const saved = window.RouteApp.addObstacle(item);

        coordsInput.value = "";
        commentInput.value = "";

        setSaveMessage(
            saved
                ? "Добавлено. Метка появилась на карте и учитывается в оценке маршрутов."
                : "Метка добавлена, но сохранить её в браузере не удалось (нет места)."
        );
    });


    // ---------- Список и экспорт ----------

    function renderList(items) {
        countEl.textContent = items.length
            ? "Сообщений в базе: " + items.length
            : "Пока нет сообщений о препятствиях.";

        exportButton.hidden = items.length === 0;

        listEl.textContent = "";

        items.slice().reverse().forEach(function (item) {
            const typeInfo = window.RouteApp.obstacleTypes[item.type];

            const li = document.createElement("li");

            const text = document.createElement("span");
            text.textContent =
                (typeInfo ? typeInfo.label : "Препятствие") + " — " +
                item.lat.toFixed(5) + ", " + item.lon.toFixed(5) +
                (item.comment ? " (" + item.comment + ")" : "");

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "curb-remove";
            remove.textContent = "Удалить";
            remove.addEventListener("click", function () {
                window.RouteApp.removeObstacle(item.id);
            });

            li.appendChild(text);
            li.appendChild(remove);
            listEl.appendChild(li);
        });
    }

    exportButton.addEventListener("click", function () {
        const data = JSON.stringify(window.RouteApp.getObstacles(), null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = "obstacles.json";
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
    });

    if (window.RouteApp) {
        window.RouteApp.onChange(renderList);
        renderList(window.RouteApp.getObstacles());
    }
})();
