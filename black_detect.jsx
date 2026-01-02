var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  throw new Error("Активная композиция не выбрана");
}

var selectedLayers = comp.selectedLayers;
if (selectedLayers.length === 0) {
  throw new Error("Не выбрано ни одного слоя");
}

var ffmpeg_path = "ffmpeg"; // или полный путь

app.beginUndoGroup("Black markers");

for (var i = 0; i < selectedLayers.length; i++) {
  var layer = selectedLayers[i];
  
  // Проверяем, что слой имеет источник файла
  if (!(layer.source instanceof FootageItem)) {
    continue;
  }
  
  var footageItem = layer.source;
  if (!footageItem.file) {
    continue;
  }
  
  var video_file = footageItem.file;
  var log_file = File(video_file.parent.fsName + "/black_" + i + ".txt");

  var command =
    "\"" + ffmpeg_path + "\" -i \"" + video_file.fsName + "\"" +
    " -vf blackdetect=d=0:pic_th=0.98:pix_th=0.10 -an -f null - 2> \"" +
    log_file.fsName + "\"";

  system.callSystem(command);

  // ---- парсинг результата ----

  if (!log_file.exists) {
    continue;
  }

  log_file.open("r");
  var text = log_file.read();
  log_file.close();

  var regex = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  var match;

  while ((match = regex.exec(text)) !== null) {
    layer.markerProperty.setValueAtTime(
      parseFloat(match[1]),
      new MarkerValue("BLACK START")
    );
    layer.markerProperty.setValueAtTime(
      parseFloat(match[2]),
      new MarkerValue("BLACK END")
    );
  }
}

app.endUndoGroup();
