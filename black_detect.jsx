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

  // Вычисляем границы видимой части слоя относительно начала файла
  // layer.startTime - время начала источника относительно начала композиции
  // layer.inPoint - время начала видимой части слоя в композиции
  // layer.outPoint - время конца видимой части слоя в композиции
  var visibleStartInFile = layer.inPoint - layer.startTime;  // Начало видимой части относительно файла
  var visibleEndInFile = layer.outPoint - layer.startTime;   // Конец видимой части относительно файла
  var layerDuration = layer.outPoint - layer.inPoint;        // Длительность видимой части

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

  // Формируем параметры для обработки только видимой части видео
  // -ss указывает начальную точку, -t указывает длительность
  // Всегда добавляем параметры для ускорения работы (даже если слой не обрезан, это не повредит)
  var ffmpeg_ss_param = " -ss " + visibleStartInFile.toFixed(6);
  var ffmpeg_t_param = " -t " + layerDuration.toFixed(6);

  // Создаём bat-файл, который запускает PowerShell команду
  // Это позволяет правильно обработать пути с кириллицей и перенаправление вывода
  var temp_bat = new File(Folder.temp.fsName + "\\black_detect_" + video_name_no_ext + "_" + i + ".bat");
  temp_bat.open("w");
  temp_bat.encoding = "UTF-8";
  temp_bat.write("@chcp 65001 >nul\n");
  temp_bat.write("@echo off\n");
  // Запускаем PowerShell команду с правильным перенаправлением stderr
  // Выводим в консоль и одновременно записываем в файл
  // Обрабатываем только видимую часть видео для ускорения работы
  temp_bat.write("powershell -NoProfile -Command \"& '" + ffmpeg_path_escaped + "'" + ffmpeg_ss_param + " -i '" + video_path_escaped + "'" + ffmpeg_t_param +
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

  // Время из blackdetect при использовании -ss перед -i выводится относительно начала обрабатываемого сегмента
  // То есть относительно начала видимой части, а не относительно начала файла
  // Маркеры на слое в After Effects устанавливаются относительно времени слоя (где 0 = layer.startTime)
  // Видимая часть начинается на времени visibleStartInFile относительно начала слоя
  // Поэтому время маркера на слое = время из blackdetect + visibleStartInFile
  var markersFound = 0;
  var markersSet = 0;
  
  while ((match = regex.exec(text)) !== null) {
    markersFound++;
    var startTime = parseFloat(match[1]);  // Время относительно начала видимой части (из-за -ss)
    var endTime = parseFloat(match[2]);    // Время относительно начала видимой части (из-за -ss)

    // Проверяем, что маркеры попадают в диапазон видимой части
    if (startTime >= 0 && startTime <= layerDuration && endTime >= 0 && endTime <= layerDuration && endTime > startTime) {
      // Преобразуем время в время относительно начала слоя
      // Время маркера на слое = время относительно видимой части + смещение начала видимой части
      var markerStartTime = startTime + visibleStartInFile;
      var markerEndTime = endTime + visibleStartInFile;
      
      try {
        var markerProp = layer.property("Marker");
        if (markerProp) {
          // Маркеры устанавливаются относительно времени слоя (где 0 = layer.startTime)
          markerProp.setValueAtTime(markerStartTime, new MarkerValue("BLACK START"));
          markerProp.setValueAtTime(markerEndTime, new MarkerValue("BLACK END"));
          markersSet++;
        } else {
          alert("Не удалось установить маркеры на слое: " + layer.name);
          break;
        }
      } catch (e2) {
        alert("Ошибка при установке маркера на слое " + layer.name + " в момент " + markerStartTime + ":\n" + e2.toString());
        break;
      }
    }
  }
  
  // Отладочный вывод через alert
  if (markersFound > 0) {
    alert("Слой: " + layer.name + "\n" +
          "Найдено маркеров: " + markersFound + "\n" +
          "Установлено маркеров: " + markersSet + "\n" +
          "startTime: " + layer.startTime + ", inPoint: " + layer.inPoint + ", outPoint: " + layer.outPoint + "\n" +
          "visibleStartInFile: " + visibleStartInFile + ", visibleEndInFile: " + visibleEndInFile + "\n" +
          "layerDuration: " + layerDuration);
  }

  // Удаляем лог-файл после обработки
  if (log_file.exists) {
    log_file.remove();
  }
}

app.endUndoGroup();
