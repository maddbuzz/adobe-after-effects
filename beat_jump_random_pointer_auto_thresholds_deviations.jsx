function get_video_clips_start_end_times_in_composition(parent_composition, child_composition_layer_name) {
  var child_composition_layer = parent_composition.layer(child_composition_layer_name);
  if (!child_composition_layer || !(child_composition_layer.source instanceof CompItem)) {
    throw new Error("Указанный слой не является композицией: " + child_composition_layer_name);
  }

  var child_composition = child_composition_layer.source;
  var result = [];

  // for (var layer_index = 1; layer_index <= child_composition.numLayers; layer_index++) {
  for (var layer_index = child_composition.numLayers; layer_index >= 1; layer_index--) {
    var layer = child_composition.layer(layer_index);

    if (layer instanceof AVLayer && layer.source instanceof FootageItem && layer.source.mainSource instanceof FileSource && layer.source.mainSource.file) {  // это именно видеоклип
      var clip_name = layer.name;
      var clip_start_time = Math.max(0, layer.inPoint);
      var clip_end_time = Math.max(0, layer.outPoint);

      result.push({
        // clip_name: clip_name,
        clip_start_time: clip_start_time,
        clip_end_time: clip_end_time,
      });
    }
  }

  return result;
}

// --- инициализация первого окна ---
function compute_forward_window_stats_init(control_property, work_start_time, frame_duration, window_frame_count, total_frames) {
  var sum = 0;
  var min_queue = [];
  var max_queue = [];

  // формируем первое окно
  for (var i = 0; i < Math.min(window_frame_count, total_frames); i++) {
    var v = control_property.valueAtTime(work_start_time + i * frame_duration, false);
    sum += v;

    while (max_queue.length && max_queue[max_queue.length - 1].value <= v) max_queue.pop();
    max_queue.push({ value: v, index: i });

    while (min_queue.length && min_queue[min_queue.length - 1].value >= v) min_queue.pop();
    min_queue.push({ value: v, index: i });
  }

  return {
    sum: sum,
    min_queue: min_queue,
    max_queue: max_queue,
    window_frame_count: window_frame_count,
    work_start_time: work_start_time,
    frame_duration: frame_duration,
    total_frames: total_frames
  };
}

function compute_forward_window_stats_step(state, control_property, frame_index) {
  var window_frame_count = state.window_frame_count;
  var sum = state.sum;
  var min_queue = state.min_queue;
  var max_queue = state.max_queue;
  var work_start_time = state.work_start_time;
  var frame_duration = state.frame_duration;
  var total_frames = state.total_frames;

  var window_start = frame_index;
  var window_end = frame_index + window_frame_count - 1;

  // учитываем неполное окно на конце
  var actual_window_end = Math.min(window_end, total_frames - 1);
  var is_full_window = (actual_window_end - window_start + 1) === window_frame_count;

  if (frame_index > 0 && is_full_window) {
    // вычитаем первый кадр предыдущего окна
    var prev_value = control_property.valueAtTime(work_start_time + (window_start - 1) * frame_duration, false);
    sum -= prev_value;
  }

  if (is_full_window) {
    // добавляем новый кадр в окно
    var new_value = control_property.valueAtTime(work_start_time + actual_window_end * frame_duration, false);
    sum += new_value;

    // обновляем max очередь
    while (max_queue.length && max_queue[max_queue.length - 1].value <= new_value) max_queue.pop();
    max_queue.push({ value: new_value, index: actual_window_end });
    while (max_queue.length && max_queue[0].index < window_start) max_queue.shift();

    // обновляем min очередь
    while (min_queue.length && min_queue[min_queue.length - 1].value >= new_value) min_queue.pop();
    min_queue.push({ value: new_value, index: actual_window_end });
    while (min_queue.length && min_queue[0].index < window_start) min_queue.shift();

    state.last_full_window_stats = {
      avg: sum / window_frame_count,
      min: min_queue[0].value,
      max: max_queue[0].value,
    };

    state.sum = sum;
    state.min_queue = min_queue;
    state.max_queue = max_queue;
  }

  var current_value = control_property.valueAtTime(work_start_time + frame_index * frame_duration, false);

  // для неполного окна повторяем последнее полное окно
  if (!is_full_window && state.last_full_window_stats) {
    return {
      avg: state.last_full_window_stats.avg,
      min: state.last_full_window_stats.min,
      max: state.last_full_window_stats.max,
      current_value: current_value,
      // frame_index: frame_index,
    };
  }

  return {
    avg: sum / window_frame_count,
    min: min_queue.length ? min_queue[0].value : null,
    max: max_queue.length ? max_queue[0].value : null,
    current_value: current_value,
    // frame_index: frame_index,
  };
}

