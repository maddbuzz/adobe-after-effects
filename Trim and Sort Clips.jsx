(function () {
  const script_fullpath = $.fileName;
  const script_filename = File(script_fullpath).name;

  var message =
    "Это скрипт\n\n" +
    script_filename + "\n\n" +
    "Контролы на слое 'script_controls' (в порядке применения):\n\n" +
    "Перемешивание:\n" +
    "• shuffle_layers - перемешать слои случайным образом (работает независимо от сортировки)\n\n" +
    "Сортировка (определяет порядок слоев в панели слоев - какие будут ниже/выше, каскадная):\n" +
    "• sort_by_layers_relative_offsets_in_files - сначала по относительному положению слоя в исходном файле (0..1 в диапазоне min..max использования)\n" +
    "• sort_by_source_name - затем по имени исходного файла (алфавитно, если смещения одинаковые или сортировка по смещению выключена)\n" +
    "• sort_by_layers_starts_in_sources - затем по смещению начал слоев внутри их файлов (если имена одинаковые или сортировка по имени выключена)\n" +
    "• sort_by_layer_duration - затем по текущей длительности на таймлайне (если все предыдущие критерии одинаковые)\n" +
    "• reverse_sort_order - обратить итоговый порядок сортировки\n\n" +
    "Масштабирование:\n" +
    "• scale_to_fit_comp - масштабировать видеослои для вписывания в размер композиции\n\n" +
    "Обрезка И/ИЛИ Упорядочивание на таймлайне (раньше/позже по времени):\n" +
    "• trim_clips - обрезать клипы и разместить их последовательно на таймлайне\n" +
    "  (если выключен - только разместить последовательно без обрезки)\n" +
    "• trim_start_seconds - обрезать начало каждого слоя (секунды)\n" +
    "• trim_end_seconds - обрезать конец каждого слоя (секунды)\n" +
    "  (trim_start_seconds и trim_end_seconds применяются при включенном trim_clips, обрезка с учётом Time Stretch на слое)\n\n" +
    "Хотите продолжить?";
  var proceed = confirm(message);
  if (!proceed) return;

  app.beginUndoGroup(script_filename);

  var composition = app.project.activeItem;
  if (!(composition && composition instanceof CompItem)) {
    alert("Активируйте композицию перед запуском.");
    return;
  }

  var control_layer_name = "script_controls";
  var control_layer = null;

  for (var i = 1; i <= composition.numLayers; i++) {
    if (composition.layer(i).name === control_layer_name) {
      control_layer = composition.layer(i);
      break;
    }
  }

  if (!control_layer) {
    control_layer = composition.layers.addSolid(
      [0, 0, 0],
      control_layer_name,
      composition.width,
      composition.height,
      composition.pixelAspect,
      composition.duration
    );
  } else {
    // Проверяем, совпадает ли размер солида с размером композиции
    if (control_layer.source.width !== composition.width ||
      control_layer.source.height !== composition.height) {
      // Масштабируем слой, чтобы он соответствовал размеру композиции
      var scale_x = (composition.width / control_layer.source.width) * 100;
      var scale_y = (composition.height / control_layer.source.height) * 100;
      control_layer.property("Scale").setValue([scale_x, scale_y]);
      control_layer.property("Position").setValue([composition.width / 2, composition.height / 2]);
    }
  }
  control_layer.guideLayer = false;
  control_layer.enabled = true; // включаем видимость (глазик)

  function create_control_if_not_exists(layer, control_name, type, default_value) {
    var effects = layer.property("Effects");
    if (!effects.property(control_name)) {
      var adbe_type = "ADBE " + type + " Control";
      var new_effect = effects.addProperty(adbe_type);
      new_effect.name = control_name;
      new_effect.property(type).setValue(default_value);
    }
  }

  function get_control(layer, control_name, type) {
    var effects = layer.property("Effects");
    var effect = effects.property(control_name);
    if (!effect) throw "Effect " + control_name + " not found!";
    return effect.property(type);
  }

  create_control_if_not_exists(control_layer, "shuffle_layers", "Checkbox", true);
  create_control_if_not_exists(control_layer, "sort_by_layers_relative_offsets_in_files", "Checkbox", true);
  create_control_if_not_exists(control_layer, "sort_by_source_name", "Checkbox", false);
  create_control_if_not_exists(control_layer, "sort_by_layers_starts_in_sources", "Checkbox", false);
  create_control_if_not_exists(control_layer, "sort_by_layer_duration", "Checkbox", false);
  create_control_if_not_exists(control_layer, "reverse_sort_order", "Checkbox", false);
  create_control_if_not_exists(control_layer, "scale_to_fit_comp", "Checkbox", true);
  create_control_if_not_exists(control_layer, "trim_clips", "Checkbox", false);
  create_control_if_not_exists(control_layer, "trim_start_seconds", "Slider", 1);
  create_control_if_not_exists(control_layer, "trim_end_seconds", "Slider", 4);

  const shuffle_layers = get_control(control_layer, "shuffle_layers", "Checkbox").value;
  const sort_by_layers_relative_offsets_in_files = get_control(control_layer, "sort_by_layers_relative_offsets_in_files", "Checkbox").value;
  const sort_by_source_name = get_control(control_layer, "sort_by_source_name", "Checkbox").value;
  const sort_by_layers_starts_in_sources = get_control(control_layer, "sort_by_layers_starts_in_sources", "Checkbox").value;
  const sort_by_layer_duration = get_control(control_layer, "sort_by_layer_duration", "Checkbox").value;
  const reverse_sort_order = get_control(control_layer, "reverse_sort_order", "Checkbox").value;
  const scale_to_fit_comp = get_control(control_layer, "scale_to_fit_comp", "Checkbox").value;
  const trim_clips = get_control(control_layer, "trim_clips", "Checkbox").value;
  const trim_start_seconds = get_control(control_layer, "trim_start_seconds", "Slider").value;
  const trim_end_seconds = get_control(control_layer, "trim_end_seconds", "Slider").value;

  var target_layers = [];
  for (var i = 1; i <= composition.numLayers; i++) {
    var layer = composition.layer(i);
    if (
      layer instanceof AVLayer &&
      !layer.guideLayer &&
      layer.name !== control_layer_name &&
      (layer.hasVideo || layer.hasAudio)
    ) {
      target_layers.push(layer);
    }
  }

  if (target_layers.length === 0) {
    alert("Нет подходящих слоёв (видео или аудио).");
    return;
  }

  // Находим для каждого медиафайла диапазон использования: min = начало первого слоя в этом файле, max = конец последнего слоя в этом файле
  var sources_ranges = {}; // { [source_key]: { min: number, max: number } }
  for (var i = 0; i < target_layers.length; i++) {
    var layer = target_layers[i];
    var source_key = layer.source.name; // используем имя файла как ключ
    var layer_start_in_source = layer.inPoint - layer.startTime;
    var layer_end_in_source = layer.outPoint - layer.startTime;
    if (!sources_ranges[source_key]) sources_ranges[source_key] = { min: layer_start_in_source, max: layer_end_in_source };
    if (layer_start_in_source < sources_ranges[source_key].min) sources_ranges[source_key].min = layer_start_in_source;
    if (layer_end_in_source > sources_ranges[source_key].max) sources_ranges[source_key].max = layer_end_in_source;
  }

  // Перемешивание слоев (если включено)
  if (shuffle_layers) {
    for (var i = target_layers.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = target_layers[i];
      target_layers[i] = target_layers[j];
      target_layers[j] = temp;
    }
  }

  if (sort_by_source_name || sort_by_layer_duration || sort_by_layers_starts_in_sources || sort_by_layers_relative_offsets_in_files) {
    target_layers.sort(function (layer_a, layer_b) {
      var result = 0;

      // Сортировка по относительному смещению слоя внутри диапазона [0, 1] по исходному файлу (если включена)
      if (sort_by_layers_relative_offsets_in_files) {
        var range_a = sources_ranges[layer_a.source.name];
        var range_b = sources_ranges[layer_b.source.name];
        var current_a = layer_a.inPoint - layer_a.startTime;
        var current_b = layer_b.inPoint - layer_b.startTime;
        var relative_a = (current_a - range_a.min) / (range_a.max - range_a.min);
        var relative_b = (current_b - range_b.min) / (range_b.max - range_b.min);
        if (relative_a < relative_b) result = -1;
        if (relative_a > relative_b) result = +1;
      }

      // Сортировка по имени (если включена и смещения одинаковые)
      if (result === 0 && sort_by_source_name) {
        var name_a = layer_a.source.name.toLowerCase();
        var name_b = layer_b.source.name.toLowerCase();
        if (name_a < name_b) result = -1;
        if (name_a > name_b) result = +1;
      }

      // Вторичная сортировка: если имена одинаковые (или сортировка по имени не включена), применяем сортировку по смещению и/или по длительности
      if (result === 0) {
        if (sort_by_layers_starts_in_sources) { // сортируем по смещению начал слоев внутри их файлов
          // inPoint - время начала видимой части слоя на таймлайне композиции
          // startTime - время начала слоя на таймлайне композиции
          // Разница дает смещение начала видимой части внутри исходного файла
          var offset_a = layer_a.inPoint - layer_a.startTime;
          var offset_b = layer_b.inPoint - layer_b.startTime;
          if (offset_a < offset_b) result = -1;
          if (offset_a > offset_b) result = +1;
        }
        if (result === 0 && sort_by_layer_duration) { // если смещения одинаковые (или сортировка по смещению не включена), сортируем по длительности слоя
          var duration_a = layer_a.outPoint - layer_a.inPoint;
          var duration_b = layer_b.outPoint - layer_b.inPoint;
          if (duration_a < duration_b) result = -1;
          if (duration_a > duration_b) result = +1;
        }
      }

      if (reverse_sort_order) return -result;
      return result;
    });
  }

  var current_time = 0;

  for (var i = 0; i < target_layers.length; i++) {
    var current_layer = target_layers[i];

    // Масштабирование: вписать целиком в композицию, сохранив пропорции
    if (scale_to_fit_comp && current_layer.hasVideo) {
      var src_width = current_layer.source.width;
      var src_height = current_layer.source.height;
      var comp_width = composition.width;
      var comp_height = composition.height;
      var scale_x = (comp_width / src_width) * 100;
      var scale_y = (comp_height / src_height) * 100;
      var uniform_scale = Math.min(scale_x, scale_y);
      current_layer.property("Scale").setValue([uniform_scale, uniform_scale]);
    }

    if (trim_clips) {
      // Вариант 1: source.duration - исходная длительность файла, НЕ учитывает Time Stretch
      //   (если файл 10 сек, а Time Stretch = 200%, вернет 10 сек вместо 20)
      // var source_duration = current_layer.source.duration;

      // Вариант 2: outPoint - inPoint - видимая длительность на таймлайне, учитывает Time Stretch
      //   ПРОБЛЕМА: при повторных запусках обрезка применяется к уже обрезанному слою снова и снова
      // var source_duration = current_layer.outPoint - current_layer.inPoint;

      // Вариант 3 (используется): расчет от исходной длительности с учетом Time Stretch
      //   Всегда работает с исходной длительностью файла, не зависит от предыдущих запусков
      var source_duration = current_layer.source.duration * current_layer.stretch / 100;

      var source_in_time = trim_start_seconds;
      var source_out_time = source_duration - trim_end_seconds;
      if (source_out_time < source_in_time) source_out_time = source_in_time;

      var trimmed_duration = source_out_time - source_in_time;
      current_layer.startTime = current_time - source_in_time;
      current_layer.inPoint = current_time;
      current_layer.outPoint = current_time + trimmed_duration;
      current_time += trimmed_duration;
    } else {
      // только упорядочивание — сохраняем текущую длину и локальный оффсет
      var layer_length = current_layer.outPoint - current_layer.inPoint;
      var local_offset = current_layer.inPoint - current_layer.startTime;

      current_layer.startTime = current_time - local_offset;
      current_layer.inPoint = current_time;
      current_layer.outPoint = current_time + layer_length;

      current_time += layer_length;
    }

    current_layer.moveToBeginning(); // если хотим чтобы наш непрозрачный солид оказался снизу (А МЫ ХОТИМ!)
    // current_layer.moveToEnd();
  }

  composition.duration = current_time;
  composition.workAreaStart = 0;
  composition.workAreaDuration = current_time - 1 / composition.frameRate;
  control_layer.inPoint = 0;
  control_layer.outPoint = current_time;

  // gather stats
  var durations = [];
  for (var i = 1; i <= composition.numLayers; i++) {
    var layer = composition.layer(i);
    if (
      layer instanceof AVLayer &&
      !layer.guideLayer &&
      layer.name !== control_layer_name &&
      (layer.hasVideo || layer.hasAudio)
    ) {
      var trimmed_duration = layer.outPoint - layer.inPoint;
      durations.push(trimmed_duration);
    }
  }
  // show stats
  var min_duration = durations[0];
  var max_duration = durations[0];
  var sum_duration = 0;
  for (var i = 0; i < durations.length; i++) {
    var dur = durations[i];
    if (dur < min_duration) min_duration = dur;
    if (dur > max_duration) max_duration = dur;
    sum_duration += dur;
  }
  var avg_duration = sum_duration / durations.length;
  var stats_message =
    "Статистика длительности слоев:\n\n" +
    "Количество слоев: " + durations.length + "\n" +
    "Минимальная длительность: " + min_duration.toFixed(3) + " сек\n" +
    "Средняя длительность: " + avg_duration.toFixed(3) + " сек\n" +
    "Максимальная длительность: " + max_duration.toFixed(3) + " сек\n" +
    "Суммарная длительность: " + sum_duration.toFixed(3) + " сек";
  alert(stats_message);

  app.endUndoGroup();
})();
