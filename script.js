// ================================
// ДОСТУПНЫЙ МАРШРУТ
// script.js: карта, маршрут, оценка доступности, база препятствий
// ================================

// Города: значение в списке -> название и координаты центра
const CITIES = {
    sochi: { name: "Сочи", coordinates: [43.5855, 39.7231] },
    moscow: { name: "Москва", coordinates: [55.7558, 37.6173] },
    kazan: { name: "Казань", coordinates: [55.7887, 49.1221] },
    spb: { name: "Санкт-Петербург", coordinates: [59.9343, 30.3351] }
};

// Категории пользователей: название и коэффициент строгости оценки
const USER_TYPES = {
    default: { label: "", factor: 1 },
    wheelchair: { label: "человек на коляске", factor: 1.5 },
    stroller: { label: "родитель с коляской", factor: 1.25 },
    senior: { label: "пожилой человек", factor: 1.1 }
};

// Типы препятствий: название и штраф (в процентных пунктах) к оценке маршрута
const OBSTACLE_TYPES = {
    high_curb: { label: "Высокий бордюр", penalty: 12 },
    broken_curb: { label: "Сломанный бордюр", penalty: 15 },
    stairs: { label: "Лестница", penalty: 20 },
    bad_surface: { label: "Разбитое покрытие", penalty: 8 },
    obstacle: { label: "Препятствие на пути", penalty: 10 }
};

// Препятствие считается «на маршруте», если оно ближе этого расстояния (метры)
const NEAR_METERS = 25;

// Цвета совпадают с легендой под картой
const COLOR_OK = "#6f8f6a";
const COLOR_WARN = "#c08a3e";
const COLOR_BAD = "#ad5850";

let map = null;
let multiRoute = null;
let obstacleCollection = null;
let pickCallback = null;       // ждём клик по карте для выбора места
let lastRoute = null;          // последний построенный маршрут

const OBSTACLES_KEY = "accessibleRouteObstacles";
let obstacles = [];
const changeListeners = [];


// ================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ================================

function getCity(key) {
    return CITIES[key] || CITIES.sochi;
}

// Сообщение под кнопкой «Построить маршрут»
function showMessage(message, type) {
    console.log(message);

    const el = document.getElementById("routeMessage");

    if (!el) {
        return;
    }

    el.textContent = message;
    el.style.color = type === "error" ? COLOR_BAD : "";
    el.style.fontWeight = type === "error" ? "600" : "";
    el.style.fontSize = type === "error" ? "14px" : "";
}

// Если в скрипте случится неожиданная ошибка, покажем её на странице
window.addEventListener("error", function (event) {
    showMessage("Ошибка на странице: " + event.message, "error");
});

function hideResult() {
    const box = document.getElementById("routeResult");

    if (box) {
        box.hidden = true;
    }
}

// Добавляем город к адресу, если пользователь его не указал
function prepareAddress(address, cityName) {
    address = address.trim();

    if (!address) {
        return "";
    }

    // Координаты (выбор кликом по карте) оставляем как есть
    if (parseCoordinates(address)) {
        return address;
    }

    const lower = address.toLowerCase();

    const hasCity = Object.values(CITIES).some(function (city) {
        return lower.includes(city.name.toLowerCase());
    });

    if (hasCity) {
        return address;
    }

    return cityName + ", " + address;
}

// Разбор координат вида «43.5855, 39.7231». Возвращает [широта, долгота] или null
function parseCoordinates(text) {
    if (typeof text !== "string") {
        return null;
    }

    const match = text.trim().match(
        /^(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/
    );

    if (!match) {
        return null;
    }

    const lat = Number(match[1]);
    const lon = Number(match[2]);

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return null;
    }

    return [lat, lon];
}

function formatCoordinates(coords) {
    return coords[0].toFixed(6) + ", " + coords[1].toFixed(6);
}

