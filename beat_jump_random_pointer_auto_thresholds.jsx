// --- инициализация первого окна ---
function compute_forward_window_stats_init(control_property, work_start_time, work_total_frames, frame_duration, window_frame_count) {
  var sum = 0;
  var sum_count = 0;
  var min_queue = [];
  var max_queue = [];

  // формируем первое окно
  for (var frame = 0; frame < Math.min(window_frame_count, work_total_frames); frame++) {
    var v = control_property.valueAtTime(work_start_time + frame * frame_duration, false);
    sum += v;
    sum_count++;

    while (max_queue.length && max_queue[max_queue.length - 1].value <= v) max_queue.pop();
    max_queue.push({ value: v, index: frame });

    while (min_queue.length && min_queue[min_queue.length - 1].value >= v) min_queue.pop();
    min_queue.push({ value: v, index: frame });
  }

  return {
    sum: sum,
    sum_count: sum_count,
    min_queue: min_queue,
    max_queue: max_queue,
    window_frame_count: window_frame_count,
    work_start_time: work_start_time,
    frame_duration: frame_duration,
    work_total_frames: work_total_frames
  };
}

function compute_forward_window_stats_step(state, control_property, work_frame_index) {
  var window_frame_count = state.window_frame_count;
  var sum = state.sum;
  var sum_count = state.sum_count;
  var min_queue = state.min_queue;
  var max_queue = state.max_queue;
  var work_start_time = state.work_start_time;
  var work_total_frames = state.work_total_frames;
  var frame_duration = state.frame_duration;

  var window_first_frame = work_frame_index;
  var window_last_frame = work_frame_index + window_frame_count - 1;
  const is_full_window = window_last_frame < work_total_frames;

  var prev_value = state.current_value !== undefined ? state.current_value : 0;
  state.current_value = control_property.valueAtTime(work_start_time + window_first_frame * frame_duration, false);

  if (is_full_window) {
    // убираеми левый кадр из окна
    sum -= prev_value;
    sum_count--;

    // добавляем правый кадр в окно
    var new_value = control_property.valueAtTime(work_start_time + window_last_frame * frame_duration, false);
    sum += new_value;
    sum_count++;

    // обновляем max очередь
    while (max_queue.length && max_queue[max_queue.length - 1].value <= new_value) max_queue.pop();
    max_queue.push({ value: new_value, index: window_last_frame });
    while (max_queue.length && max_queue[0].index < window_first_frame) max_queue.shift();

    // обновляем min очередь
    while (min_queue.length && min_queue[min_queue.length - 1].value >= new_value) min_queue.pop();
    min_queue.push({ value: new_value, index: window_last_frame });
    while (min_queue.length && min_queue[0].index < window_first_frame) min_queue.shift();

    state.sum = sum;
    state.sum_count = sum_count;
    state.min_queue = min_queue;
    state.max_queue = max_queue;

    state.last_full_window_stats = {
      avg: sum / sum_count,
      min: min_queue[0].value,
      max: max_queue[0].value,
    };
  }

  // для неполного окна вернется последнее полное окно
  return {
    avg: state.last_full_window_stats.avg,
    min: state.last_full_window_stats.min,
    max: state.last_full_window_stats.max,
    current_value: state.current_value,
  };
}

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
  app.project.suspendRendering = true;   // скрытое свойство, работает
  app.disableUpdates = true;             // скрытое свойство, уменьшает перерисовки

  const beatComp = app.project.activeItem;
  const beat_layer = beatComp.layer("beat");
  if (!beat_layer) throw ("!beat_layer");

  const videoComp = getCompByName("composition_video");
  const video_clips_times = get_video_clips_start_end_times_in_composition(beatComp, "composition_video");
  // alert(JSON.stringify(video_clips_times));

  const video_start_time = 0;
  const video_end_time = videoComp.duration;
  const frame_duration = 1.0 / beatComp.frameRate;
  const work_start_time = beatComp.workAreaStart;
  const work_end_time = work_start_time + beatComp.workAreaDuration;
  const work_total_frames = Math.floor((work_end_time - work_start_time) / frame_duration) + 1;

  create_new_or_return_existing_control(beat_layer, "frames_batch_size", "Slider", 5000);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_max_value", "Slider", 2.0);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_min_value", "Slider", 0.0);
  create_new_or_return_existing_control(beat_layer, "activation_deactivation_spread", "Slider", 0.5); // [0, 1] (0 -> input_C_activation_value === input_C_deactivation_value === avg)
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_attack", "Slider", 0.1); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_delay", "Slider", 0.1); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_sustain", "Slider", 0.0); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_release", "Slider", 0.0); // seconds
  create_new_or_return_existing_control(beat_layer, "speed_max", "Slider", 16.0); // 1 + (7 / 1.25) * 2 === 12.2
  create_new_or_return_existing_control(beat_layer, "speed_avg", "Slider", 4.0);
  create_new_or_return_existing_control(beat_layer, "speed_min", "Slider", 1.0);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_neg_max", "Slider", -0.25);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_pos_max", "Slider", +10.0);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_inflation_inc", "Slider", 0.0005);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_inflation_delay", "Slider", 0); // seconds
  create_new_or_return_existing_control(beat_layer, "time_remap_pointers_total", "Slider", 2); // if (time_remap_use_clips_for_pointers === false) then best set to 3+
  create_new_or_return_existing_control(beat_layer, "time_remap_use_clips_for_pointers", "Checkbox", true); // if true then time_remap_pointers_total sets total pointers for ONE clip
  create_new_or_return_existing_control(beat_layer, "time_remap_fixed_pointers_order", "Checkbox", false);
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
  const speed_avg = beat_layer.effect("speed_avg")("Slider").value;
  const speed_min = beat_layer.effect("speed_min")("Slider").value;
  const S_WarpFishEye_Amount_neg_max = beat_layer.effect("S_WarpFishEye_Amount_neg_max")("Slider").value;
  const S_WarpFishEye_Amount_pos_max = beat_layer.effect("S_WarpFishEye_Amount_pos_max")("Slider").value;
  const S_WarpFishEye_inflation_inc = beat_layer.effect("S_WarpFishEye_inflation_inc")("Slider").value;
  const S_WarpFishEye_inflation_delay = beat_layer.effect("S_WarpFishEye_inflation_delay")("Slider").value;
  const time_remap_pointers_total = beat_layer.effect("time_remap_pointers_total")("Slider").value;
  const time_remap_use_clips_for_pointers = beat_layer.effect("time_remap_use_clips_for_pointers")("Checkbox").value;
  const time_remap_fixed_pointers_order = beat_layer.effect("time_remap_fixed_pointers_order")("Checkbox").value;
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

  function get_even_pointers(start, end, pointers_total, index_offset) {
    const pointers = [];
    const between = (end - start) / pointers_total;
    for (var index = 0; index < pointers_total; index++) {
      var time = start + index * between;
      pointers.push({
        number: index + index_offset,
        starting_position: time,
        current_position: time,
        target_position: time + between,
      })
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
        pointers.length);
      Array.prototype.push.apply(pointers, pointers_in_clip);
    }
    return pointers;
  }

  var get_pointers_called = 0;
  function get_pointers() {
    get_pointers_called++;
    if (time_remap_use_clips_for_pointers) return get_pointers_from_clips(video_clips_times, time_remap_pointers_total);
    else return get_even_pointers(video_start_time, video_end_time, time_remap_pointers_total, 0);
  }

  var pointers = get_pointers();
  var pointer_index = getRandomInt(pointers.length);
  const pointers_number_before = pointers.length;
  const pointers_counters = []; for (var i = 0; i < pointers_number_before; i++) pointers_counters[i] = 0;

  var accumulated_time = 0;
  var then_accumulated_reach_video_duration = null;
  var hue = getRandomInRange(0, 1);
  var sgn = +1;

  const effect_triggered_total = [0, 0, 0];
  const effect_triggered_values = [];
  const windows_stats_values = [];

  var effect_index = getRandomInt(3); // [0, 2];
  var FX_triggered_total = 0;
  var is_FX_active = false;
  var scale_ADSR_activation_time = null;
  var scale_ADSR_deactivation_time = null;
  var scale_ADSR_amplitude = 0; // [0, 1]

  var S_WarpFishEye_Amount = 0; // [-10, +10]
  var S_WarpFishEye_inflation_start_time = null;

  var input_C_deactivation_value_equal_activation_value = 0;
  var windows_stats_max_equal_min = 0;
  var input_C_deactivation_value = inputs_ABC_min_value;
  var input_C_activation_value = inputs_ABC_max_value;
  var speed_inputs = undefined;

  var window_frame_count = Math.max(1, Math.floor(auto_correction_window / frame_duration));
  var state = compute_forward_window_stats_init(input_C_control, work_start_time, work_total_frames, frame_duration, window_frame_count);

  var setValuesAtTimes_total_time = 0;
  var setValuesAtTimes_called_times = 0;

  const frame_times = new Array(frames_batch_size);
  const frame_values = new Array(frames_batch_size);

  function get_spd_from_src(src_value, src_low, src_mid, src_high, spd_low, spd_mid, spd_high) {
    var x = (src_value - src_low) / (src_high - src_low);
    x = clamp(x, 0, 1);
    // находим степень, при которой для src_mid будет получаться spd_mid
    var exponent = getBaseLog(
      (src_mid - src_low) / (src_high - src_low),
      (spd_mid - spd_low) / (spd_high - spd_low)
    );
    var spd_value = spd_low + (spd_high - spd_low) * Math.pow(x, exponent);
    return spd_value;
  }

  for (var batch_start = 0; batch_start < work_total_frames; batch_start += frames_batch_size) {
    var batch_end = Math.min(batch_start + frames_batch_size, work_total_frames);
    var batch_length = batch_end - batch_start;

    for (var index_in_batch = 0; index_in_batch < batch_length; index_in_batch++) {
      var frame = batch_start + index_in_batch;
      var time = work_start_time + frame * frame_duration;

      var window_stats = compute_forward_window_stats_step(state, input_C_control, frame);
      // windows_stats_values.push(window_stats);
      var input_C_value = window_stats.current_value; // [inputs_ABC_min_value, inputs_ABC_max_value]

      if (!is_FX_active) {
        input_C_activation_value = lerp(window_stats.avg, window_stats.max, activation_deactivation_spread);
      }

      // var k = (input_C_value - input_C_deactivation_value) / (input_C_activation_value - input_C_deactivation_value); // может получится меньше 0 или больше 1
      // var k = (input_C_value - window_stats.min) / (window_stats.max - window_stats.min);
      // var k = (input_C_value - window_stats.avg) / (window_stats.max - window_stats.avg);
      // if (!isFinite(k)) {
      //   windows_stats_max_equal_min++;
      //   k = 0;
      // }
      // k = clamp(k, 0, 1); // ограничиваем от 0 до 1
      // var speed = lerp(speed_min, speed_max, k);
      if (!speed_inputs) speed_inputs = window_stats;
      var speed_output = get_spd_from_src(input_C_value, speed_inputs.min, speed_inputs.avg, speed_inputs.max, speed_min, speed_avg, speed_max);
      if (input_C_value <= speed_inputs.min) speed_inputs = undefined;

      var current_position = pointers[pointer_index].current_position;
      var time_increment = frame_duration * speed_output;
      current_position += time_increment;
      accumulated_time += time_increment;
      if (accumulated_time >= (video_end_time - video_start_time) && then_accumulated_reach_video_duration === null) then_accumulated_reach_video_duration = time;
      if (current_position >= video_end_time) current_position = video_start_time;
      pointers[pointer_index].current_position = current_position;

      var FX_triggered = false;

      if (is_FX_active && (input_C_value <= input_C_deactivation_value)) {
        is_FX_active = false;
      }
      if ((!is_FX_active) && (input_C_value >= input_C_activation_value)) {
        // input_C_deactivation_value = lerp(window_stats.avg, window_stats.min, activation_deactivation_spread);
        input_C_deactivation_value = window_stats.avg;

        if (input_C_deactivation_value === input_C_activation_value) {
          input_C_deactivation_value_equal_activation_value++; // skip activation if so
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
        }
        else if (prev_effect_index === 2) { // jump in time
          hue = getRandomInRange(0, 1);
          var starting_position = pointers[pointer_index].starting_position;
          var target_position = pointers[pointer_index].target_position;
          var prev_pointer_index = pointer_index;
          if (starting_position > current_position || current_position >= target_position) pointers.splice(pointer_index, 1);
          if (pointers.length < 2) pointers = get_pointers();

          if (time_remap_fixed_pointers_order) {
            pointer_index = (prev_pointer_index + 1) % pointers.length;
          } else {
            pointer_index = (prev_pointer_index + 1 + getRandomInt(pointers.length - 1)) % pointers.length;
          }

          pointers_counters[pointers[pointer_index].number]++;
          current_position = pointers[pointer_index].current_position;
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
      // frame_times[frame] = time;
      // frame_values[frame] = [current_position, signed_scale, hue, S_WarpFishEye_Amount];
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

  app.disableUpdates = false;
  app.project.suspendRendering = false;
  app.endUndoGroup();
  const script_end_time = Date.now();
  const script_total_time = (script_end_time - script_start_time) / 1000;

  const pointers_number_after = pointers.length;

  // var file = new File("~/Desktop/effect_triggered_values.json");
  // file.open("w");
  // file.write(JSON.stringify(effect_triggered_values, null, 2)); // null,2 — форматирование с отступами
  // file.close();
  // file.execute();

  const work_area_duration_minutes = (work_end_time - work_start_time) / 60;
  const video_duration_minutes = (video_end_time - video_start_time) / 60;
  const accumulated_time_minutes = accumulated_time / 60;

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
    "speed_avg = " + speed_avg + "\n" +
    "speed_min = " + speed_min + "\n" +
    "S_WarpFishEye_Amount_neg_max = " + S_WarpFishEye_Amount_neg_max + "\n" +
    "S_WarpFishEye_Amount_pos_max = " + S_WarpFishEye_Amount_pos_max + "\n" +
    "S_WarpFishEye_inflation_inc = " + S_WarpFishEye_inflation_inc + "\n" +
    "S_WarpFishEye_inflation_delay = " + S_WarpFishEye_inflation_delay + "\n" +
    "time_remap_pointers_total = " + time_remap_pointers_total + "\n" +
    "time_remap_use_clips_for_pointers = " + time_remap_use_clips_for_pointers + "\n" +
    "time_remap_fixed_pointers_order = " + time_remap_fixed_pointers_order + "\n" +
    "hue_drift = " + hue_drift + "\n" +
    "auto_correction_window = " + auto_correction_window + "\n" +
    "get_pointers_called = " + get_pointers_called + "\n" +
    "pointers_number_before = " + pointers_number_before + "\n" +
    "pointers_number_after = " + pointers_number_after + "\n" +
    "accumulated_time_minutes = " + accumulated_time_minutes + "\n" +
    "accumulated_time_minutes / video_duration_minutes = " + accumulated_time_minutes / video_duration_minutes + "\n" +
    "then_accumulated_reach_video_duration = " + then_accumulated_reach_video_duration + "\n" +
    "video_duration_minutes = " + video_duration_minutes + "\n" +
    "work_area_duration_minutes / video_duration_minutes = " + work_area_duration_minutes / video_duration_minutes + "\n" +
    "work_area_duration_minutes = " + work_area_duration_minutes + "\n" +
    "FX_triggered_total = " + FX_triggered_total + "\n" +
    "FX_triggered_per_minute = " + FX_triggered_total / work_area_duration_minutes + "\n" +
    "FX_triggered_avg_period_seconds = " + work_area_duration_minutes * 60 / FX_triggered_total + "\n" +
    "effect_triggered_total = " + JSON.stringify(effect_triggered_total) + "\n" +
    "input_C_deactivation_value_equal_activation_value = " + input_C_deactivation_value_equal_activation_value + "\n" +
    "windows_stats_max_equal_min = " + windows_stats_max_equal_min + "\n" +
    "pointers_counters = " + JSON.stringify(pointers_counters) + "\n"
  );
})();
