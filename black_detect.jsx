var FFMPEG_PATH = "E:\\_Downloads_\\ffmpeg-2025-12-10-git-4f947880bd-full_build\\bin\\ffmpeg.exe";

// Проверка существования FFmpeg
var ffmpegFile = new File(FFMPEG_PATH);
if (!ffmpegFile.exists) {
  throw new Error("FFmpeg не найден по пути: " + FFMPEG_PATH);
}

var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  throw new Error("Активная композиция не выбрана");
}

var selectedLayers = comp.selectedLayers;
if (selectedLayers.length === 0) {
  throw new Error("Не выбрано ни одного слоя");
}

// Статистика
var processedSegments = 0;
var totalDuration = 0;
var blackStartMarkers = 0;
var blackEndMarkers = 0;

app.beginUndoGroup("Black markers");

for (var i = 0; i < selectedLayers.length; i++) {
  var layer = selectedLayers[i];

  if (!(layer.source instanceof FootageItem)) {
    continue;
  }

  var footageItem = layer.source;
  if (!footageItem || !footageItem.file) {
    continue;
  }

  var video_file = footageItem.file;
  video_file = new File(video_file.fsName);
  if (!video_file.exists) {
    alert("Файл не найден: " + video_file.fsName + "\nСлой: " + layer.name);
    continue;
  }

  var visibleStartInFile = layer.inPoint - layer.startTime;
  var visibleEndInFile = layer.outPoint - layer.startTime;
  var layerDuration = layer.outPoint - layer.inPoint;

  var video_path = video_file.fsName;
  var video_name = video_file.name;
  var video_name_no_ext = video_name.substring(0, video_name.lastIndexOf(".")) || video_name;
  var log_file = new File(video_file.parent.fsName + "\\" + video_name_no_ext + ".ffmpeg.log");
  var log_file_path = log_file.fsName;

  var ffmpeg_path_escaped = FFMPEG_PATH.replace(/'/g, "''");
  var video_path_escaped = video_path.replace(/'/g, "''");
  var log_file_path_escaped = log_file_path.replace(/'/g, "''");

  var ffmpeg_ss_param = " -ss " + visibleStartInFile.toFixed(6);
  var ffmpeg_t_param = " -t " + layerDuration.toFixed(6);

  var temp_bat = new File(Folder.temp.fsName + "\\black_detect_" + video_name_no_ext + "_" + i + ".bat");
  temp_bat.open("w");
  temp_bat.encoding = "UTF-8";
  temp_bat.write("@chcp 65001 >nul\n");
  temp_bat.write("@echo off\n");
  temp_bat.write("powershell -NoProfile -Command \"& '" + ffmpeg_path_escaped + "'" + ffmpeg_ss_param + " -i '" + video_path_escaped + "'" + ffmpeg_t_param +
    " -vf blackdetect=d=0:pic_th=0.98:pix_th=0.10 -an -f null - *>&1 | " +
    "ForEach-Object { Write-Host $_; $_ } | Out-File -FilePath '" + log_file_path_escaped + "' -Encoding UTF8\"\n");
  temp_bat.close();

  system.callSystem("cmd /c \"" + temp_bat.fsName + "\"");

  if (temp_bat.exists) {
    temp_bat.remove();
  }

  $.sleep(1000);

  if (!log_file.exists) {
    alert("Лог-файл не создан: " + log_file_path);
    continue;
  }

  if (log_file.length === 0) {
    alert("Лог-файл пустой: " + log_file_path);
    continue;
  }

  // Участок успешно обработан ffmpeg
  processedSegments++;
  totalDuration += layerDuration;

  log_file.open("r");
  var text = log_file.read();
  log_file.close();

  var regex = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  var match;

  while ((match = regex.exec(text)) !== null) {
    var startTime = parseFloat(match[1]);
    var endTime = parseFloat(match[2]);

    if (startTime >= 0 && startTime <= layerDuration && endTime >= 0 && endTime <= layerDuration && endTime > startTime) {
      var markerStartTime = layer.inPoint + startTime;
      var markerEndTime = layer.inPoint + endTime;

      try {
        var markerProp = layer.property("Marker");
        if (markerProp) {
          markerProp.setValueAtTime(markerStartTime, new MarkerValue("BLACK START"));
          blackStartMarkers++;
          markerProp.setValueAtTime(markerEndTime, new MarkerValue("BLACK END"));
          blackEndMarkers++;
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

  if (log_file.exists) {
    log_file.remove();
  }
}

app.endUndoGroup();

// Вывод статистики
var statsMessage = "Статистика обработки:\n\n";
statsMessage += "Выбрано слоев пользователем: " + selectedLayers.length + "\n";
statsMessage += "Обработано участков FFmpeg: " + processedSegments + "\n";
statsMessage += "Общая длительность участков: " + totalDuration.toFixed(3) + " сек (" + formatTime(totalDuration) + ")\n";
statsMessage += "Создано маркеров BLACK_START: " + blackStartMarkers + "\n";
statsMessage += "Создано маркеров BLACK_END: " + blackEndMarkers;
alert(statsMessage);

// Функция форматирования времени
function formatTime(seconds) {
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var secs = Math.floor(seconds % 60);
  var ms = Math.floor((seconds % 1) * 1000);
  
  var result = "";
  if (hours > 0) {
    result += hours + "ч ";
  }
  if (minutes > 0 || hours > 0) {
    result += minutes + "м ";
  }
  result += secs + "с";
  if (ms > 0) {
    result += " " + ms + "мс";
  }
  return result;
}
