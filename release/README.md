# MGLOTEK: Download games from GitHub Releases

Все будущие игровые ZIP-пакеты МГЛОТЕКА публикуются на https://github.com/kivnufki121-dot/ArcEngine/releases .

**Важное ограничение:** текущие старые игровые ZIP (v1.0.1 и более ранние) ещё не загружены в GitHub. Этот workflow создаёт релиз ТОЛЬКО после того, как реальный пакет попадёт в артефакт \`MGLOTEK-Game-Windows\` успешного запуска GitHub Actions в ветке \`mglotek-cloud-render\`. Простая проверка кода не создаёт фиктивный релиз.

## Порядок
1. Собрать ZIP Windows с \`main.py\`, \`start_windows.bat\`, \`requirements.txt\`, а также нужными ассетами.
2. Опубликовать ZIP как файл внутри GitHub Actions artifact с **точным именем** \`MGLOTEK-Game-Windows\`. Сохранить ID успешного Actions-run.
3. Изменить \`release/request.json\` в ветке \`mglotek-cloud-render\`:
   \`{"mode":"publish","version":"1.0.2","source_run":"123456789"}\`.
4. GitHub Actions workflow \`MGLOTEK - Publish Windows game to GitHub Releases\` проверяет целостность ZIP, наличие Windows запускателя и отсутствие пользовательского сохранения, сверяет исходный Actions-run, публикует Release и файл SHA256SUMS.txt.
5. Выдать пользователю ссылку \`https://github.com/kivnufki121-dot/ArcEngine/releases/tag/mglotek-v1.0.2\` **только после подтверждения, что релиз действительно создан**.

Репозиторий ArcEngine/main не меняется: исходный код моста и издательской логики находится в отдельной ветке. Создаваемые Releases относятся к репозиторию в целом; у них собственные версии и стабильные URL. Не публиковать сторонние бинарники, скачанные из непроверенных источников.


## Прямая загрузка из GitHub Issue

Если файл игры создан вне GitHub Actions, прикрепите проверенный ZIP к issue в этом репозитории. Скопируйте URL вида `https://github.com/user-attachments/files/12345/MGLOTEK_v1.0.1.zip`. В `release/request.json` установите `mode=publish`, `version=1.0.1`, `source_url` и точную SHA-256 ZIP. GitHub Actions скачает прикреплённый архив, сверит контрольную сумму, проверит обязательные файлы и опубликует GitHub Release. Эта процедура не требует локальной установки Blender, Git или Python, но исходный ZIP нужно один раз прикрепить к GitHub через браузер. Не публикуйте персональные сохранения.
