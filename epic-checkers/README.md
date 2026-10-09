# EPIC ШАШКИ

Шашки для Android: 10 вариантов правил (турецкие, русские, международные 10×10, английские/чекерс,
бразильские, пул, итальянские, канадские 12×12, испанские, чешские) + режим «поддавки» для любого из них.
Игра против ИИ (5 уровней), вдвоём на одном телефоне и «Битва ИИ». Особый **EPIC BADASS MODE** —
аниме-эффекты на каждом ходу и хвастовство; классический режим — спокойная деревянная доска.

## Скачать

APK: [`release/EpicCheckers.apk`](release/EpicCheckers.apk) (≈3 МБ, Android 7.0+).
При установке Android попросит разрешить установку из неизвестного источника.

> Статус: **предварительная сборка**. Работает полностью, но по итогам QA есть список доработок
> (в основном наслоение надписей в эпик-режиме, формулировки, мелкие улучшения ИИ) —
> см. [`docs/QA-FINDINGS.md`](docs/QA-FINDINGS.md). Ошибок в правилах не найдено.

## Сборка

Нужны Node 22, JDK 17+, а также `aapt`, `dalvik-exchange`, `zipalign`, `apksigner` (пакеты Debian/Ubuntu)
и `android.jar` API 34 по пути `/opt/android-jars/android-34-reginer.jar` (см. `tools/build-apk.sh`).

```bash
npm ci
npm test            # юнит-тесты движка, ИИ, рендера, эффектов, UI, звука
npm run build       # web-бандл (dist/www) + APK (dist/EpicCheckers.apk)
npm run e2e:quick   # сквозные тесты в headless Chromium
```

Ключ подписи `android/keystore/epic-checkers.jks` (пароль `epicbadass`) лежит в репозитории намеренно —
это хобби-проект, так обновления ставятся поверх старой версии.

## Устройство

HTML5/WebGL-игра (PixiJS v8 + pixi-filters, процедурный звук на WebAudio) в нативной WebView-оболочке
без AndroidX. Архитектура и контракты модулей — в [`ARCHITECTURE.md`](ARCHITECTURE.md).
