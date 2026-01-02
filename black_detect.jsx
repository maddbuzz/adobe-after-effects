var FFMPEG_PATH = "E:\\_Downloads_\\ffmpeg-2025-12-10-git-4f947880bd-full_build\\bin\\ffmpeg.exe";

var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  throw new Error("Активная композиция не выбрана");
}

var selectedLayers = comp.selectedLayers;
if (selectedLayers.length === 0) {
  throw new Error("Не выбрано ни одного слоя");
}

app.beginUndoGroup("Black markers");

for (var i = 0; i < selectedLayers.length; i++) {
  var layer = selectedLayers[i];

  // Проверяем, что слой имеет источник файла
  if (!(layer.source instanceof FootageItem)) {
    continue;
  }

  var footageItem = layer.source;
  if (!footageItem || !footageItem.file) {
    continue;
  }

  var video_file = footageItem.file;

  // Проверяем существование файла
  video_file = new File(video_file.fsName);
  if (!video_file.exists) {
    alert("Файл не найден: " + video_file.fsName + "\nСлой: " + layer.name);
    continue;
  }

  // Получаем пути к файлам
  var video_path = video_file.fsName;
  // Получаем имя файла без расширения для имени лог-файла
  var video_name = video_file.name;
  var video_name_no_ext = video_name.substring(0, video_name.lastIndexOf(".")) || video_name;
  var log_file = new File(video_file.parent.fsName + "\\" + video_name_no_ext + ".ffmpeg.log");
  var log_file_path = log_file.fsName;

  // Экранируем пути для использования в PowerShell команде
  var ffmpeg_path_escaped = FFMPEG_PATH.replace(/'/g, "''");
  var video_path_escaped = video_path.replace(/'/g, "''");
  var log_file_path_escaped = log_file_path.replace(/'/g, "''");

  // Создаём bat-файл, который запускает PowerShell команду
  // Это позволяет правильно обработать пути с кириллицей и перенаправление вывода
  var temp_bat = new File(Folder.temp.fsName + "\\black_detect_" + video_name_no_ext + "_" + i + ".bat");
  temp_bat.open("w");
  temp_bat.encoding = "UTF-8";
  temp_bat.write("@chcp 65001 >nul\n");
  temp_bat.write("@echo off\n");
  // Запускаем PowerShell команду с правильным перенаправлением stderr
  // Выводим в консоль и одновременно записываем в файл
  temp_bat.write("powershell -NoProfile -Command \"& '" + ffmpeg_path_escaped + "' -i '" + video_path_escaped + "'" +
    " -vf blackdetect=d=0:pic_th=0.98:pix_th=0.10 -an -f null - *>&1 | " +
    "ForEach-Object { Write-Host $_; $_ } | Out-File -FilePath '" + log_file_path_escaped + "' -Encoding UTF8\"\n");
  temp_bat.close();

  system.callSystem("cmd /c \"" + temp_bat.fsName + "\"");

  // Удаляем временный bat-файл
  if (temp_bat.exists) {
    temp_bat.remove();
  }

  // Небольшая задержка для записи файла на диск
  $.sleep(1000);

  // ---- парсинг результата ----

  if (!log_file.exists) {
    alert("Лог-файл не создан: " + log_file_path);
    continue;
  }

  // Проверяем размер файла
  if (log_file.length === 0) {
    alert("Лог-файл пустой: " + log_file_path);
    continue;
  }

  log_file.open("r");
  var text = log_file.read();
  log_file.close();

  var regex = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  var match;

  while ((match = regex.exec(text)) !== null) {
    var startTime = parseFloat(match[1]);
    var endTime = parseFloat(match[2]);

    // Устанавливаем маркеры на слое
    try {
      var markerProp = layer.property("Marker");
      if (markerProp) {
        markerProp.setValueAtTime(startTime, new MarkerValue("BLACK START"));
        markerProp.setValueAtTime(endTime, new MarkerValue("BLACK END"));
      } else {
        alert("Не удалось установить маркеры на слое: " + layer.name + "\nОшибка: " + e.toString());
        break;
      }
    } catch (e2) {
      alert("Ошибка при установке маркера на слое " + layer.name + " в момент " + startTime + ":\n" + e.toString() + "\n" + e2.toString());
      break;
    }
  }

  // Удаляем лог-файл после обработки
  if (log_file.exists) {
    log_file.remove();
  }
}

app.endUndoGroup();
