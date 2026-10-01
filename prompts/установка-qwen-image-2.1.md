# Промт: установка Qwen-Image-2.1 (локальная сессия Claude Code)

Вставить целиком в Claude Code на компьютере владельца, открытом
в папке клона `no-roman/local-genai-rtx4060`.

---

```
Задача: установить и проверить Qwen-Image-2.1 в ComfyUI на этом компьютере
и записать первые замеры со статусом «проверено».

Сначала прочитай CLAUDE.md и HANDOFF.md. Нужные записки — в ветке
claude/eager-curie-uh3nm5 (если она ещё не влита в main — переключись
на неё: git fetch origin && git switch claude/eager-curie-uh3nm5).
Обязательно прочитай docs/01-установка-windows.md
и раздел «Для личного использования» в docs/04-архитектура.md.

Компьютер: Windows, RTX 4060 8 ГБ, 80 ГБ ОЗУ. Системного Python нет
(ComfyUI несёт свой). n8n стоит без Docker — не трогать.

Лицензия Qwen-Image-2.1 — Qwen Research (только исследование и оценка,
некоммерческое). Результаты — только для себя, не для конфигуратора NODE.

## 1. Проверки — до скачивания
- nvidia-smi: видна RTX 4060, 8 ГБ; записать версию драйвера.
- Есть ли ComfyUI (Desktop или портативный)? Если нет — поставить по
  docs/01-установка-windows.md; вариант спроси у меня.
- Версия ComfyUI — не ниже 0.37.0 (в ней Qwen-Image-2.1 поддержан
  без дополнений). Если ниже — обновить и сказать мне.
- Свободно на диске с моделями — не меньше 40 ГБ.

## 2. Модели — официальная сборка Comfy-Org, без сторонних узлов
Скачивать curl.exe (есть в Windows), с докачкой:
  curl.exe -L -C - -o <куда> https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/<путь>

| <путь> в репозитории | папка ComfyUI/models/ | ~размер |
|---|---|---|
| diffusion_models/qwen_image_2.1_int8_convrot.safetensors | diffusion_models/ | 6,8 ГБ |
| text_encoders/qwen3vl_8b_int8_convrot.safetensors | text_encoders/ | 8,7 ГБ |
| text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors | text_encoders/ | 8,8 ГБ |
| vae/qwen_image_2.1_vae_bf16.safetensors | vae/ | 0,6 ГБ |
| model_patches/qwen_image_2.1_fun_controlnet_union_int8_convrot.safetensors | model_patches/ | 3,8 ГБ |

Третий файл — улучшатель запросов; официальный шаблон его подгружает,
хотя по умолчанию он выключен. Последний — ControlNet, для шага 5.
После скачивания сверь размеры файлов с Hugging Face.

## 3. Первый запуск
- Запуск ComfyUI БЕЗ --listen (только 127.0.0.1).
- Шаблоны (Templates) → «Qwen Image 2.1: Text to Image».
  Если шаблона нет — он здесь:
  https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json
- Настройки шаблона не менять: 1024×1024, 25 шагов, cfg 1, euler,
  refine_prompt выключен.
- Запрос: «modern single-storey house with larch plank facade and large
  windows, pine forest, overcast summer day, architectural photography,
  straight verticals».
- Сгенерировать 3 раза: первый — с загрузкой моделей, 2-й и 3-й — рабочие.

## 4. Замеры
- Время — из консоли ComfyUI («Prompt executed in … seconds»), отдельно
  первый запуск и рабочие.
- Пик видеопамяти: во время генерации в отдельном окне
  nvidia-smi --query-gpu=memory.used --format=csv -l 1
- Пик ОЗУ — по диспетчеру задач.
- Повторить на 2048×2048 (родное 2K) — один раз, время и пик памяти.
- Если ошибка про int8 / convrot — не обходи сам; запиши текст ошибки
  и спроси меня. Запасной путь — GGUF (unsloth/Qwen-Image-2.1-GGUF,
  Q6_K) через дополнение ComfyUI-GGUF, но только с моего согласия.

## 5. Правка и ControlNet — если шаг 4 прошёл
- Шаблон «Qwen Image 2.1: Image Edit»: взять получившуюся картинку,
  запрос «same house, white plaster facade, winter evening, warm light
  in windows». Время, держит ли форму дома.
- ControlNet: поищи в шаблонах Qwen Image 2.1 с ControlNet / Fun Union.
  Если есть — прогон по карте глубины из той же картинки. Если нет —
  просто запиши, что шаблона нет.
- Свои виды NODE (E:\NODE\, E:\project\) — только читать; виды
  заказчиков не использовать.

## 6. Что сохранить и записать
- Результаты — в output\личное\ (в git не идут).
- Рабочие процессы — в workflows\: обычный картинка-qwen21-1024.json
  и в API-формате (Workflow → Export (API)) картинка-qwen21-1024.api.json;
  узлам с запросом и seed дать заголовки ЗАПРОС и SEED
  (см. docs/05-автоматизация.md). Строки в таблицу workflows/README.md.
- Цифры — в docs/04-архитектура.md (таблица «Сколько ждать»)
  и docs/02-модели-8гб.md со статусом «проверено»; в строке указать
  разрешение, шаги, версию ComfyUI и драйвера.
- HANDOFF.md — новая запись в конец, ничего не удаляя: версии драйвера
  и ComfyUI, путь к моделям, что сработало, что нет, замеры.
- В git не класть веса, картинки, окружения, ключи (.gitignore).
- Коммит и push в текущую ветку.

## В конце
Коротко мне: работает или нет, время 1024 и 2048, пик видеопамяти и ОЗУ,
что не получилось и что предлагаешь дальше.
```
