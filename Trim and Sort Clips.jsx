(function () {
  const script_fullpath = $.fileName;
  const script_filename = File(script_fullpath).name;

  var message =
    "Это скрипт\n\n" +
    script_filename + "\n\n" +
    "(trim_start и trim_end применяются после Time Stretch)\n\n" +
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

  create_control_if_not_exists(control_layer, "just_order_dont_trim", "Checkbox", true);
  create_control_if_not_exists(control_layer, "sort_by_name", "Checkbox", false);
  create_control_if_not_exists(control_layer, "sort_by_size", "Checkbox", false);
  create_control_if_not_exists(control_layer, "reverse_order", "Checkbox", false);
  create_control_if_not_exists(control_layer, "rescale_to_fit", "Checkbox", true);
  create_control_if_not_exists(control_layer, "trim_start", "Slider", 1);
  create_control_if_not_exists(control_layer, "trim_end", "Slider", 4);

  const just_order_dont_trim = get_control(control_layer, "just_order_dont_trim", "Checkbox").value;
  const sort_by_name = get_control(control_layer, "sort_by_name", "Checkbox").value;
  const sort_by_size = get_control(control_layer, "sort_by_size", "Checkbox").value;
  const reverse_order = get_control(control_layer, "reverse_order", "Checkbox").value;
  const rescale_to_fit = get_control(control_layer, "rescale_to_fit", "Checkbox").value;
  const trim_start = get_control(control_layer, "trim_start", "Slider").value;
  const trim_end = get_control(control_layer, "trim_end", "Slider").value;

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

  if (sort_by_name || sort_by_size) {
    target_layers.sort(function (layer_a, layer_b) {
      var result = 0;
      
      // Сортировка по имени (если включена)
      if (sort_by_name) {
        var name_a = layer_a.source.name.toLowerCase();
        var name_b = layer_b.source.name.toLowerCase();
        if (name_a < name_b) result = -1;
        if (name_a > name_b) result = +1;
      }
      
      // Если имена одинаковые (или сортировка по имени не включена), сортируем по размеру
      if (result === 0 && sort_by_size) {
        var duration_a = layer_a.source.duration * layer_a.stretch / 100;
        var duration_b = layer_b.source.duration * layer_b.stretch / 100;
        if (duration_a < duration_b) result = -1;
        if (duration_a > duration_b) result = +1;
      }
      
      if (reverse_order) return -result;
      return result;
    });
  }

  var current_time = 0;

  for (var i = 0; i < target_layers.length; i++) {
    var current_layer = target_layers[i];

    // Масштабирование: вписать целиком в композицию, сохранив пропорции
    if (rescale_to_fit) {
      var src_width = current_layer.source.width;
      var src_height = current_layer.source.height;
      var comp_width = composition.width;
      var comp_height = composition.height;
      var scale_x = (comp_width / src_width) * 100;
      var scale_y = (comp_height / src_height) * 100;
      var uniform_scale = Math.min(scale_x, scale_y);
      current_layer.property("Scale").setValue([uniform_scale, uniform_scale]);
    };

    if (!just_order_dont_trim) {
      // var source_duration = current_layer.source.duration; // не учитывает Time Stretch
      // var source_duration = current_layer.outPoint - current_layer.inPoint; // учитывает Time Stretch, но отрезать будет снова и снова при повторных запусках
      var source_duration = current_layer.source.duration * current_layer.stretch / 100; // учитывает Time Stretch, но ?

      var source_in_time = trim_start;
      var source_out_time = source_duration - trim_end;
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