// Расстояние от точки p до отрезка a-b в метрах (координаты [широта, долгота])
function distanceToSegment(p, a, b) {
    const kLat = 111320;
    const kLon = 111320 * Math.cos(p[0] * Math.PI / 180);

    const ax = (a[1] - p[1]) * kLon;
    const ay = (a[0] - p[0]) * kLat;
    const bx = (b[1] - p[1]) * kLon;
    const by = (b[0] - p[0]) * kLat;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    let t = 0;

    if (lengthSquared > 0) {
        t = -(ax * dx + ay * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));
    }

    const px = ax + t * dx;
    const py = ay + t * dy;

    return Math.sqrt(px * px + py * py);
}

function distanceToPolyline(point, line) {
    if (!line || line.length === 0) {
        return Infinity;
    }

    if (line.length === 1) {
        return distanceToSegment(point, line[0], line[0]);
    }

    let best = Infinity;

    for (let i = 0; i < line.length - 1; i++) {
        const d = distanceToSegment(point, line[i], line[i + 1]);

        if (d < best) {
            best = d;
        }
    }

    return best;
}

function toArray(collection) {
    if (!collection) {
        return [];
    }

    if (Array.isArray(collection)) {
        return collection;
    }

    if (typeof collection.toArray === "function") {
        return collection.toArray();
    }

    const result = [];

    if (typeof collection.each === "function") {
        collection.each(function (item) {
            result.push(item);
        });
    }

    return result;
}

// Координаты всех точек маршрута (по тротуарам, с поворотами)
function extractRouteCoordinates(route) {
    const coordinates = [];

    try {
        const active = route.getActiveRoute();

        toArray(active.getPaths()).forEach(function (path) {
            toArray(path.getSegments()).forEach(function (segment) {
                let points = null;

                try {
                    points = segment.properties.get("coordinates");
                } catch (error) {
                    points = null;
                }

                if (!points && segment.geometry) {
                    try {
                        points = segment.geometry.getCoordinates();
                    } catch (error) {
                        points = null;
                    }
                }

                if (points) {
                    points.forEach(function (point) {
                        coordinates.push(point);
                    });
                }
            });
        });
    } catch (error) {
        console.warn("Не удалось получить точки маршрута:", error);
    }

    return coordinates;
}


// ================================
// БАЗА ПРЕПЯТСТВИЙ
// (в этом браузере + необязательный файл obstacles.json)
// ================================

function loadObstacles() {
    try {
        const saved = JSON.parse(localStorage.getItem(OBSTACLES_KEY));
        obstacles = Array.isArray(saved) ? saved : [];
    } catch (error) {
        obstacles = [];
    }
}

function saveObstacles() {
    try {
        localStorage.setItem(OBSTACLES_KEY, JSON.stringify(obstacles));
        return true;
    } catch (error) {
        console.warn("Не удалось сохранить базу препятствий:", error);
        return false;
    }
}

function notifyChange() {
    changeListeners.forEach(function (listener) {
        try {
            listener(obstacles);
        } catch (error) {
            console.error(error);
        }
    });
}

// Общий файл obstacles.json из репозитория: данные видны всем посетителям сайта
async function loadSharedObstacles() {
    try {
        const response = await fetch("obstacles.json", { cache: "no-store" });

        if (!response.ok) {
            return;
        }

        const shared = await response.json();

        if (!Array.isArray(shared)) {
            return;
        }

        let added = 0;

        shared.forEach(function (item) {
            const valid =
                item && item.id && OBSTACLE_TYPES[item.type] &&
                typeof item.lat === "number" && typeof item.lon === "number";

            if (valid && !obstacles.some(function (o) { return o.id === item.id; })) {
                obstacles.push(item);
                added++;
            }
        });

        if (added > 0) {
            refreshObstacleMarkers();
            notifyChange();
        }
    } catch (error) {
        console.log("Общий файл obstacles.json не загружен:", error);
    }
}

function obstacleColor(type) {
    const penalty = OBSTACLE_TYPES[type] ? OBSTACLE_TYPES[type].penalty : 10;

    return penalty >= 15 ? COLOR_BAD : COLOR_WARN;
}