function get_ADSR_amplitude(time, activation_time, deactivation_time, is_active, attack, delay, sustain_level, release) {
  if (activation_time === null) return 0;
  if (time - activation_time < attack) return lerp(0, 1, (time - activation_time) / attack);
  else if (time - activation_time - attack < delay) return lerp(1, sustain_level, (time - activation_time - attack) / delay);
  else if (is_active) return sustain_level;
  else if (time - deactivation_time < release) return lerp(sustain_level, 0, (time - deactivation_time) / release);
  else return 0;
}

function getBaseLog(x, y) {
  return Math.log(y) / Math.log(x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getRandomInRange(start_inclusive, end_exclusive) {
  return lerp(start_inclusive, end_exclusive, Math.random());
}

function getRandomInt(max_exclusive) {
  return Math.floor(Math.random() * max_exclusive);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fract_abs(num) {
  return Math.abs(num % 1);
}

function fract(num) {
  return num - Math.trunc(num);
}

function getCompByName(name) {
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof CompItem && it.name === name) {
      return it;
    }
  }
  return null;
}

function create_new_or_return_existing_control(layer, control_name, type, default_value) {
  var effect = layer.effect(control_name);
  if (!effect) {
    var adbe_type = "ADBE " + type + " Control";
    effect = layer.Effects.addProperty(adbe_type);
    effect.name = control_name;
    if (default_value !== undefined) effect.property(type).setValue(default_value);
  }
  return effect.property(type); // <- возвращаем property, а не effect - иначе setValuesAtTimes работать не будет!
}

(function () {
  const script_fullpath = $.fileName; // Возвращает полный путь текущего выполняемого скрипта
  const script_filename = File(script_fullpath).name; // имя файла

  var message =
    "Этот скрипт\n\n" +
    script_filename + "\n\n" +
    "ПРОВЕРЬ: ОТРАБАТЫВАЕТ БЫСТРЕЕ, ЕСЛИ КЛЮЧИ ПРЕДВАРИТЕЛЬНО УДАЛИТЬ?!" + "\n\n" +
    "Хотите продолжить?";
  var proceed = confirm(message);
  if (!proceed) return;

  const script_start_time = Date.now();
  app.beginUndoGroup(script_filename);

  const beatComp = app.project.activeItem;
  const beat_layer = beatComp.layer("beat");
  if (!beat_layer) throw ("!beat_layer");

  const videoComp = getCompByName("composition_video");
  const video_clips_times = get_video_clips_start_end_times_in_composition(beatComp, "composition_video");

  const video_start = 0;
  const video_end = videoComp.duration;
  const frameDur = 1.0 / beatComp.frameRate;
  const work_start = beatComp.workAreaStart;
  const work_end = work_start + beatComp.workAreaDuration;
  const work_frames = Math.floor((work_end - work_start) / frameDur) + 1;

  create_new_or_return_existing_control(beat_layer, "frames_batch_size", "Slider", 5000);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_max_value", "Slider", 2.0);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_min_value", "Slider", 0.0);
  create_new_or_return_existing_control(beat_layer, "activation_deactivation_spread", "Slider", 0.5); // [0, 1] (0 -> input_C_activation_value === input_C_deactivation_value === avg)
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_attack", "Slider", 0.1); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_delay", "Slider", 0.1); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_sustain", "Slider", 0.0); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_release", "Slider", 0.0); // seconds
  create_new_or_return_existing_control(beat_layer, "speed_max", "Slider", 8.0);
  create_new_or_return_existing_control(beat_layer, "speed_min", "Slider", 2.0);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_neg_max", "Slider", -0.25);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_pos_max", "Slider", +10.0);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_inflation_inc", "Slider", 0.005); // 0.0005);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_inflation_delay", "Slider", 0); // seconds
  create_new_or_return_existing_control(beat_layer, "time_remap_pointers_total", "Slider", 1); // if (time_remap_use_clips_for_pointers === false) then best set to 3+
  create_new_or_return_existing_control(beat_layer, "time_remap_pointer_seconds_min", "Slider", 16);
  create_new_or_return_existing_control(beat_layer, "time_remap_use_clips_for_pointers", "Checkbox", true); // if true then time_remap_pointers_total sets total pointers for ONE clip
  create_new_or_return_existing_control(beat_layer, "hue_drift", "Slider", 0.000278);
  create_new_or_return_existing_control(beat_layer, "auto_correction_window", "Slider", 16);

  // эти значения ниже будут считаны из слайдеров только один раз (для времени comp.time, соответсвующего положению playhead):
  const frames_batch_size = beat_layer.effect("frames_batch_size")("Slider").value;
  const inputs_ABC_max_value = beat_layer.effect("inputs_ABC_max_value")("Slider").value;
  const inputs_ABC_min_value = beat_layer.effect("inputs_ABC_min_value")("Slider").value;
  const activation_deactivation_spread = beat_layer.effect("activation_deactivation_spread")("Slider").value;
  const scale_ADSR_attack = beat_layer.effect("scale_ADSR_attack")("Slider").value;
  const scale_ADSR_delay = beat_layer.effect("scale_ADSR_delay")("Slider").value;
  const scale_ADSR_sustain = beat_layer.effect("scale_ADSR_sustain")("Slider").value;
  const scale_ADSR_release = beat_layer.effect("scale_ADSR_release")("Slider").value;
  const speed_max = beat_layer.effect("speed_max")("Slider").value;
  const speed_min = beat_layer.effect("speed_min")("Slider").value;
  const S_WarpFishEye_Amount_neg_max = beat_layer.effect("S_WarpFishEye_Amount_neg_max")("Slider").value;
  const S_WarpFishEye_Amount_pos_max = beat_layer.effect("S_WarpFishEye_Amount_pos_max")("Slider").value;
  const S_WarpFishEye_inflation_inc = beat_layer.effect("S_WarpFishEye_inflation_inc")("Slider").value;
  const S_WarpFishEye_inflation_delay = beat_layer.effect("S_WarpFishEye_inflation_delay")("Slider").value;
  const time_remap_pointers_total = beat_layer.effect("time_remap_pointers_total")("Slider").value;
  const time_remap_pointer_seconds_min = beat_layer.effect("time_remap_pointer_seconds_min")("Slider").value;
  const time_remap_use_clips_for_pointers = beat_layer.effect("time_remap_use_clips_for_pointers")("Checkbox").value;
  const hue_drift = beat_layer.effect("hue_drift")("Slider").value;
  const auto_correction_window = beat_layer.effect("auto_correction_window")("Slider").value;

  /*
    Этот скрипт всегда дает ошибку "Unable to execute script at line 113. Object is invalid" если слайдер tgtControl (с именем "script_output") еще не существует на момент запуска скрипта.
    Если слайдер уже существует ошибки этой нет - и скрипт выполняется целиком. Но 113 строка это
      var curr_value = srcControl.valueAtTime(time, false);
    В этой строке используется srcControl а не tgtControl. В ЧЕМ ЖЕ ДЕЛО?

    Проблема в том, что добавление эффекта на слой инвалидирует ранее полученные объекты Property.
    Вы получили srcControl до того, как скрипт создаёт tgtControl.
    Когда create_new_or_return_existing_control добавляет script_output, After Effects перестраивает список эффектов и srcControl становится «Object is invalid».
    Если script_output уже есть, эффект не добавляется и srcControl остаётся валидным — ошибка не появляется.
    Исправления (любой из вариантов):
    1. Создавать все контролы перед чтением srcControl
    2. не кэшировать srcControl. В цикле вызывать каждый раз:
      var curr_value = beat_layer.effect("BCC Beat Reactor")("Output Value C").valueAtTime(time, false);
  */
  const script_output_control = create_new_or_return_existing_control(beat_layer, "script_output", "Color");

  const input_C_control = beat_layer.effect("BCC Beat Reactor")("Output Value C"); // в выражении для Amount эффекта S_WarpFishEye: -thisComp.layer("beat").effect("BCC Beat Reactor")("Output Value C") * 0.25
  // const input_A_control = beat_layer.effect("BCC Beat Reactor")("Output Value A");

  var get_pointer_called = 0;
  function get_pointer(starting_position, length) {
    get_pointer_called++;
    const target_position = starting_position + length;
    const direction = Math.random() < 0.5 ? -1 : +1;
    const current_position = direction > 0 ? starting_position : target_position;
    return {
      starting_position: starting_position,
      target_position: target_position,
      current_position: current_position,
      direction: direction,
      hits_total: 0,
    };
  }

  function get_even_pointers(start, end, pointers_total) {
    const pointers = [];
    const between = (end - start) / pointers_total;
    for (var index = 0; index < pointers_total; index++) {
      var time = start + index * between;
      pointers.push(
        get_pointer(time, between - frameDur)
      );
    }
    return pointers;
  }

  function get_pointers_from_clips(clips_times, pointers_per_clip) {
    const pointers = [];
    for (var i = 0; i < clips_times.length; i++) {
      var clip_times = clips_times[i];
      var pointers_in_clip = get_even_pointers(
        clip_times.clip_start_time,
        clip_times.clip_end_time,
        pointers_per_clip,
      );
      Array.prototype.push.apply(pointers, pointers_in_clip);
    }
    return pointers;
  }

  var get_new_pointers_called = 0;
  function get_new_pointers() {
    get_new_pointers_called++;
    if (time_remap_use_clips_for_pointers) return get_pointers_from_clips(video_clips_times, time_remap_pointers_total);
    else return get_even_pointers(video_start, video_end, time_remap_pointers_total, 0);
  }

  var pointers = get_new_pointers();
  var pointer_index = getRandomInt(pointers.length);
  pointers[pointer_index].hits_total++;
  var pointer_hits_total_min = pointers[pointer_index].hits_total;
  var pointer_hits_total_max = pointers[pointer_index].hits_total;
  var current_pointer_min_position = pointers[pointer_index].current_position;
  var current_pointer_max_position = pointers[pointer_index].current_position;
  const pointers_number_before = pointers.length;
  var max_pointers_at_once = pointers_number_before;
  var min_pointers_at_once = pointers_number_before;
  var pointer_played_length_max = 0;
  var pointer_played_length_sum = 0;
  var pointer_played_length_sum_count = 0;
  var pointer_planned_length_min = pointers[pointer_index].target_position - pointers[pointer_index].starting_position;
  var pointer_planned_length_max = pointer_planned_length_min;
  var total_seconds_skipped = 0;

  var accumulated_time = 0;
  var hue = getRandomInRange(0, 1);
  var sgn = +1;

  const effect_triggered_total = [0, 0, 0];
  const effect_triggered_values = [];
  const windows_stats_values = [];

  var effect_index = 2; // getRandomInt(3); // [0, 2];
  var FX_triggered_total = 0;
  var is_FX_active = false;
  var scale_ADSR_activation_time = null;
  var scale_ADSR_deactivation_time = null;
  var scale_ADSR_amplitude = 0; // [0, 1]
  var time_for_direction_flip = null;
  var times_pointers_reversed = 0;
  var speed_max_total_frames = 0;
  var time_for_speed_max_end = null;

  var S_WarpFishEye_Amount = 0; // [-10, +10]
  var S_WarpFishEye_inflation_start_time = null;

  var input_C_deactivation_value_equal_activation_value = 0;
  var windows_stats_max_equal_min = 0;

  var window_frame_count = Math.max(1, Math.floor(auto_correction_window / frameDur));
  var state = compute_forward_window_stats_init(input_C_control, work_start, frameDur, window_frame_count, work_frames);

  var setValuesAtTimes_total_time = 0;
  var setValuesAtTimes_called_times = 0;

  const frame_times = new Array(frames_batch_size);
  const frame_values = new Array(frames_batch_size);

  for (var batch_start = 0; batch_start < work_frames; batch_start += frames_batch_size) {
    var batch_end = Math.min(batch_start + frames_batch_size, work_frames);
    var batch_length = batch_end - batch_start;

    for (var index_in_batch = 0; index_in_batch < batch_length; index_in_batch++) {
      var frame = batch_start + index_in_batch;
      var time = work_start + frame * frameDur;

      var window_stats = compute_forward_window_stats_step(state, input_C_control, frame);
      if (window_stats.max === window_stats.min) windows_stats_max_equal_min++;
      // windows_stats_values.push(window_stats);
      var input_C_value = window_stats.current_value; // [inputs_ABC_min_value, inputs_ABC_max_value]

      var input_C_deactivation_value = lerp(window_stats.avg, window_stats.min, activation_deactivation_spread);
      var input_C_activation_value = lerp(window_stats.avg, window_stats.max, activation_deactivation_spread);
      if (input_C_deactivation_value === input_C_activation_value) {
        input_C_deactivation_value_equal_activation_value++; // skip if so
      } else {
        if (input_C_value >= input_C_activation_value) time_for_speed_max_end = time + 0.1;
      }
      if (time_for_speed_max_end !== null) {
        if (time >= time_for_speed_max_end) time_for_speed_max_end = null;
        else speed_max_total_frames++;
      }
      var speed = time_for_speed_max_end !== null ? speed_max : speed_min;

      if (time_for_direction_flip !== null && time >= time_for_direction_flip) {
        time_for_direction_flip = null;
        pointers[pointer_index].direction *= -1;
        times_pointers_reversed++;
      }

      var current_position = pointers[pointer_index].current_position;
      var starting_position = pointers[pointer_index].starting_position;
      var target_position = pointers[pointer_index].target_position;
      var direction = pointers[pointer_index].direction;

      var time_increment = frameDur * speed * direction;
      current_position += time_increment;
      accumulated_time += Math.abs(time_increment);
      if (current_position > target_position) {
        current_position = target_position;
        pointers[pointer_index].direction = -1;
        times_pointers_reversed++;
      }
      if (current_position < starting_position) {
        current_position = starting_position;
        pointers[pointer_index].direction = +1;
        times_pointers_reversed++;
      }
      pointers[pointer_index].current_position = current_position;
      if (current_pointer_min_position > current_position) current_pointer_min_position = current_position;
      if (current_pointer_max_position < current_position) current_pointer_max_position = current_position;

      var FX_triggered = false;

      if (is_FX_active && (input_C_value <= input_C_deactivation_value)) {
        is_FX_active = false;
      }
      if ((!is_FX_active) && (input_C_value >= input_C_activation_value)) {
        if (input_C_deactivation_value === input_C_activation_value) {
          // skip activation if so
        } else {
          is_FX_active = true;
          FX_triggered = true;
          FX_triggered_total++;
        }
      }

      if (FX_triggered) {
        var prev_effect_index = effect_index;
        effect_triggered_total[prev_effect_index]++;
        effect_index = (prev_effect_index + 1 + getRandomInt(2)) % 3;

        if (prev_effect_index === 0) { // horizontal inversion
          hue += 0.5;
          sgn *= -1;
        }
        else if (prev_effect_index === 1) { // scale forward then backward
          scale_ADSR_activation_time = time;
          scale_ADSR_deactivation_time = time;
          time_for_direction_flip = time + scale_ADSR_attack;
        }
        else if (prev_effect_index === 2) { // jump in time
          hue = getRandomInRange(0, 1);

          var current_position = pointers[pointer_index].current_position;
          var starting_position = pointers[pointer_index].starting_position;
          var target_position = pointers[pointer_index].target_position;

          var pointer_hits_total = pointers[pointer_index].hits_total;
          if (pointer_hits_total_min > pointer_hits_total) pointer_hits_total_min = pointer_hits_total;
          if (pointer_hits_total_max < pointer_hits_total) pointer_hits_total_max = pointer_hits_total;
          var played_length = current_pointer_max_position - current_pointer_min_position;
          pointer_played_length_sum += played_length;
          pointer_played_length_sum_count++;
          if (pointer_played_length_max < played_length) pointer_played_length_max = played_length;
          var pointer_planned_length = target_position - starting_position;
          if (pointer_planned_length_min > pointer_planned_length) pointer_planned_length_min = pointer_planned_length;
          if (pointer_planned_length_max < pointer_planned_length) pointer_planned_length_max = pointer_planned_length;

          var start1 = starting_position;
          var length1 = current_pointer_min_position - start1;
          if (length1 < 0) throw "length1 = " + length1 + " < 0";
          var start2 = current_pointer_max_position;
          var length2 = target_position - start2;
          if (length2 < 0) throw "length2 = " + length2 + " < 0";

          pointers.splice(pointer_index, 1);
          if (pointers.length === 0) {
            pointers = get_new_pointers();
            pointer_index = getRandomInt(pointers.length);
          } else {
            pointer_index = getRandomInt(pointers.length);
            if (length1 >= time_remap_pointer_seconds_min) {
              var pointer1 = get_pointer(start1, length1);
              pointers.push(pointer1);
            } else total_seconds_skipped += length1;
            if (length2 >= time_remap_pointer_seconds_min) {
              var pointer2 = get_pointer(start2, length2);
              pointers.push(pointer2);
            } else total_seconds_skipped += length2;
          }

          pointers[pointer_index].hits_total++;
          current_position = pointers[pointer_index].current_position;
          current_pointer_min_position = current_position;
          current_pointer_max_position = current_position;
          var pointers_length = pointers.length;
          if (min_pointers_at_once > pointers_length) min_pointers_at_once = pointers_length;
          if (max_pointers_at_once < pointers_length) max_pointers_at_once = pointers_length;
        }
      }

      scale_ADSR_amplitude = get_ADSR_amplitude(time, scale_ADSR_activation_time, scale_ADSR_deactivation_time, is_FX_active, scale_ADSR_attack, scale_ADSR_delay, scale_ADSR_sustain, scale_ADSR_release);
      var scale = 100 + 100 * scale_ADSR_amplitude;
      var signed_scale = sgn * scale;

      if (S_WarpFishEye_inflation_start_time === null && input_C_value <= inputs_ABC_min_value) S_WarpFishEye_inflation_start_time = time;
      if (input_C_value > inputs_ABC_min_value) S_WarpFishEye_inflation_start_time = null;
      if (S_WarpFishEye_inflation_start_time === null) {
        S_WarpFishEye_Amount = lerp(
          0,
          S_WarpFishEye_Amount_neg_max,
          (input_C_value - inputs_ABC_min_value) / (inputs_ABC_max_value - inputs_ABC_min_value)
        );
      } else if (time - S_WarpFishEye_inflation_start_time > S_WarpFishEye_inflation_delay) {
        S_WarpFishEye_Amount += S_WarpFishEye_inflation_inc;
        S_WarpFishEye_Amount = clamp(S_WarpFishEye_Amount, 0, S_WarpFishEye_Amount_pos_max);
      }

      hue = fract_abs(hue + hue_drift);

      /*
      В After Effects выражениях:
        Time Remap:
          thisComp.layer("beat").effect("script_output")("Color")[0]
        S_WarpFishEye Amount:
          thisComp.layer("beat").effect("script_output")("Color")[3];
        CC Composite (Transfer Mode = Luminosity, Opacity 100%) {after S_WarpFishEye and before S_HueSatBright}
        S_HueSatBright Hue Shift:
          thisComp.layer("beat").effect("script_output")("Color")[2]
        Transform Scale:
          signed_scale = thisComp.layer("beat").effect("script_output")("Color")[1]; // [100;200] | [-100;-200]
          [signed_scale, Math.abs(signed_scale)];

      */
      frame_times[index_in_batch] = time;
      frame_values[index_in_batch] = [current_position, signed_scale, hue, S_WarpFishEye_Amount];
    }

    var setValuesAtTimes_start_time = Date.now();
    // Если последняя порция неполная, используем slice
    if (batch_length < frames_batch_size) {
      script_output_control.setValuesAtTimes(
        frame_times.slice(0, batch_length),
        frame_values.slice(0, batch_length)
      );
    } else {
      script_output_control.setValuesAtTimes(frame_times, frame_values);
    }
    var setValuesAtTimes_end_time = Date.now();
    setValuesAtTimes_total_time += (setValuesAtTimes_end_time - setValuesAtTimes_start_time) / 1000;
    setValuesAtTimes_called_times++;
  }

  app.endUndoGroup();
  const script_end_time = Date.now();
  const script_total_time = (script_end_time - script_start_time) / 1000;

  const pointers_number_after = pointers.length;

  // var file = new File("~/Desktop/effect_triggered_values.json");
  // file.open("w");
  // file.write(JSON.stringify(effect_triggered_values, null, 2)); // null,2 — форматирование с отступами
  // file.close();
  // file.execute();

  const work_area_duration_minutes = (work_end - work_start) / 60;
  const video_duration_minutes = (video_end - video_start) / 60;
  const accumulated_time_minutes = accumulated_time / 60;
  const played_length_sum_minutes = pointer_played_length_sum / 60;
  const total_skipped_minutes = total_seconds_skipped / 60;

  alert(
    script_filename + "\n" +
    "script_total_time = " + script_total_time + "\n" +
    "setValuesAtTimes_total_time = " + setValuesAtTimes_total_time + "\n" +
    "setValuesAtTimes_called_times = " + setValuesAtTimes_called_times + "\n" +
    "frames_batch_size = " + frames_batch_size + "\n" +
    "inputs_ABC_max_value = " + inputs_ABC_max_value + "\n" +
    "inputs_ABC_min_value = " + inputs_ABC_min_value + "\n" +
    "activation_deactivation_spread = " + activation_deactivation_spread + "\n" +
    "scale_ADSR_attack = " + scale_ADSR_attack + "\n" +
    "scale_ADSR_delay = " + scale_ADSR_delay + "\n" +
    "scale_ADSR_sustain = " + scale_ADSR_sustain + "\n" +
    "scale_ADSR_release = " + scale_ADSR_release + "\n" +
    "speed_max = " + speed_max + "\n" +
    "speed_min = " + speed_min + "\n" +
    "S_WarpFishEye_Amount_neg_max = " + S_WarpFishEye_Amount_neg_max + "\n" +
    "S_WarpFishEye_Amount_pos_max = " + S_WarpFishEye_Amount_pos_max + "\n" +
    "S_WarpFishEye_inflation_inc = " + S_WarpFishEye_inflation_inc + "\n" +
    "S_WarpFishEye_inflation_delay = " + S_WarpFishEye_inflation_delay + "\n" +
    "time_remap_pointers_total = " + time_remap_pointers_total + "\n" +
    "time_remap_pointer_seconds_min = " + time_remap_pointer_seconds_min + "\n" +
    "time_remap_use_clips_for_pointers = " + time_remap_use_clips_for_pointers + "\n" +
    "hue_drift = " + hue_drift + "\n" +
    "auto_correction_window = " + auto_correction_window + "\n" +
    "GET_NEW_POINTERS_CALLED = " + get_new_pointers_called + "\n" +
    "get_pointer_called = " + get_pointer_called + "\n" +
    "pointers_number_before = " + pointers_number_before + "\n" +
    "pointers_number_after = " + pointers_number_after + "\n" +
    "max_pointers_at_once = " + max_pointers_at_once + "\n" +
    "min_pointers_at_once = " + min_pointers_at_once + "\n" +
    "pointer_hits_total_max = " + pointer_hits_total_max + "\n" +
    "pointer_hits_total_min = " + pointer_hits_total_min + "\n" +
    "pointer_planned_length_min_sec = " + pointer_planned_length_min + "\n" +
    "pointer_planned_length_max_sec = " + pointer_planned_length_max + "\n" +
    "pointer_played_length_avg_sec = " + pointer_played_length_sum / pointer_played_length_sum_count + "\n" +
    "pointer_played_length_max_sec = " + pointer_played_length_max + "\n" +
    "total_skipped_minutes = " + total_skipped_minutes + "\n" +
    "total_skipped_minutes / video_duration_minutes = " + total_skipped_minutes / video_duration_minutes + "\n" +
    "played_length_sum_minutes = " + played_length_sum_minutes + "\n" +
    "played_length_sum_minutes / video_duration_minutes = " + played_length_sum_minutes / video_duration_minutes + "\n" +
    "accumulated_time_minutes = " + accumulated_time_minutes + "\n" +
    "accumulated_time_minutes / video_duration_minutes = " + accumulated_time_minutes / video_duration_minutes + "\n" +
    "video_duration_minutes = " + video_duration_minutes + "\n" +
    "work_area_duration_minutes / video_duration_minutes = " + work_area_duration_minutes / video_duration_minutes + "\n" +
    "work_area_duration_minutes = " + work_area_duration_minutes + "\n" +
    "speed_max_total_frames = " + speed_max_total_frames + "\n" +
    "speed_max_total_frames / work_frames = " + speed_max_total_frames / work_frames + "\n" +
    "FX_triggered_total = " + FX_triggered_total + "\n" +
    "FX_triggered_per_minute = " + FX_triggered_total / work_area_duration_minutes + "\n" +
    "FX_triggered_avg_period_seconds = " + work_area_duration_minutes * 60 / FX_triggered_total + "\n" +
    "effect_triggered_total = " + JSON.stringify(effect_triggered_total) + "\n" +
    "times_pointers_reversed = " + times_pointers_reversed + "\n" +
    "input_C_deactivation_value_equal_activation_value = " + input_C_deactivation_value_equal_activation_value + "\n" +
    "windows_stats_max_equal_min = " + windows_stats_max_equal_min + "\n"
  );
})();
