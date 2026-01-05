(function () {
  // --- инициализация первого окна ---
  function compute_forward_window_stats_init(control_property, work_start_time, work_total_frames, frame_duration, window_frame_count) {
    var sum = 0;
    var sum_count = 0;
    var min_queue = [];
    var max_queue = [];

    const window_last_frame = window_frame_count - 1;
    // формируем первое окно БЕЗ ПОСЛЕДНЕГО КАДРА
    for (var frame = 0; frame < window_last_frame; frame++) {
      var v = control_property.valueAtTime(work_start_time + frame * frame_duration, false);
      sum += v;
      sum_count++;

      while (max_queue.length && max_queue[max_queue.length - 1].value <= v) max_queue.pop();
      max_queue.push({ value: v, index: frame });

      while (min_queue.length && min_queue[min_queue.length - 1].value >= v) min_queue.pop();
      min_queue.push({ value: v, index: frame });
    }

    return {
      current_value: undefined,
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

    var prev_value = state.current_value;
    state.current_value = control_property.valueAtTime(work_start_time + window_first_frame * frame_duration, false);

    if (is_full_window) {
      if (prev_value !== undefined) {
        // убираеми левый кадр из окна
        sum -= prev_value;
        sum_count--;
      }

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

      if (sum_count !== window_frame_count) throw new Error("sum_count !== window_frame_count" + sum_count + " vs " + window_frame_count);

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
    var skipped_disabled_layers_count = 0;

    // for (var layer_index = 1; layer_index <= child_composition.numLayers; layer_index++) {
    for (var layer_index = child_composition.numLayers; layer_index >= 1; layer_index--) {
      var layer = child_composition.layer(layer_index);

      if (layer instanceof AVLayer && layer.source instanceof FootageItem && layer.source.mainSource instanceof FileSource && layer.source.mainSource.file) {  // это именно видеоклип
        // пропускаем невидимые слои (с выключенным "глазиком")
        if (!layer.enabled) {
          skipped_disabled_layers_count++;
          continue;
        }

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

    if (skipped_disabled_layers_count) alert("Пропущено выключенных слоев: " + skipped_disabled_layers_count);
    if (result.length === 0) throw new Error("Не найдено ни одного видеоклипа");
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
  if (!beat_layer) throw new Error("!beat_layer");

  const videoComp = getCompByName("composition_video");

  const video_start_time = 0;
  const video_end_time = videoComp.duration;
  const frame_duration = 1.0 / beatComp.frameRate;
  const work_start_time = beatComp.workAreaStart;
  const work_end_time = work_start_time + beatComp.workAreaDuration;
  const work_total_frames = Math.floor((work_end_time - work_start_time) / frame_duration) + 1;
  const work_width = beatComp.width;
  const work_height = beatComp.height;

  create_new_or_return_existing_control(beat_layer, "frames_batch_size", "Slider", 5000);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_max_value", "Slider", 2.0);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_min_value", "Slider", 0.0);
  create_new_or_return_existing_control(beat_layer, "deactivate_min_avg", "Slider", 1.0); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "activate_avg_max", "Slider", 0.5); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_attack", "Slider", 0.1); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_delay", "Slider", 0.1); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_sustain", "Slider", 0.0); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_release", "Slider", 0.0); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_MAX_amplitude", "Slider", 100);
  create_new_or_return_existing_control(beat_layer, "speed_max", "Slider", 9.0); // 1 + (7 / 1.25) * 2 === 12.2
  create_new_or_return_existing_control(beat_layer, "speed_avg", "Slider", 3.0);
  create_new_or_return_existing_control(beat_layer, "speed_min", "Slider", 1.0);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_neg_max", "Slider", -0.25);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_pos_max", "Slider", +10.0);
  create_new_or_return_existing_control(beat_layer, "desired_pointer_length_seconds", "Slider", 0);
  create_new_or_return_existing_control(beat_layer, "STOP_AFTER_FULL_SEQUENCES", "Slider", 0);
  create_new_or_return_existing_control(beat_layer, "time_remap_use_clips_for_pointers", "Checkbox", true); // if true then desired_pointer_length_seconds is used for ONE clip
  // create_new_or_return_existing_control(beat_layer, "time_remap_fixed_pointers_order", "Checkbox", false);
  create_new_or_return_existing_control(beat_layer, "USE_WORKAREA_INSTEAD_OF_CLIPS", "Checkbox", false);
  create_new_or_return_existing_control(beat_layer, "POINTERS_LEFT_TO_STOP", "Slider", 0);
  create_new_or_return_existing_control(beat_layer, "hue_drift", "Slider", 0.000278);
  create_new_or_return_existing_control(beat_layer, "auto_correction_window", "Slider", 16);

  // эти значения ниже будут считаны из слайдеров только один раз (для времени comp.time, соответсвующего положению playhead):
  const frames_batch_size = beat_layer.effect("frames_batch_size")("Slider").value;
  const inputs_ABC_max_value = beat_layer.effect("inputs_ABC_max_value")("Slider").value;
  const inputs_ABC_min_value = beat_layer.effect("inputs_ABC_min_value")("Slider").value;
  const deactivate_min_avg = beat_layer.effect("deactivate_min_avg")("Slider").value;
  const activate_avg_max = beat_layer.effect("activate_avg_max")("Slider").value;
  const scale_ADSR_attack = beat_layer.effect("scale_ADSR_attack")("Slider").value;
  const scale_ADSR_delay = beat_layer.effect("scale_ADSR_delay")("Slider").value;
  const scale_ADSR_sustain = beat_layer.effect("scale_ADSR_sustain")("Slider").value;
  const scale_ADSR_release = beat_layer.effect("scale_ADSR_release")("Slider").value;
  const scale_MAX_amplitude = beat_layer.effect("scale_MAX_amplitude")("Slider").value;
  const speed_max = beat_layer.effect("speed_max")("Slider").value;
  const speed_avg = beat_layer.effect("speed_avg")("Slider").value;
  const speed_min = beat_layer.effect("speed_min")("Slider").value;
  const S_WarpFishEye_Amount_neg_max = beat_layer.effect("S_WarpFishEye_Amount_neg_max")("Slider").value;
  const S_WarpFishEye_Amount_pos_max = beat_layer.effect("S_WarpFishEye_Amount_pos_max")("Slider").value;
  const desired_pointer_length_seconds = beat_layer.effect("desired_pointer_length_seconds")("Slider").value;
  const STOP_AFTER_FULL_SEQUENCES = beat_layer.effect("STOP_AFTER_FULL_SEQUENCES")("Slider").value;
  const time_remap_use_clips_for_pointers = beat_layer.effect("time_remap_use_clips_for_pointers")("Checkbox").value;
  // const time_remap_fixed_pointers_order = beat_layer.effect("time_remap_fixed_pointers_order")("Checkbox").value;
  const USE_WORKAREA_INSTEAD_OF_CLIPS = beat_layer.effect("USE_WORKAREA_INSTEAD_OF_CLIPS")("Checkbox").value;
  const POINTERS_LEFT_TO_STOP = beat_layer.effect("POINTERS_LEFT_TO_STOP")("Slider").value;
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
  create_new_or_return_existing_control(beat_layer, "script_output", "Color");
  create_new_or_return_existing_control(beat_layer, "script_output1", "Slider");
  const script_output0_control = beat_layer.effect("script_output")("Color");
  const script_output1_control = beat_layer.effect("script_output1")("Slider");

  const input_C_control = beat_layer.effect("BCC Beat Reactor")("Output Value C"); // в выражении для Amount эффекта S_WarpFishEye: -thisComp.layer("beat").effect("BCC Beat Reactor")("Output Value C") * 0.25
  // const input_A_control = beat_layer.effect("BCC Beat Reactor")("Output Value A");

  function get_even_pointers(start, end, desired_length_seconds, index_offset) {
    const pointers = [];
    const total_duration = end - start;

    // Если общая длительность меньше желаемой длины или desired_length_seconds <= 0, создаем один указатель
    if (total_duration < desired_length_seconds || desired_length_seconds <= 0) {
      pointers.push({
        number: index_offset,
        starting_position: start,
        current_position: start,
        target_position: end - frame_duration,
        direction: +1,
        bounced_total: 0,
      });
      return pointers;
    }

    // Создаем указатели
    var index = 0;
    var current_time = start;
    while (current_time < end) {
      var remaining = end - current_time;
      if (remaining < desired_length_seconds) {
        // Если оставшееся время меньше желаемой длины, добавляем его к последнему указателю
        var last_pointer = pointers[pointers.length - 1];
        last_pointer.target_position = end - frame_duration;
        break;
      }

      pointers.push({
        number: index + index_offset,
        starting_position: current_time,
        current_position: current_time,
        target_position: current_time + desired_length_seconds - frame_duration,
        direction: +1,
        bounced_total: 0,
      });

      current_time += desired_length_seconds;
      index++;
    }
    return pointers;
  }

  function get_pointers_from_clips(clips_times, desired_length_seconds, videoComp, USE_WORKAREA_INSTEAD_OF_CLIPS) {
    // Если флаг установлен - игнорируем клипы и используем только workarea
    if (USE_WORKAREA_INSTEAD_OF_CLIPS) {
      var workarea_start = videoComp.workAreaStart;
      var workarea_end = workarea_start + videoComp.workAreaDuration;
      return get_even_pointers(workarea_start, workarea_end, desired_length_seconds, 0);
    }

    // Иначе создаем указатели для каждого клипа
    const pointers = [];
    for (var i = 0; i < clips_times.length; i++) {
      var clip_times = clips_times[i];
      var pointers_in_clip = get_even_pointers(
        clip_times.clip_start_time,
        clip_times.clip_end_time,
        desired_length_seconds,
        pointers.length);
      Array.prototype.push.apply(pointers, pointers_in_clip);
    }
    return pointers;
  }

  const video_clips_times = get_video_clips_start_end_times_in_composition(beatComp, "composition_video");
  // alert(JSON.stringify(video_clips_times));

  var get_pointers_called = 0;
  function get_pointers() {
    get_pointers_called++;
    if (time_remap_use_clips_for_pointers) return get_pointers_from_clips(video_clips_times, desired_pointer_length_seconds, videoComp, USE_WORKAREA_INSTEAD_OF_CLIPS);
    else return get_even_pointers(video_start_time, video_end_time, desired_pointer_length_seconds, 0);
  }

  function fisher_yates_shuffle(array) {
    // Алгоритм Фишера-Йетса для случайной перетасовки массива
    for (var i = array.length - 1; i > 0; i--) {
      var j = getRandomInt(i + 1); // j от 0 до i включительно (правильный Фишер-Йетс)
      var temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  function get_random_permutation(last) {
    // Возвращает случайную перестановку всех элементов от 0 до last включительно
    var array = [];
    for (var i = 0; i <= last; i++) {
      array.push(i);
    }
    return fisher_yates_shuffle(array);
  }

  var randomize_pointers_called = 0;
  function randomize_pointers(pointers) {
    randomize_pointers_called++;
    fisher_yates_shuffle(pointers);
    return pointers;
  }

  var pointers = get_pointers();
  var zero_element = pointers.shift(); // убираем нулевой элемент
  randomize_pointers(pointers);
  pointers.unshift(zero_element); // возвращаем нулевой элемент обратно
  var pointer_index = 0; // getRandomInt(pointers.length);
  var pointer_sequences_stats = [{
    start_time_seconds: work_start_time,
    duration_minutes: -1,
    pointers_count: pointers.length,
  }];
  const pointers_number_before = pointers.length;
  const pointers_counters = []; for (var i = 0; i < pointers_number_before; i++) pointers_counters[i] = 0;
  var bounced_total_max = 0;

  var unique_accumulated_time = 0;
  var total_accumulated_time = 0;
  var then_unique_reach_video_duration = null;
  var hue = getRandomInRange(0, 1);
  var sgn = +1;

  const TOTAL_EFFECTS = 4; // 0 - horizontal inversion, 1 - scale forward then backward, 2 - opacity, 3 - jump in time
  var effects_sequence = get_random_permutation(TOTAL_EFFECTS - 1);
  var effect_sequence_index = 0;
  const effect_triggered_total = []; for (var i = 0; i < TOTAL_EFFECTS; i++) effect_triggered_total[i] = 0;
  const effect_triggered_values = [];

  var FX_triggered_total = 0;
  var is_FX_active = false;
  const windows_stats_values = [];

  var scale_ADSR_activation_time = null;
  var scale_ADSR_deactivation_time = null;
  // var center_point_x = work_width / 2;
  // var center_point_y = work_height / 2;

  var opacity = 100;
  var time_to_revert_opacity = null;

  var S_WarpFishEye_Amount = 0; // [-10, +10]

  var input_C_deactivation_value_equal_activation_value = 0;
  var windows_stats_max_equal_min = 0;
  var input_C_deactivation_value = inputs_ABC_min_value;
  var input_C_activation_value = inputs_ABC_max_value;
  var speed_inputs = undefined;
  var warp_inputs = undefined;

  var window_frame_count = Math.max(1, Math.floor(auto_correction_window / frame_duration));
  var state = compute_forward_window_stats_init(input_C_control, work_start_time, work_total_frames, frame_duration, window_frame_count);

  var setValuesAtTimes_total_time = 0;
  var setValuesAtTimes_called_times = 0;

  const frame_times = new Array(frames_batch_size);
  const frame_output0_values = new Array(frames_batch_size);
  const frame_output1_values = new Array(frames_batch_size);

  function get_spd_from_src(src_value, src_low, src_mid, src_high, spd_low, spd_mid, spd_high) {
    if (src_high === src_low) throw new Error("src_high === src_low" + src_high + " vs " + src_low);
    if (spd_high === spd_low) throw new Error("spd_high === spd_low" + spd_high + " vs " + spd_low);
    var x = (src_value - src_low) / (src_high - src_low);
    // x = clamp(x, 0, 1);
    if (x < 0 || x > 1) throw new Error("x < 0 || x > 1" + ", x === " + x);
    // находим степень, при которой для src_mid будет получаться spd_mid
    var exponent = getBaseLog(
      (src_mid - src_low) / (src_high - src_low),
      (spd_mid - spd_low) / (spd_high - spd_low)
    );
    var spd_value = spd_low + (spd_high - spd_low) * Math.pow(x, exponent);
    return spd_value;
  }

  var time_processing_stopped_at = null;
  for (var batch_start = 0; batch_start < work_total_frames; batch_start += frames_batch_size) {
    if (time_processing_stopped_at !== null) break;

    var batch_end = Math.min(batch_start + frames_batch_size, work_total_frames);
    var batch_length = batch_end - batch_start;

    for (var index_in_batch = 0; index_in_batch < batch_length; index_in_batch++) {
      var frame = batch_start + index_in_batch;
      var time = work_start_time + frame * frame_duration;

      var window_stats = compute_forward_window_stats_step(state, input_C_control, frame);
      try {
        // windows_stats_values.push(window_stats);
        if (window_stats.current_value < window_stats.min) throw new Error("window_stats.current_value < window_stats.min");
        if (window_stats.current_value > window_stats.max) throw new Error("window_stats.current_value > window_stats.max");
        if (window_stats.max === window_stats.min) {
          windows_stats_max_equal_min++;
        } else {
          if (window_stats.max < window_stats.min) throw new Error("window_stats.max < window_stats.min");
          if (window_stats.min > window_stats.max) throw new Error("window_stats.min > window_stats.max");
          // avg-проверки срабатывают, если целое окно "тишины" - из-за округления?
          if (window_stats.avg < window_stats.min) throw new Error("window_stats.avg < window_stats.min");
          if (window_stats.avg > window_stats.max) throw new Error("window_stats.avg > window_stats.max");
        }
      } catch (e) {
        alert(
          "Error in window_stats at time " + time + ": " + e.message + "\n" +
          "window_stats.min = " + window_stats.min + "\n" +
          "window_stats.avg = " + window_stats.avg + "\n" +
          "window_stats.max = " + window_stats.max + "\n" +
          "window_stats.current_value = " + window_stats.current_value + "\n" +
          "\n"
        );
        time_processing_stopped_at = time;
        break;
      }
      var input_C_value = window_stats.current_value; // [inputs_ABC_min_value, inputs_ABC_max_value]

      if (!is_FX_active) {
        input_C_activation_value = lerp(window_stats.avg, window_stats.max, activate_avg_max);
      }

      if (!speed_inputs) speed_inputs = window_stats;
      var speed_output = (speed_inputs.min === speed_inputs.max)
        ? speed_min
        : get_spd_from_src(input_C_value, speed_inputs.min, speed_inputs.avg, speed_inputs.max, speed_min, speed_avg, speed_max);
      if (input_C_value <= speed_inputs.min) speed_inputs = undefined;

      var starting_position = pointers[pointer_index].starting_position;
      var target_position = pointers[pointer_index].target_position;
      var current_position = pointers[pointer_index].current_position;
      var old_current_position = current_position;
      var old_bounced_total = pointers[pointer_index].bounced_total;
      var direction = pointers[pointer_index].direction;
      var time_increment = frame_duration * speed_output;
      current_position += time_increment * direction;
      if (current_position > target_position) {
        current_position = target_position;
        pointers[pointer_index].direction = -1;
        pointers[pointer_index].bounced_total++;
      }
      if (current_position < starting_position) {
        current_position = starting_position;
        pointers[pointer_index].direction = +1;
        pointers[pointer_index].bounced_total++;
      }
      if (bounced_total_max < pointers[pointer_index].bounced_total) bounced_total_max = pointers[pointer_index].bounced_total;
      pointers[pointer_index].current_position = current_position;

      var position_diff = Math.abs(current_position - old_current_position);
      unique_accumulated_time += (old_bounced_total ? 0 : position_diff);
      total_accumulated_time += position_diff;
      if (then_unique_reach_video_duration === null && unique_accumulated_time >= (video_end_time - video_start_time)) then_unique_reach_video_duration = time;

      var FX_triggered = false;

      if (is_FX_active && (input_C_value <= input_C_deactivation_value)) {
        is_FX_active = false;
      }
      if ((!is_FX_active) && (input_C_value >= input_C_activation_value)) {
        input_C_deactivation_value = lerp(window_stats.min, window_stats.avg, deactivate_min_avg);

        if (input_C_deactivation_value >= input_C_activation_value) {
          input_C_deactivation_value_equal_activation_value++; // skip activation if so
        } else {
          is_FX_active = true;
          FX_triggered = true;
          FX_triggered_total++;
        }
      }

      if (time_to_revert_opacity !== null && time >= time_to_revert_opacity) {
        opacity = 100;
        time_to_revert_opacity = null;
      }

      if (FX_triggered) {
        if (pointers[pointer_index].bounced_total && pointers[pointer_index].bounced_total === old_bounced_total) {
          pointers[pointer_index].direction *= -1;
          pointers[pointer_index].bounced_total++; // это тоже баунс, хоть и не от краев
        }

        var prev_effect_number = effects_sequence[effect_sequence_index];
        effect_sequence_index += 1;
        if (effect_sequence_index >= TOTAL_EFFECTS) {
          fisher_yates_shuffle(effects_sequence);
          effect_sequence_index = 0;
        }
        var effect_number = effects_sequence[effect_sequence_index];
        // var prev_effect_number = effect_number;
        // effect_number = (prev_effect_number + 1 + getRandomInt(TOTAL_EFFECTS - 1)) % TOTAL_EFFECTS;
        effect_triggered_total[effect_number]++;

        if (effect_number !== 1 && effect_number !== 2) opacity = 100;

        if (effect_number === 0) { // horizontal inversion
          hue += 0.5;
          sgn *= -1;
        }
        else if (effect_number === 1) { // scale forward then backward
          scale_ADSR_activation_time = time;
          scale_ADSR_deactivation_time = time;
          // center_point_x = getRandomInRange(0, work_width);
          // center_point_y = getRandomInRange(0, work_height);
          time_to_revert_opacity = time + scale_ADSR_attack;
        }
        else if (effect_number === 2) { // opacity
          time_to_revert_opacity = null;
          if (opacity === 100) opacity = 50;
          else if (opacity === 50) opacity = 0;
          else throw new Error("Effect #" + effect_number + " error: unexpected opacity (" + opacity + ")");
          // if (opacity === 100) opacity = 66;
          // else if (opacity === 66) opacity = 0;
          // else if (opacity === 0) opacity = 33;
          // else if (opacity === 33) opacity = 100;
          // else throw new Error("Effect #" + effect_number + " error: unexpected opacity (" + opacity + ")");
        }
        else if (effect_number === 3) { // jump in time
          var prev_pointer_index = pointer_index;
          var prev_pointer_number = pointers[pointer_index].number;

          // Инкрементируем счетчик для текущего поинтера ДО его возможного удаления
          pointers_counters[prev_pointer_number]++;

          var spliced = false;
          if (pointers[pointer_index].bounced_total) {
            pointers.splice(pointer_index, 1);
            spliced = true;
          }

          if (pointers.length <= POINTERS_LEFT_TO_STOP) {
            time_processing_stopped_at = time;
            break;
          }
          if (pointers.length === 0) {
            pointers = get_pointers();
            randomize_pointers(pointers);
            pointer_index = 0;
          }

          pointer_index = spliced
            ? prev_pointer_index
            : prev_pointer_index + 1;
          if (pointer_index >= pointers.length) {
            randomize_pointers(pointers);
            pointer_index = 0;

            pointer_sequences_stats[pointer_sequences_stats.length - 1].duration_minutes = (time - pointer_sequences_stats[pointer_sequences_stats.length - 1].start_time_seconds) / 60;
            pointer_sequences_stats.push({
              start_time_seconds: time,
              duration_minutes: -1,
              pointers_count: pointers.length,
            });
          }
          if (STOP_AFTER_FULL_SEQUENCES > 0 && randomize_pointers_called > STOP_AFTER_FULL_SEQUENCES) {
            time_processing_stopped_at = time;
            break;
          }

          if (pointers[pointer_index].number === prev_pointer_number) hue += (Math.random() < 0.5 ? +0.25 : +0.75);
          else hue = getRandomInRange(0, 1);

          current_position = pointers[pointer_index].current_position;
        }
      }

      var scale_ADSR_normalized = get_ADSR_amplitude(time, scale_ADSR_activation_time, scale_ADSR_deactivation_time, is_FX_active, scale_ADSR_attack, scale_ADSR_delay, scale_ADSR_sustain, scale_ADSR_release);
      var scale_ADSR_amplitude = scale_MAX_amplitude * scale_ADSR_normalized;
      var scale = 100 + scale_ADSR_amplitude;
      var signed_scale = sgn * scale;

      if (!warp_inputs) warp_inputs = window_stats;
      if (warp_inputs.max - warp_inputs.min !== 0) {
        S_WarpFishEye_Amount = lerp(
          0,
          S_WarpFishEye_Amount_neg_max,
          (input_C_value - warp_inputs.min) / (warp_inputs.max - warp_inputs.min)
        );
      } else S_WarpFishEye_Amount = 0;
      if (input_C_value <= warp_inputs.min) warp_inputs = undefined;

      hue = fract_abs(hue + hue_drift);

      /*
      В After Effects выражениях:
        Time Remap:
          thisComp.layer("beat").effect("script_output")("Color")[0];
        S_WarpFishEye Amount:
          thisComp.layer("beat").effect("script_output")("Color")[3];
        CC Composite (Transfer Mode = Luminosity) {after S_WarpFishEye and before S_HueSatBright} Opacity:
          thisComp.layer("beat").effect("script_output1")("Slider");
        BCC Hue-Sat-Lightness (режим "Color Space" = "HSLuma" - вроде как не портит яркость, по крайней мере если после посмотреть через Tint):
          thisComp.layer("beat").effect("script_output")("Color")[2];
        Transform Scale:
          signed_scale = thisComp.layer("beat").effect("script_output")("Color")[1]; // [100;200] | [-100;-200]
          [signed_scale, Math.abs(signed_scale)];
        Transform Anchor Point:
          center_x = thisComp.layer("beat").effect("script_output1")("Color")[1];
          center_y = thisComp.layer("beat").effect("script_output1")("Color")[2];
          signed_x_scale = thisComp.layer("beat").effect("script_output")("Color")[1];
          if (signed_x_scale < 0) center_x = thisComp.width - center_x; // это надо сделать либо для Anchor Point, либо для Position
          [center_x, center_y];
        Transform Position:
          center_x = thisComp.layer("beat").effect("script_output1")("Color")[1];
          center_y = thisComp.layer("beat").effect("script_output1")("Color")[2];
          [center_x, center_y];
      */
      frame_times[index_in_batch] = time;
      frame_output0_values[index_in_batch] = [current_position, signed_scale, hue * 360, S_WarpFishEye_Amount];
      frame_output1_values[index_in_batch] = opacity;
      // frame_output1_values[index_in_batch] = [opacity, center_point_x, center_point_y, 0];
    }

    var setValuesAtTimes_start_time = Date.now();
    // Если последняя порция неполная, не используем slice, т.к. в конце просто останутся старые значения из предыдущих итераций
    script_output0_control.setValuesAtTimes(frame_times, frame_output0_values);
    script_output1_control.setValuesAtTimes(frame_times, frame_output1_values);
    var setValuesAtTimes_end_time = Date.now();
    setValuesAtTimes_total_time += (setValuesAtTimes_end_time - setValuesAtTimes_start_time) / 1000;
    setValuesAtTimes_called_times++;
  }

  app.disableUpdates = false;
  app.project.suspendRendering = false;
  app.endUndoGroup();

  if (time_processing_stopped_at !== null) {
    app.beginUndoGroup("Set Playhead");
    beatComp.time = time_processing_stopped_at;
    app.endUndoGroup();
  }

  const script_end_time = Date.now();
  const script_total_time = (script_end_time - script_start_time) / 1000;

  const pointers_number_after = pointers.length;

  // var file = new File("~/Desktop/windows_stats_values.json");
  // file.open("w");
  // file.write(JSON.stringify(windows_stats_values, null, 2)); // null,2 — форматирование с отступами
  // file.close();
  // file.execute();

  const work_area_duration_minutes = (work_end_time - work_start_time) / 60;
  const video_duration_minutes = (video_end_time - video_start_time) / 60;
  const unique_accumulated_time_minutes = unique_accumulated_time / 60;
  const total_accumulated_time_minutes = total_accumulated_time / 60;
  const unique_to_total_ratio = total_accumulated_time > 0 ? unique_accumulated_time / total_accumulated_time : 0;
  const total_accumulated_time_per_effect3 = effect_triggered_total[3] > 0 ? total_accumulated_time / effect_triggered_total[3] : 0;
  const stopped_at_message = time_processing_stopped_at !== null ? "STOPPED AT " + time_processing_stopped_at + "\n" : "";
  const processed_duration_minutes = time_processing_stopped_at !== null ? time_processing_stopped_at / 60 : work_area_duration_minutes;

  // Формируем построчный вывод последовательностей
  function padTwoDigits(num) {
    var n = Math.floor(num % 100);
    return (n < 10 ? "0" : "") + n.toString();
  }
  function formatTime(seconds) {
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = Math.floor(seconds % 60);
    return padTwoDigits(hours) + ":" + padTwoDigits(minutes) + ":" + padTwoDigits(secs);
  }
  var pointer_sequences_stats_lines = [];
  for (var i = 0; i < pointer_sequences_stats.length; i++) {
    var seq = pointer_sequences_stats[i];
    var n = i + 1;
    var length_minutes = seq.duration_minutes.toFixed(1); // округление до 1 знака после запятой
    var start_time_formatted = formatTime(seq.start_time_seconds);
    pointer_sequences_stats_lines.push(start_time_formatted + " " + n + ": " + length_minutes + "мин, " + seq.pointers_count + "ук" + (i % 2 === 0 ? "\t" : "\n"));
  }
  var pointer_sequences_stats_output = pointer_sequences_stats_lines.length > 0
    ? "pointer_sequences_stats:\n" + pointer_sequences_stats_lines.join("") + "\n"
    : "pointer_sequences_stats: (empty)\n";

  alert(
    script_filename + "\n" +
    "script_total_time = " + script_total_time + "\n" +
    "setValuesAtTimes_total_time = " + setValuesAtTimes_total_time + "\n" +
    "setValuesAtTimes_called_times = " + setValuesAtTimes_called_times + "\n" +
    "frames_batch_size = " + frames_batch_size + "\n" +
    "inputs_ABC_max_value = " + inputs_ABC_max_value + "\n" +
    "inputs_ABC_min_value = " + inputs_ABC_min_value + "\n" +
    "deactivate_min_avg = " + deactivate_min_avg + "\n" +
    "activate_avg_max = " + activate_avg_max + "\n" +
    "scale_ADSR_attack = " + scale_ADSR_attack + "\n" +
    "scale_ADSR_delay = " + scale_ADSR_delay + "\n" +
    "scale_ADSR_sustain = " + scale_ADSR_sustain + "\n" +
    "scale_ADSR_release = " + scale_ADSR_release + "\n" +
    "scale_MAX_amplitude = " + scale_MAX_amplitude + "\n" +
    "speed_max = " + speed_max + "\n" +
    "speed_avg = " + speed_avg + "\n" +
    "speed_min = " + speed_min + "\n" +
    "S_WarpFishEye_Amount_neg_max = " + S_WarpFishEye_Amount_neg_max + "\n" +
    "S_WarpFishEye_Amount_pos_max = " + S_WarpFishEye_Amount_pos_max + "\n" +
    "desired_pointer_length_seconds = " + desired_pointer_length_seconds + "\n" +
    "STOP_AFTER_FULL_SEQUENCES = " + STOP_AFTER_FULL_SEQUENCES + "\n" +
    "time_remap_use_clips_for_pointers = " + time_remap_use_clips_for_pointers + "\n" +
    // "time_remap_fixed_pointers_order = " + time_remap_fixed_pointers_order + "\n" +
    "USE_WORKAREA_INSTEAD_OF_CLIPS = " + USE_WORKAREA_INSTEAD_OF_CLIPS + "\n" +
    (!USE_WORKAREA_INSTEAD_OF_CLIPS ? "USED_CLIPS_COUNT = " + video_clips_times.length + "\n" : "") +
    "POINTERS_LEFT_TO_STOP = " + POINTERS_LEFT_TO_STOP + "\n" +
    stopped_at_message +
    "bounced_total_max = " + bounced_total_max + "\n" +
    "hue_drift = " + hue_drift + "\n" +
    "auto_correction_window = " + auto_correction_window + "\n" +
    "get_pointers_called = " + get_pointers_called + "\n" +
    "randomize_pointers_called = " + randomize_pointers_called + "\n" +
    "pointers_number_before = " + pointers_number_before + "\n" +
    "pointers_number_after = " + pointers_number_after + "\n" +
    "unique_accumulated_time_minutes = " + unique_accumulated_time_minutes + "\n" +
    "unique_accumulated_time / video_duration = " + unique_accumulated_time_minutes / video_duration_minutes + "\n" +
    "video_duration_minutes = " + video_duration_minutes + "\n" +
    "then_unique_reach_video_duration = " + then_unique_reach_video_duration + "\n" +
    "unique_to_total_ratio = " + unique_to_total_ratio + "\n" +
    "total_accumulated_time_minutes = " + total_accumulated_time_minutes + "\n" +
    "total_accumulated_time_per_effect3 = " + total_accumulated_time_per_effect3 + "\n" +
    "total_accumulated_time / processed_duration = " + total_accumulated_time_minutes / processed_duration_minutes + "\n" +
    "processed_duration / video_duration = " + processed_duration_minutes / video_duration_minutes + "\n" +
    "processed_duration_minutes = " + processed_duration_minutes + "\n" +
    "FX_triggered_total = " + FX_triggered_total + "\n" +
    "FX_triggered_per_minute = " + FX_triggered_total / processed_duration_minutes + "\n" +
    "FX_triggered_avg_period_seconds = " + processed_duration_minutes * 60 / FX_triggered_total + "\n" +
    "effect_triggered_total = " + JSON.stringify(effect_triggered_total) + "\n" +
    "input_C_deactivation_value_equal_activation_value = " + input_C_deactivation_value_equal_activation_value + "\n" +
    "windows_stats_max_equal_min = " + windows_stats_max_equal_min + "\n" +
    "pointers_counters = " + JSON.stringify(pointers_counters) + "\n" +
    pointer_sequences_stats_output
  );

})();