function refreshObstacleMarkers() {
    if (!map || typeof ymaps === "undefined") {
        return;
    }

    if (!obstacleCollection) {
        obstacleCollection = new ymaps.GeoObjectCollection();
        map.geoObjects.add(obstacleCollection);
    }

    obstacleCollection.removeAll();

    obstacles.forEach(function (item) {
        const typeInfo = OBSTACLE_TYPES[item.type] || { label: "Препятствие" };

        const placemark = new ymaps.Placemark(
            [item.lat, item.lon],
            {
                hintContent: typeInfo.label,
                balloonContentHeader: typeInfo.label,
                balloonContentBody: item.comment || "Без комментария"
            },
            {
                preset: "islands#circleDotIcon",
                iconColor: obstacleColor(item.type)
            }
        );

        obstacleCollection.add(placemark);
    });
}

function addObstacle(item) {
    obstacles.push(item);

    const saved = saveObstacles();

    refreshObstacleMarkers();
    notifyChange();

    if (lastRoute) {
        renderAssessment();
    }

    return saved;
}

function removeObstacle(id) {
    obstacles = obstacles.filter(function (item) {
        return item.id !== id;
    });

    saveObstacles();
    refreshObstacleMarkers();
    notifyChange();

    if (lastRoute) {
        renderAssessment();
    }
}


// ================================
// ОЦЕНКА МАРШРУТА В ПРОЦЕНТАХ
// ================================

function assessRoute(routeCoordinates, userTypeKey, avoidStairs) {
    const userType = USER_TYPES[userTypeKey] || USER_TYPES.default;

    const found = [];
    let totalPenalty = 0;
    let nearbyKnown = 0;

    obstacles.forEach(function (item) {
        const typeInfo = OBSTACLE_TYPES[item.type];

        if (!typeInfo) {
            return;
        }

        const distance = distanceToPolyline([item.lat, item.lon], routeCoordinates);

        if (distance <= 150) {
            nearbyKnown++;
        }

        if (distance > NEAR_METERS) {
            return;
        }

        let penalty = typeInfo.penalty * userType.factor;

        if (avoidStairs && item.type === "stairs") {
            penalty *= 1.5;
        }

        totalPenalty += penalty;

        found.push({
            obstacle: item,
            label: typeInfo.label,
            distance: Math.round(distance),
            penalty: penalty
        });
    });

    found.sort(function (a, b) {
        return b.penalty - a.penalty;
    });

    const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

    return { score: score, found: found, hasData: nearbyKnown > 0 };
}

function scoreLabel(score) {
    if (score >= 80) {
        return { text: "легко пройти", color: COLOR_OK };
    }

    if (score >= 50) {
        return { text: "есть трудности", color: COLOR_WARN };
    }

    return { text: "трудный маршрут", color: COLOR_BAD };
}

