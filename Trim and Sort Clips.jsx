(function () {
  const script_fullpath = $.fileName;
  const script_filename = File(script_fullpath).name;

  var message =
    "Этот скрипт\n\n" +
    script_filename + "\n\n" +
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
    control_layer.guideLayer = true;
  }
  control_layer.enabled = false; // отключаем видимость (глазик)

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
  create_control_if_not_exists(control_layer, "reverse_order", "Checkbox", false);
  create_control_if_not_exists(control_layer, "trim_start", "Slider", 1);
  create_control_if_not_exists(control_layer, "trim_end", "Slider", 4);

  var reverse_order = get_control(control_layer, "reverse_order", "Checkbox").value;
  var just_order_dont_trim = get_control(control_layer, "just_order_dont_trim", "Checkbox").value;
  var sort_by_name = get_control(control_layer, "sort_by_name", "Checkbox").value;
  var trim_start = get_control(control_layer, "trim_start", "Slider").value;
  var trim_end = get_control(control_layer, "trim_end", "Slider").value;

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

  if (sort_by_name) target_layers.sort(function (layer_a, layer_b) {
    var name_a = layer_a.source.name.toLowerCase();
    var name_b = layer_b.source.name.toLowerCase();
    var result = 0;
    if (name_a < name_b) result = -1;
    if (name_a > name_b) result = +1;
    if (reverse_order) return -result;
    return result;
  });

  var current_time = 0;

  for (var i = 0; i < target_layers.length; i++) {
    var current_layer = target_layers[i];

    // Масштабирование: вписать целиком в композицию, сохранив пропорции
    try {
      var src_width = current_layer.source.width;
      var src_height = current_layer.source.height;
      var comp_width = composition.width;
      var comp_height = composition.height;
      var scale_x = (comp_width / src_width) * 100;
      var scale_y = (comp_height / src_height) * 100;
      var uniform_scale = Math.min(scale_x, scale_y);
      current_layer.property("Scale").setValue([uniform_scale, uniform_scale]);
    } catch (_) { }

    if (!just_order_dont_trim) {
      var source_duration = current_layer.source.duration;
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

    // current_layer.moveToBeginning();
    current_layer.moveToEnd();
  }

  composition.duration = current_time;
  composition.workAreaStart = 0;
  composition.workAreaDuration = current_time - 1 / composition.frameRate;

  app.endUndoGroup();
})();