// Показываем оценку в блоке «Оценка доступности»
function renderAssessment() {
    const box = document.getElementById("routeResult");
    const description = document.getElementById("resultDescription");

    if (!box || !description || !lastRoute) {
        return;
    }

    const result = assessRoute(
        lastRoute.coordinates,
        lastRoute.userTypeKey,
        lastRoute.avoidStairs
    );

    // Убираем предыдущую оценку
    const old = document.getElementById("assessmentBox");

    if (old) {
        old.remove();
    }

    const userType = USER_TYPES[lastRoute.userTypeKey] || USER_TYPES.default;

    let text = "Пешеходный маршрут построен";

    if (lastRoute.distance && lastRoute.duration) {
        text += " (" + lastRoute.distance + ", " + lastRoute.duration + ")";
    }

    text += ".";

    if (userType.label) {
        text += " Категория: " + userType.label + ".";
    }

    description.textContent = text;

    const wrapper = document.createElement("div");
    wrapper.id = "assessmentBox";

    const scoreLine = document.createElement("div");
    scoreLine.className = "score-line";

    const value = document.createElement("span");
    value.className = "score-value";

    const label = document.createElement("span");
    label.className = "score-label";

    if (result.hasData) {
        const info = scoreLabel(result.score);

        value.textContent = result.score + "%";
        value.style.color = info.color;
        label.textContent = info.text;
    } else {
        value.textContent = "—";
        label.textContent = "нет данных об этом районе";
    }

    scoreLine.appendChild(value);
    scoreLine.appendChild(label);
    wrapper.appendChild(scoreLine);

    const note = document.createElement("p");
    note.className = "score-note";

    if (!result.hasData) {
        note.textContent =
            "В базе нет сведений о препятствиях рядом с этим маршрутом, поэтому оценку дать нельзя. " +
            "Отсутствие данных не значит, что путь доступен.";
    } else {
        note.textContent =
            "Оценка примерная: считается по известным препятствиям в радиусе " +
            NEAR_METERS + " м от маршрута. Участки без данных не проверены.";
    }

    wrapper.appendChild(note);

    if (result.found.length > 0) {
        const title = document.createElement("strong");
        title.textContent = "Трудные места на пути:";
        wrapper.appendChild(title);

        const list = document.createElement("ul");
        list.className = "warning-list";

        result.found.forEach(function (entry) {
            const li = document.createElement("li");
            const dot = document.createElement("i");

            dot.className = "legend-dot";
            dot.style.background = obstacleColor(entry.obstacle.type);

            li.appendChild(dot);
            li.appendChild(document.createTextNode(
                entry.label + " (в " + entry.distance + " м от линии маршрута)" +
                (entry.obstacle.comment ? ": " + entry.obstacle.comment : "")
            ));

            list.appendChild(li);
        });

        wrapper.appendChild(list);
    } else if (result.hasData) {
        const none = document.createElement("p");
        none.className = "score-note";
        none.textContent = "Известных препятствий на самом маршруте нет.";
        wrapper.appendChild(none);
    }

    description.parentNode.appendChild(wrapper);
    box.hidden = false;
}


// ================================
// ИНИЦИАЛИЗАЦИЯ КАРТЫ
// ================================

function initMap() {
    const citySelect = document.getElementById("citySelect");
    const city = getCity(citySelect ? citySelect.value : "sochi");

    map = new ymaps.Map("map", {
        center: city.coordinates,
        zoom: 12,
        controls: ["zoomControl", "fullscreenControl"]
    });

    map.events.add("click", handleMapClick);

    refreshObstacleMarkers();
}

// Клик по карте: либо выбираем место для сообщения о препятствии,
// либо заполняем пустые поля «Откуда» и «Куда»
function handleMapClick(event) {
    const coords = event.get("coords");

    if (!coords) {
        return;
    }

    if (pickCallback) {
        const callback = pickCallback;
        pickCallback = null;
        callback(coords);
        return;
    }

    const fromInput = document.getElementById("fromInput");
    const toInput = document.getElementById("toInput");

    if (fromInput && !fromInput.value.trim()) {
        fromInput.value = formatCoordinates(coords);
        showMessage("Точка отправления выбрана. Нажмите на карте точку назначения.");
    } else if (toInput && !toInput.value.trim()) {
        toInput.value = formatCoordinates(coords);
        showMessage("Точка назначения выбрана. Нажмите «Построить маршрут».");
    }
}


// ================================
// ГЕОКОДИРОВАНИЕ
// ================================

async function geocodeAddress(address) {
    // Координаты, выбранные кликом, геокодер не нужен
    const direct = parseCoordinates(address);

    if (direct) {
        return direct;
    }

    let result;

    try {
        result = await ymaps.geocode(address, { results: 1 });
    } catch (error) {
        console.error("Ошибка геокодирования:", error);

        const details = error && error.message ? error.message : String(error);
        const hint = location.protocol === "file:"
            ? " Сайт открыт как файл: откройте его по ссылке github.io."
            : " Отключите VPN и блокировщики рекламы, проверьте API-ключ Яндекса.";

        throw new Error(
            "Не удалось связаться с геокодером Яндекса." + hint +
            " Можно выбрать точки кликом по карте. Подробности: " + details
        );
    }

    if (!result || !result.geoObjects || result.geoObjects.getLength() === 0) {
        throw new Error('Адрес "' + address + '" не найден. Проверьте написание.');
    }

    return result.geoObjects.get(0).geometry.getCoordinates();
}


// ================================
// ПОСТРОЕНИЕ МАРШРУТА
// ================================

function removePreviousRoute() {
    if (map && multiRoute) {
        try {
            map.geoObjects.remove(multiRoute);
        } catch (error) {
            console.warn("Не удалось удалить предыдущий маршрут:", error);
        }
    }

    multiRoute = null;
    lastRoute = null;
}

async function buildRoute(event) {
    if (event) {
        event.preventDefault();
    }

    if (!map) {
        showMessage("Карта ещё не загрузилась. Подождите немного и попробуйте снова.", "error");
        return;
    }

    const from = document.getElementById("fromInput").value.trim();
    const to = document.getElementById("toInput").value.trim();
    const cityKey = document.getElementById("citySelect").value;
    const userTypeKey = document.getElementById("userType").value;
    const avoidStairs = document.getElementById("avoidStairs").checked;

    if (!from) {
        showMessage("Введите адрес отправления или нажмите на карте.", "error");
        return;
    }

    if (!to) {
        showMessage("Введите адрес назначения или нажмите на карте.", "error");
        return;
    }

    const cityName = getCity(cityKey).name;

    removePreviousRoute();
    hideResult();
    showMessage("Ищу адреса и строю маршрут...");

    try {
        const startCoordinates = await geocodeAddress(prepareAddress(from, cityName));
        const endCoordinates = await geocodeAddress(prepareAddress(to, cityName));

        const route = new ymaps.multiRouter.MultiRoute(
            {
                referencePoints: [startCoordinates, endCoordinates],
                params: {
                    routingMode: "pedestrian",
                    results: 1
                }
            },
            {
                boundsAutoApply: true,
                routeActiveStrokeWidth: 6,
                routeActiveStrokeColor: "#1976d2",
                routeStrokeWidth: 4,
                routeStrokeColor: "#1976d2"
            }
        );

        multiRoute = route;

        route.model.events.add("requestsuccess", function () {
            let distance = "";
            let duration = "";

            try {
                const active = route.getActiveRoute();

                if (active) {
                    distance = active.properties.get("distance").text;
                    duration = active.properties.get("duration").text;
                }
            } catch (error) {
                console.warn("Не удалось получить длину маршрута:", error);
            }

            let coordinates = extractRouteCoordinates(route);

            // Если точки маршрута получить не удалось, оцениваем по прямой линии
            if (coordinates.length < 2) {
                coordinates = [startCoordinates, endCoordinates];
            }

            lastRoute = {
                coordinates: coordinates,
                userTypeKey: userTypeKey,
                avoidStairs: avoidStairs,
                distance: distance,
                duration: duration
            };

            let message = "Маршрут построен.";

            if (distance && duration) {
                message += " Пешком: " + distance + ", около " + duration + ".";
            }

            showMessage(message);
            renderAssessment();
        });

        route.model.events.add("requestfail", function () {
            showMessage("Яндекс Карты не смогли построить пешеходный маршрут между этими точками.", "error");
        });

        map.geoObjects.add(route);

    } catch (error) {
        console.error("Ошибка:", error);
        showMessage(error.message || "Произошла ошибка при построении маршрута.", "error");
    }
}


// ================================
// ФОРМА МАРШРУТА И СМЕНА ГОРОДА
// ================================

function setupForm() {
    const form = document.getElementById("routeForm");

    if (form) {
        form.addEventListener("submit", buildRoute);
    }
}

function setupCityChange() {
    const citySelect = document.getElementById("citySelect");
    const cityStatus = document.getElementById("cityStatus");

    if (!citySelect) {
        return;
    }

    citySelect.addEventListener("change", function () {
        const city = getCity(citySelect.value);

        if (cityStatus) {
            cityStatus.textContent = city.name;
        }

        if (map) {
            map.setCenter(city.coordinates, 12);
        }

        removePreviousRoute();
        hideResult();
        showMessage("Заполните поля «Откуда» и «Куда» или нажмите на карте, затем нажмите «Построить маршрут».");
    });
}


// ================================
// ВХОД / РЕГИСТРАЦИЯ (в этом браузере)
// ================================

const USER_STORAGE_KEY = "accessibleRouteUser";

function readUser() {
    try {
        return JSON.parse(localStorage.getItem(USER_STORAGE_KEY));
    } catch (error) {
        return null;
    }
}

function saveUser(user) {
    try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
        return true;
    } catch (error) {
        return false;
    }
}

function setupAuth() {
    const openButton = document.getElementById("openAuthButton");
    const closeButton = document.getElementById("closeAuthButton");
    const modal = document.getElementById("authModal");
    const form = document.getElementById("authForm");
    const message = document.getElementById("authMessage");

    if (!openButton || !modal || !form) {
        return;
    }

    function updateButton() {
        const user = readUser();
        openButton.textContent = user ? user.name : "Войти";
    }

    function openModal() {
        const user = readUser();

        if (user) {
            document.getElementById("nameInput").value = user.name;
            document.getElementById("emailInput").value = user.email;
            message.textContent = "Вы уже вошли как " + user.name + ".";
        } else {
            message.textContent = "";
        }

        modal.hidden = false;
    }

    function closeModal() {
        modal.hidden = true;
    }

    openButton.addEventListener("click", openModal);

    if (closeButton) {
        closeButton.addEventListener("click", closeModal);
    }

    modal.addEventListener("click", function (event) {
        if (event.target === modal) {
            closeModal();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !modal.hidden) {
            closeModal();
        }
    });

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        const name = document.getElementById("nameInput").value.trim();
        const email = document.getElementById("emailInput").value.trim();

        // Пароль нигде не сохраняется: это учебный прототип без сервера.
        const saved = saveUser({ name: name, email: email });

        if (!saved) {
            message.textContent = "Не удалось сохранить данные в браузере.";
            return;
        }

        form.reset();
        message.textContent = "Готово, " + name + "! Данные сохранены в этом браузере.";
        updateButton();

        setTimeout(closeModal, 1200);
    });

    updateButton();
}


// ================================
// ИНТЕРФЕЙС ДЛЯ БЛОКА «СООБЩИТЬ О ПРЕПЯТСТВИИ» (curb-model.js)
// ================================

window.RouteApp = {
    obstacleTypes: OBSTACLE_TYPES,
    parseCoordinates: parseCoordinates,
    formatCoordinates: formatCoordinates,
    addObstacle: addObstacle,
    removeObstacle: removeObstacle,
    getObstacles: function () { return obstacles.slice(); },
    onChange: function (listener) { changeListeners.push(listener); },

    // Следующий клик по карте вернёт координаты в callback
    requestMapPick: function (callback) {
        if (!map) {
            return false;
        }

        pickCallback = callback;
        return true;
    },

    cancelMapPick: function () {
        pickCallback = null;
    }
};


// ================================
// ЗАПУСК
// ================================

function startApplication() {
    try {
        initMap();
    } catch (error) {
        console.error("Не удалось создать карту:", error);
        showMessage("Не удалось создать карту. Проверьте API-ключ Яндекс Карт.", "error");
    }

    setupForm();
    setupCityChange();
}

loadObstacles();
setupAuth();
loadSharedObstacles();

if (typeof ymaps !== "undefined") {
    ymaps.ready(startApplication);
} else {
    console.error("Яндекс Карты API не загрузился.");
    showMessage("Не удалось загрузить Яндекс Карты. Проверьте API-ключ и интернет.", "error");
    setupForm();
    setupCityChange();
}
