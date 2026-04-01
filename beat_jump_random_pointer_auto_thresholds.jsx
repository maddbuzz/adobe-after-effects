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

      if (
        (layer instanceof AVLayer && layer.source instanceof FootageItem && layer.source.mainSource instanceof FileSource && layer.source.mainSource.file) ||  // видеоклип из файла
        (layer instanceof AVLayer && layer.source instanceof CompItem)  // слой-композиция (прекомп)
      ) {
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

  /**
   * Пошаговый ограничитель скорости изменения сигнала (step slew rate limiter): один вызов = один кадр.
   * ВАЖНО: функцию нужно вызывать строго на каждом кадре, без пропусков — иначе ограничение скорости будет неверным
   * (в отличие от rc_signal, которую можно вызывать с любой периодичностью).
   *
   * @param input — входной сигнал (любое число, внутри ограничивается state.input_min, state.input_max).
   * @param state — объект с полями:
   *   input_min, input_max — границы входа (input_min <= input_max);
   *   attack_rate — макс. скорость роста выхода, единиц/сек (должен быть > 0);
   *   decay_rate — макс. скорость спада выхода, единиц/сек (должен быть > 0);
   *   frame_duration — длительность одного кадра в секундах (постоянная для данной композиции);
   *   last_output — предыдущее значение выхода (обязательно задать до первого вызова, иначе будет выброшена ошибка).
   * @returns output в пределах [input_min, input_max], который не меняется быстрее заданных скоростей.
   *
  function step_slew_limit_signal(input, state) {
    var clamped = clamp(input, state.input_min, state.input_max);
    if (state.last_output === undefined || state.frame_duration === undefined) {
      throw new Error("step_slew_limit_signal: предыдущее состояние обязательно: задайте state.last_output и state.frame_duration до первого вызова");
    }
    var dt = state.frame_duration;
    var max_rise = state.attack_rate * dt;
    var max_fall = state.decay_rate * dt;
    var out;
    if (clamped > state.last_output) {
      out = Math.min(clamped, state.last_output + max_rise);
    } else {
      out = Math.max(clamped, state.last_output - max_fall);
    }
    state.last_output = out;
    return out;
  }
  /* */

  /**
   * Эмуляция конденсатора (RC-фильтр первого порядка): выход экспоненциально стремится к входу.
   * input — входной сигнал (любое число, внутри ограничивается state.input_min, state.input_max).
   * time_seconds — текущее время в секундах; на каждом кадре должен быть не меньше значения на предыдущем вызове (вызовы без пропусков кадров).
   * state — объект с полями:
   *   tau — постоянная времени в секундах (должна быть > 0); чем больше tau, тем медленнее выход догоняет вход;
   *   input_min, input_max — границы входа и выхода (input_min <= input_max);
   *   last_output, last_time — предыдущее состояние (обязательно задать до первого вызова, иначе будет выброшена ошибка).
   * Возвращает output в пределах [input_min, input_max].
   */
  function rc_signal(input, time_seconds, state) {
    var clamped = clamp(input, state.input_min, state.input_max);
    if (state.last_time === undefined || state.last_output === undefined) {
      throw new Error("rc_signal: предыдущее состояние обязательно: задайте state.last_output и state.last_time до первого вызова");
    }
    var dt = time_seconds - state.last_time;
    var tau = state.tau;
    var coeff = 1 - Math.exp(-dt / tau);
    var out = state.last_output + (clamped - state.last_output) * coeff;
    state.last_output = out;
    state.last_time = time_seconds;
    return out;
  }

  function getBaseLog(x, y) {
    return Math.log(y) / Math.log(x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Линейный сглаженный переход значения в [0, 1] к целевому 0 или 1.
   * Цель 1: если задано reference_time_sec и с этого момента прошло не меньше
   * delay_after_reference_sec секунд; иначе цель 0. При reference_time_sec === null цель всегда 0.
   * Длительность участка ramp: |transition_target − value_at_ramp_start| × (полное время полного хода 0→1 или 1→0).
   * Мутирует state. Один вызов на кадр; value_previous_frame — значение с предыдущего кадра.
   */
  function transition_010_step(
    value_previous_frame,
    state,
    current_time_sec,
    reference_time_sec,
    delay_after_reference_sec,
    full_ramp_up_duration_sec,
    full_ramp_down_duration_sec
  ) {
    var transition_target = 0;
    if (reference_time_sec !== null) {
      var elapsed_since_reference_sec = current_time_sec - reference_time_sec;
      transition_target = elapsed_since_reference_sec >= delay_after_reference_sec ? 1 : 0;
    }
    if (transition_target !== state.committed_transition_target) {
      state.ramp_start_time_sec = current_time_sec;
      state.value_at_ramp_start = value_previous_frame;
      state.committed_transition_target = transition_target;
    }
    var distance_to_target = Math.abs(transition_target - state.value_at_ramp_start);
    var chosen_full_ramp_duration_sec =
      transition_target === 1 ? full_ramp_up_duration_sec : full_ramp_down_duration_sec;
    var ramp_duration_sec = distance_to_target * chosen_full_ramp_duration_sec;
    if (ramp_duration_sec <= 0) {
      return transition_target;
    }
    var ramp_t = Math.min(
      1,
      (current_time_sec - state.ramp_start_time_sec) / ramp_duration_sec
    );
    return lerp(state.value_at_ramp_start, transition_target, ramp_t);
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

  function showScrollableDialog(title, message, scrollWidth, scrollHeight, innerMargin) {
    var textAreaWidth = scrollWidth - innerMargin;
    var textAreaHeight = scrollHeight - innerMargin;

    var win = new Window("dialog", title);
    win.orientation = "column";
    win.alignChildren = "fill";

    var scrollGroup = win.add("group");
    scrollGroup.orientation = "column";
    scrollGroup.alignChildren = "fill";
    scrollGroup.preferredSize.width = scrollWidth;
    scrollGroup.preferredSize.height = scrollHeight;

    var textArea = scrollGroup.add("edittext", undefined, message, { multiline: true, scrolling: true, readonly: true });
    textArea.preferredSize.width = textAreaWidth;
    textArea.preferredSize.height = textAreaHeight;

    var buttonGroup = win.add("group");
    buttonGroup.alignment = "center";
    var okButton = buttonGroup.add("button", undefined, "OK");
    okButton.onClick = function () { win.close(); };

    win.show();
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
    // У 3D Point Control matchName эффекта ADBE Point3D Control, а имя единственного параметра — "3D Point", не "Point3D".
    var property_name = type === "Point3D" ? "3D Point" : type;
    var effect = layer.effect(control_name);
    if (!effect) {
      var adbe_type = "ADBE " + type + " Control";
      effect = layer.Effects.addProperty(adbe_type);
      effect.name = control_name;
      if (default_value !== undefined) effect.property(property_name).setValue(default_value);
    }
    return effect.property(property_name); // <- возвращаем property, а не effect - иначе setValuesAtTimes работать не будет!
  }

  function set_effect_marker_on_layer(layer, time, effect_number, is_stop) {
    // labelIndex цвет? (зависит от Preferences > Labels): 1=Red, 2=Yellow, 3=Green, 4=Blue
    var labelIndex = is_stop ? 0 : effect_number;

    var comment = is_stop ? ("s" + String(effect_number)) : String(effect_number);
    var markerProp = layer.marker;
    var markerVal = new MarkerValue(comment, 0);
    if (typeof markerVal.label !== "undefined") markerVal.label = labelIndex;
    markerProp.setValueAtTime(time, markerVal);
    var keyIdx = markerProp.nearestKeyIndex(time);
    if (keyIdx >= 1) {
      if (typeof markerProp.setLabelAtKey === "function") {
        markerProp.setLabelAtKey(keyIdx, labelIndex);
      } else if (markerProp.propertySpec && typeof markerProp.propertySpec.setLabelAtKey === "function") {
        markerProp.propertySpec.setLabelAtKey(keyIdx, labelIndex);
      }
    }
  }

  function remove_all_markers_from_layer(layer) {
    var comp = layer.containingComp;
    var work_start = comp.workAreaStart;
    var work_end = comp.workAreaStart + comp.workAreaDuration;
    var markerProp = layer.marker;
    for (var i = markerProp.numKeys; i >= 1; i--) {
      var t = markerProp.keyTime(i);
      if (t >= work_start && t < work_end) {
        markerProp.removeKey(i);
      }
    }
  }

  /* *
  function format_2_hh_mm_ss_ff(seconds, frame_duration) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    var fps = Math.round(1 / frame_duration);
    var ff = Math.round(seconds / frame_duration) % fps;
    return padTwoDigits(h) + ":" + padTwoDigits(m) + ":" + padTwoDigits(s) + ":" + padTwoDigits(ff);
  }
  /* */

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
  const work_end_time = beatComp.workAreaStart + beatComp.workAreaDuration;
  const work_total_frames = beatComp.workAreaDuration * beatComp.frameRate;
  const work_width = beatComp.width;
  const work_height = beatComp.height;

  create_new_or_return_existing_control(beat_layer, "frames_batch_size", "Slider", 5000);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_max_value", "Slider", 2.0);
  create_new_or_return_existing_control(beat_layer, "inputs_ABC_min_value", "Slider", 0.0);
  create_new_or_return_existing_control(beat_layer, "deactivate_min_avg", "Slider", 1.0); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "activate_avg_max", "Slider", 0.5); // [0, 1]
  create_new_or_return_existing_control(beat_layer, "REGULAR_FX_MIN_ACTIVATION_INTERVAL", "Slider", 0.2); // (60s / 180bpm / 4) = 0.08333 на 1/16 при 180bpm (5 кадров при 60к/c)
  create_new_or_return_existing_control(beat_layer, "FORCE_DEACTIVATE_FX_AFTER", "Slider", 0.2); // сек; 0 = не принуждать
  create_new_or_return_existing_control(beat_layer, "auto_correction_window", "Slider", 60); // seconds
  create_new_or_return_existing_control(beat_layer, "scale_MAX_amplitude", "Slider", 100);
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_attack", "Slider", 0.0); // 0.1 seconds ?
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_delay", "Slider", 0.1); // 0.1 seconds ?
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_sustain", "Slider", 0.0); // 0.0 normalized amplitude [0, 1]
  create_new_or_return_existing_control(beat_layer, "scale_ADSR_release", "Slider", 0.0); // 0.0 seconds
  create_new_or_return_existing_control(beat_layer, "speed_max", "Slider", 9.0); // 1 + (7 / 1.25) * 2 === 12.2
  create_new_or_return_existing_control(beat_layer, "speed_avg", "Slider", 3.0);
  create_new_or_return_existing_control(beat_layer, "speed_min", "Slider", 1.0);
  create_new_or_return_existing_control(beat_layer, "S_WarpFishEye_Amount_neg_max", "Slider", -0.25);
  create_new_or_return_existing_control(beat_layer, "desired_pointer_length_seconds", "Slider", 0);
  create_new_or_return_existing_control(beat_layer, "RANDOMIZE_POINTERS_BEFORE_START", "Checkbox", true);
  create_new_or_return_existing_control(beat_layer, "POINTERS_SEQUENCE_SIZE", "Slider", 4); // при 60 эффектах/минуту (и 4 эффектах всего) будет в среднем 60/4=15 переключений указателей в минуту
  create_new_or_return_existing_control(beat_layer, "DONT_SHUFFLE_FIRST_SEQUENCE", "Checkbox", true);
  create_new_or_return_existing_control(beat_layer, "ELAPSED_BEFORE_BOUNCE_FWD", "Slider", 1.0);
  create_new_or_return_existing_control(beat_layer, "ELAPSED_BEFORE_BOUNCE_BWD", "Slider", 0.2);
  create_new_or_return_existing_control(beat_layer, "MIN_BOUNCES_TO_REMOVE_POINTER", "Slider", 1); // дефолт 1
  create_new_or_return_existing_control(beat_layer, "DONT_REMOVE_POINTERS_BELOW", "Slider", 4); // если больше 0, нужно включить STOP_IF_ONLY_BOUNCED_LEFT
  create_new_or_return_existing_control(beat_layer, "STOP_IF_ONLY_BOUNCED_LEFT", "Checkbox", true); // нужно включить, если DONT_REMOVE_POINTERS_BELOW > 0
  create_new_or_return_existing_control(beat_layer, "STOP_AFTER_SEQUENCES", "Slider", 0);
  create_new_or_return_existing_control(beat_layer, "time_remap_use_clips_for_pointers", "Checkbox", true); // if true then desired_pointer_length_seconds is used for ONE clip
  create_new_or_return_existing_control(beat_layer, "USE_WORKAREA_INSTEAD_OF_CLIPS", "Checkbox", false);
  create_new_or_return_existing_control(beat_layer, "POINTERS_LEFT_TO_STOP", "Slider", 0);
  create_new_or_return_existing_control(beat_layer, "hue_drift", "Slider", 0.000278);
  create_new_or_return_existing_control(beat_layer, "SET_FX_MARKERS", "Checkbox", false);
  create_new_or_return_existing_control(beat_layer, "SET_FX_STOP_MARKERS", "Checkbox", false);
  create_new_or_return_existing_control(beat_layer, "CLEAR_FX_MARKERS", "Checkbox", false);
  create_new_or_return_existing_control(beat_layer, "XRAY_SILENCE_TIME_BEFORE_ACTIVATION", "Slider", 2);
  create_new_or_return_existing_control(beat_layer, "XRAY_ACTIVATION_TRANSITION_TIME", "Slider", 1);
  create_new_or_return_existing_control(beat_layer, "XRAY_DEACTIVATION_TRANSITION_TIME", "Slider", 0);

  // эти значения ниже будут считаны из слайдеров только один раз (для времени comp.time, соответсвующего положению playhead):
  const frames_batch_size = beat_layer.effect("frames_batch_size")("Slider").value;
  const inputs_ABC_max_value = beat_layer.effect("inputs_ABC_max_value")("Slider").value;
  const inputs_ABC_min_value = beat_layer.effect("inputs_ABC_min_value")("Slider").value;
  const deactivate_min_avg = beat_layer.effect("deactivate_min_avg")("Slider").value;
  const activate_avg_max = beat_layer.effect("activate_avg_max")("Slider").value;
  const REGULAR_FX_MIN_ACTIVATION_INTERVAL = beat_layer.effect("REGULAR_FX_MIN_ACTIVATION_INTERVAL")("Slider").value;
  const FORCE_DEACTIVATE_FX_AFTER = beat_layer.effect("FORCE_DEACTIVATE_FX_AFTER")("Slider").value;
  const auto_correction_window = beat_layer.effect("auto_correction_window")("Slider").value;
  const scale_MAX_amplitude = beat_layer.effect("scale_MAX_amplitude")("Slider").value;
  const scale_ADSR_attack = beat_layer.effect("scale_ADSR_attack")("Slider").value;
  const scale_ADSR_delay = beat_layer.effect("scale_ADSR_delay")("Slider").value;
  const scale_ADSR_sustain = beat_layer.effect("scale_ADSR_sustain")("Slider").value;
  const scale_ADSR_release = beat_layer.effect("scale_ADSR_release")("Slider").value;
  const speed_max = beat_layer.effect("speed_max")("Slider").value;
  const speed_avg = beat_layer.effect("speed_avg")("Slider").value;
  const speed_min = beat_layer.effect("speed_min")("Slider").value;
  const S_WarpFishEye_Amount_neg_max = beat_layer.effect("S_WarpFishEye_Amount_neg_max")("Slider").value;
  const desired_pointer_length_seconds = beat_layer.effect("desired_pointer_length_seconds")("Slider").value;
  const RANDOMIZE_POINTERS_BEFORE_START = beat_layer.effect("RANDOMIZE_POINTERS_BEFORE_START")("Checkbox").value;
  const POINTERS_SEQUENCE_SIZE = beat_layer.effect("POINTERS_SEQUENCE_SIZE")("Slider").value;
  const DONT_SHUFFLE_FIRST_SEQUENCE = beat_layer.effect("DONT_SHUFFLE_FIRST_SEQUENCE")("Checkbox").value;
  const ELAPSED_BEFORE_BOUNCE_FWD = beat_layer.effect("ELAPSED_BEFORE_BOUNCE_FWD")("Slider").value;
  const ELAPSED_BEFORE_BOUNCE_BWD = beat_layer.effect("ELAPSED_BEFORE_BOUNCE_BWD")("Slider").value;
  const MIN_BOUNCES_TO_REMOVE_POINTER = beat_layer.effect("MIN_BOUNCES_TO_REMOVE_POINTER")("Slider").value;
  const DONT_REMOVE_POINTERS_BELOW = beat_layer.effect("DONT_REMOVE_POINTERS_BELOW")("Slider").value;
  const STOP_IF_ONLY_BOUNCED_LEFT = beat_layer.effect("STOP_IF_ONLY_BOUNCED_LEFT")("Checkbox").value;
  const STOP_AFTER_SEQUENCES = beat_layer.effect("STOP_AFTER_SEQUENCES")("Slider").value;
  const time_remap_use_clips_for_pointers = beat_layer.effect("time_remap_use_clips_for_pointers")("Checkbox").value;
  const USE_WORKAREA_INSTEAD_OF_CLIPS = beat_layer.effect("USE_WORKAREA_INSTEAD_OF_CLIPS")("Checkbox").value;
  const POINTERS_LEFT_TO_STOP = beat_layer.effect("POINTERS_LEFT_TO_STOP")("Slider").value;
  const hue_drift = beat_layer.effect("hue_drift")("Slider").value;
  const SET_FX_MARKERS = beat_layer.effect("SET_FX_MARKERS")("Checkbox").value;
  const SET_FX_STOP_MARKERS = beat_layer.effect("SET_FX_STOP_MARKERS")("Checkbox").value;
  const CLEAR_FX_MARKERS = beat_layer.effect("CLEAR_FX_MARKERS")("Checkbox").value;
  const XRAY_SILENCE_TIME_BEFORE_ACTIVATION = beat_layer.effect("XRAY_SILENCE_TIME_BEFORE_ACTIVATION")("Slider").value;
  const XRAY_ACTIVATION_TRANSITION_TIME = beat_layer.effect("XRAY_ACTIVATION_TRANSITION_TIME")("Slider").value;
  const XRAY_DEACTIVATION_TRANSITION_TIME = beat_layer.effect("XRAY_DEACTIVATION_TRANSITION_TIME")("Slider").value;

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
  create_new_or_return_existing_control(beat_layer, "script_output012", "Point3D");
  create_new_or_return_existing_control(beat_layer, "script_output345", "Point3D");
  create_new_or_return_existing_control(beat_layer, "script_output678", "Point3D");
  const script_output012_control = beat_layer.effect("script_output012")("3D Point");
  const script_output345_control = beat_layer.effect("script_output345")("3D Point");
  const script_output678_control = beat_layer.effect("script_output678")("3D Point");

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
        target_position: end,
        direction: +1,
        bounced_total: 0,
        last_bounce_time: null,
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
        last_pointer.target_position = end;
        break;
      }

      pointers.push({
        number: index + index_offset,
        starting_position: current_time,
        current_position: current_time,
        target_position: current_time + desired_length_seconds,
        direction: +1,
        bounced_total: 0,
        last_bounce_time: null,
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

  // Алгоритм Фишера-Йетса для случайной перетасовки массива
  function fisher_yates_shuffle(array, shuffle_size) {
    if (shuffle_size === undefined) shuffle_size = 0; // В ExtendScript (ES3) значения по умолчанию в параметрах функций не поддерживаются
    // Если shuffle_size > 0 и меньше длины массива, тасует только первые shuffle_size элементов
    var size_to_shuffle = (shuffle_size > 0 && shuffle_size < array.length) ? shuffle_size : array.length;
    for (var i = size_to_shuffle - 1; i > 0; i--) {
      var j = getRandomInt(i + 1); // j от 0 до i включительно (правильный Фишер-Йетс)
      var temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  var randomize_pointers_called = 0;
  function randomize_pointers(pointers, shuffle_size) {
    if (shuffle_size === undefined) shuffle_size = 0; // В ExtendScript (ES3) значения по умолчанию в параметрах функций не поддерживаются
    randomize_pointers_called++;
    fisher_yates_shuffle(pointers, shuffle_size);
    return pointers;
  }

  function all_pointers_bounced(pointers, min_bounces) {
    if (min_bounces === undefined) min_bounces = 1; // В ExtendScript (ES3) значения по умолчанию в параметрах функций не поддерживаются
    for (var i = 0; i < pointers.length; i++) {
      if (pointers[i].bounced_total < min_bounces) return false;
    }
    return true;
  }

  function get_random_permutation(last) {
    // Возвращает случайную перестановку всех элементов от 0 до last включительно
    var array = [];
    for (var i = 0; i <= last; i++) {
      array.push(i);
    }
    return fisher_yates_shuffle(array);
  }

  var pointers = get_pointers();
  if (DONT_SHUFFLE_FIRST_SEQUENCE) {
    var first_sequence = pointers.splice(0, POINTERS_SEQUENCE_SIZE);
    if (RANDOMIZE_POINTERS_BEFORE_START) randomize_pointers(pointers);
    for (var i = first_sequence.length - 1; i >= 0; i--) pointers.unshift(first_sequence[i]);
  } else {
    if (RANDOMIZE_POINTERS_BEFORE_START) randomize_pointers(pointers);
    else randomize_pointers(pointers, POINTERS_SEQUENCE_SIZE);
  }
  var pointer_index = 0; // getRandomInt(pointers.length);
  var pointers_played_in_sequence = 0;

  var pointer_sequences_stats = [{
    start_time_seconds: work_start_time,
    duration_minutes: -1,
    pointers_count: pointers.length,
    real_sequence_size: POINTERS_SEQUENCE_SIZE,
  }];
  const pointers_number_before = pointers.length;
  const pointers_counters = []; for (var i = 0; i < pointers_number_before; i++) pointers_counters[i] = 0;
  var bounced_total_max = 0;
  var bounced_total_max_time = null;
  var all_pointers_bounced_once_at = null;

  var unique_accumulated_time = 0;
  var total_accumulated_time = 0;
  var then_unique_reach_video_duration = null;
  var hue = getRandomInRange(0, 1);
  var sgn = +1;

  var effect_sequence = {
    // 1: scale forward then backward, 2: horizontal inversion, 3: jump in time, 4: (bcc_mixed_colors + 3)
    queue: fisher_yates_shuffle([1, 2, 3, 4]), // !!!
    index: 0,
    effect_triggered_total: [],
  };
  var effect_number = undefined;

  /**
   * effect_sequence: { queue: Array, index: number }.
   * Следующий номер эффекта из текущей перетасовки; когда index дошёл до конца очереди — снова fisher_yates_shuffle(queue), index = 0.
   */
  function next_from_shuffled_cycle(effect_sequence) {
    var queue = effect_sequence.queue;

    if (effect_sequence.index >= queue.length) {
      fisher_yates_shuffle(queue);
      effect_sequence.index = 0;
    }

    if (!effect_sequence.effect_triggered_total[effect_sequence.index]) effect_sequence.effect_triggered_total[effect_sequence.index] = 0;
    effect_sequence.effect_triggered_total[effect_sequence.index]++;

    return queue[effect_sequence.index++];
  }

  var FX_triggered_total = 0;
  var is_FX_active = false;
  var last_FX_activation_time = null;
  // var use_quickFX_instead_of_regular = false;
  var FX_triggered_but_skipped = 0;
  const windows_stats_values = [];

  var use_both_FX1_variants = false;
  var use_2nd_FX1_variant = false;

  var bcc_mixed_colors = 0;
  
  var bcc_x_ray = 0;
  var bcc_x_ray_state = {
    committed_transition_target: 0,
    ramp_start_time_sec: work_start_time,
    value_at_ramp_start: bcc_x_ray,
  };

  var opacity = 100;

  var scale_ADSR_activation_time = null;
  var scale_ADSR_deactivation_time = null;

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
  const frame_output012_values = new Array(frames_batch_size);
  const frame_output345_values = new Array(frames_batch_size);
  const frame_output678_values = new Array(frames_batch_size);

  // графики строятся в get_spd_from_src.plot.html
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

  if (CLEAR_FX_MARKERS) remove_all_markers_from_layer(beat_layer);

  /*
  var scale_rate_limit_state = {
    input_min: 100,
    input_max: 100 + scale_MAX_amplitude,
    attack_rate: scale_MAX_amplitude / 0.1,
    decay_rate: scale_MAX_amplitude / 0.1,
    frame_duration: frame_duration,
    last_output: 100,
  };
      var rate_limited_scale = step_slew_limit_signal(scale, scale_rate_limit_state);
      var signed_scale = sgn * rate_limited_scale;
  */

  var scale_rc_signal_state = {
    input_min: 100,
    input_max: 100 + scale_MAX_amplitude,
    // tau: 0.144, // на выходе было 100, а на входе стало 200 - при каком тау будет достигнуто 150 за 0.1 секунды (τ ≈ 0.144 с)
    tau: 0.072, // на выходе было 100, а на входе стало 200 - при каком тау будет достигнуто 150 за 0.05 секунды (τ ≈ 0.072 с)
    // tau: 0.036,
    last_output: 100,
    last_time: work_start_time - frame_duration,
  };

  var time_processing_stopped_at = null;
  var time_pointers_reach_threshold = null;
  var time_only_bounced_left = null;
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
      // rate_limited_input_C_value = step_slew_limit_signal(input_C_value, input_C_rate_limit_state);

      if (!is_FX_active) {
        // input_C_activation_value = lerp(window_stats.avg, window_stats.max, activate_avg_max); // TODO ?
        input_C_activation_value = activate_avg_max * inputs_ABC_max_value; // TODO ? название activate_avg_max не подходит при таком использовании - И ВООБЩЕ ЭТО СТАТИЧНОЕ ЗНАЧЕНИЕ получается
      }

      if (!speed_inputs) speed_inputs = window_stats;
      if (input_C_value <= speed_inputs.min || input_C_value >= speed_inputs.max) speed_inputs = window_stats;
      var speed_output = (speed_inputs.min === speed_inputs.max)
        ? speed_min
        : get_spd_from_src(input_C_value, speed_inputs.min, speed_inputs.avg, speed_inputs.max, speed_min, speed_avg, speed_max);

      var starting_position = pointers[pointer_index].starting_position;
      var target_position = pointers[pointer_index].target_position;
      var current_position = pointers[pointer_index].current_position;
      var old_current_position = current_position;
      var old_bounced_total = pointers[pointer_index].bounced_total;
      var direction = pointers[pointer_index].direction;
      var time_increment = frame_duration * speed_output;
      current_position += time_increment * direction;
      if (current_position >= target_position) {
        current_position = target_position - frame_duration;
        if (direction > 0) {
          pointers[pointer_index].bounced_total++;
          pointers[pointer_index].last_bounce_time = time;
        }
        pointers[pointer_index].direction = -1;
      }
      if (current_position <= starting_position) {
        current_position = starting_position + frame_duration; // "+ frame_duration" потому что был случай, когда показывался при баунсе последний кадр предыдущего клипа в таймлайне
        if (direction < 0) {
          pointers[pointer_index].bounced_total++;
          pointers[pointer_index].last_bounce_time = time;
        }
        pointers[pointer_index].direction = +1;
      }
      if (bounced_total_max < pointers[pointer_index].bounced_total) {
        bounced_total_max = pointers[pointer_index].bounced_total;
        bounced_total_max_time = time;
      }
      if (all_pointers_bounced_once_at === null && all_pointers_bounced(pointers, 1)) all_pointers_bounced_once_at = time;
      if (all_pointers_bounced(pointers, MIN_BOUNCES_TO_REMOVE_POINTER)) {
        if (time_only_bounced_left === null) time_only_bounced_left = time;
        if (STOP_IF_ONLY_BOUNCED_LEFT) {
          time_processing_stopped_at = time;
          break;
        }
      }
      pointers[pointer_index].current_position = current_position;

      var position_diff = Math.abs(current_position - old_current_position);
      unique_accumulated_time += (old_bounced_total ? 0 : position_diff);
      total_accumulated_time += position_diff;
      if (then_unique_reach_video_duration === null && unique_accumulated_time >= (video_end_time - video_start_time)) then_unique_reach_video_duration = time;

      var FX_triggered = false;

      var fx_force_deactivate =
        FORCE_DEACTIVATE_FX_AFTER > 0 &&
        last_FX_activation_time !== null &&
        time - last_FX_activation_time >= FORCE_DEACTIVATE_FX_AFTER;
      if (
        is_FX_active &&
        (fx_force_deactivate || input_C_value <= input_C_deactivation_value)
      ) {
        is_FX_active = false;
        if (SET_FX_STOP_MARKERS) set_effect_marker_on_layer(beat_layer, time, effect_number, true);
      }
      if ((!is_FX_active) && (input_C_value >= input_C_activation_value)) {
        // Порог деактивации между min и avg окна; deactivate_min_avg задаёт позицию на этом отрезке.
        input_C_deactivation_value = lerp(window_stats.min, window_stats.avg, deactivate_min_avg);
        // Альтернатива: между avg окна и текущим порогом активации (середина).
        // input_C_deactivation_value = lerp(window_stats.avg, input_C_activation_value, 0.5);

        if (input_C_deactivation_value >= input_C_activation_value) {
          throw new Error("input_C_deactivation_value >= input_C_activation_value: " + "\n" + input_C_deactivation_value + " >= " + input_C_activation_value);
          input_C_deactivation_value_equal_activation_value++; // TODO skip if so ?
        } else {
          FX_triggered_total++;
          // Проверяем, прошло ли достаточно времени с момента последней активации
          if ((last_FX_activation_time !== null) && (time - last_FX_activation_time < REGULAR_FX_MIN_ACTIVATION_INTERVAL)) {
            // use_quickFX_instead_of_regular = true;
            FX_triggered_but_skipped++;
          } else {
            // use_quickFX_instead_of_regular = false;

            last_FX_activation_time = time; // запоминаем время активации
            is_FX_active = true;
            FX_triggered = true;
          }
        }
      }

      if (FX_triggered) {
        if (pointers[pointer_index].bounced_total && pointers[pointer_index].bounced_total === old_bounced_total) {
          var elapsed_since_last_bounce = time - pointers[pointer_index].last_bounce_time;
          if (
            (pointers[pointer_index].direction > 0 && elapsed_since_last_bounce >= ELAPSED_BEFORE_BOUNCE_BWD) ||
            (pointers[pointer_index].direction < 0 && elapsed_since_last_bounce >= ELAPSED_BEFORE_BOUNCE_FWD)
          ) {
            pointers[pointer_index].direction *= -1;
            pointers[pointer_index].bounced_total++; // это тоже баунс, хоть и не от краев
            pointers[pointer_index].last_bounce_time = time;
          }
        }

        var prev_effect_number = effect_number; // ! для 3, 4, 5 prev_effect_number будет 3 
        // 1: scale forward then backward, 2: horizontal inversion, 3: jump in time, 4: (bcc_mixed_colors + 3)
        effect_number = next_from_shuffled_cycle(effect_sequence);

        if (SET_FX_MARKERS) set_effect_marker_on_layer(beat_layer, time, effect_number);

        /**/
        if (effect_number === 3) { // ???
          bcc_mixed_colors = 0;
        }
        if (effect_number === 4) {
          if (bcc_mixed_colors === 0) bcc_mixed_colors = 1;
          else if (bcc_mixed_colors === 1) bcc_mixed_colors = 0;
          else throw new Error("Effect #" + effect_number + " error: unexpected value (" + bcc_mixed_colors + ")");
          effect_number = 3; // ! для 3, 4, 5 prev_effect_number будет 3 
        }
        /**/

        if (effect_number !== 1) { // opacity
          if (opacity === 100) opacity = 75;
          else if (opacity === 75) opacity = 50;
          else if (opacity === 50) opacity = 100;
          else throw new Error("Effect #" + effect_number + " error: unexpected opacity (" + opacity + ")");
        }

        if (effect_number === 1) { // scale forward then backward
          // if (prev_effect_number === 1) sgn *= -1; // TODO ?
          // use_2nd_FX1_variant = !use_2nd_FX1_variant; // TODO ?
          // use_both_FX1_variants = (prev_effect_number === 1); // TODO ?
          // use_both_FX1_variants = !use_both_FX1_variants; // TODO ?
          scale_ADSR_activation_time = time;
          scale_ADSR_deactivation_time = time;
        }
        else if (effect_number === 2) { // horizontal inversion
          sgn *= -1;
          if (prev_effect_number !== 2)
            hue += 0.5;
          else
            hue += (Math.random() < 0.5 ? +0.25 : +0.75);
        }
        else if (effect_number === 3) { // jump in time
          var prev_pointer_number = pointers[pointer_index].number;

          // Инкрементируем счетчик для текущего поинтера ДО его возможного удаления
          pointers_counters[prev_pointer_number]++;

          var spliced = false;
          // if (pointers[pointer_index].bounced_total >= MIN_BOUNCES_TO_REMOVE_POINTER) {
          if (old_bounced_total >= MIN_BOUNCES_TO_REMOVE_POINTER) {
            if (pointers.length > DONT_REMOVE_POINTERS_BELOW) {
              pointers.splice(pointer_index, 1);
              spliced = true;
            } else {
              if (time_pointers_reach_threshold === null) time_pointers_reach_threshold = time;
            }
          }
          if (!spliced) pointer_index += 1; // не увеличиваем, если вырезали сегмент, т.к. на его место встал следующий...
          pointers_played_in_sequence += 1; // ...а вот счетчик сыгранных увеличиваем всегда!

          if (pointers.length <= POINTERS_LEFT_TO_STOP) {
            time_processing_stopped_at = time;
            break;
          }

          if (pointers.length === 0) {
            pointers = get_pointers();
            randomize_pointers(pointers, POINTERS_SEQUENCE_SIZE);
            pointer_index = 0;
            pointers_played_in_sequence = 0;
          }

          var real_sequence_size = POINTERS_SEQUENCE_SIZE > 0
            ? Math.min(POINTERS_SEQUENCE_SIZE, pointers.length)
            : pointers.length;
          if (pointer_index >= real_sequence_size || pointers_played_in_sequence >= real_sequence_size) {
            do {
              randomize_pointers(pointers, POINTERS_SEQUENCE_SIZE);
              pointer_index = 0;
              pointers_played_in_sequence = 0;
            } while (pointers.length > 1 && pointers[pointer_index].number === prev_pointer_number);

            pointer_sequences_stats[pointer_sequences_stats.length - 1].duration_minutes = (time - pointer_sequences_stats[pointer_sequences_stats.length - 1].start_time_seconds) / 60;
            pointer_sequences_stats.push({
              start_time_seconds: time,
              duration_minutes: -1,
              pointers_count: pointers.length,
              real_sequence_size: real_sequence_size,
            });
          }

          if (STOP_AFTER_SEQUENCES > 0 && randomize_pointers_called > STOP_AFTER_SEQUENCES) {
            time_processing_stopped_at = time;
            break;
          }

          if (pointers[pointer_index].number === prev_pointer_number) hue += (Math.random() < 0.5 ? +0.25 : +0.75); // ?
          else hue = getRandomInRange(0, 1);

          // +frame_duration потому что бывали случаи, что при переключении на свежий пойнтер показывался (вместо 1ого) -1ый кадр (чужой!):
          if (pointers[pointer_index].current_position === pointers[pointer_index].starting_position) pointers[pointer_index].current_position += frame_duration;
          current_position = pointers[pointer_index].current_position;
        }
      }

      /* */
      var scale_ADSR_normalized = get_ADSR_amplitude(time, scale_ADSR_activation_time, scale_ADSR_deactivation_time, is_FX_active, scale_ADSR_attack, scale_ADSR_delay, scale_ADSR_sustain, scale_ADSR_release);
      var scale_ADSR_amplitude = scale_MAX_amplitude * scale_ADSR_normalized;
      var scale_ADSR = 100 + scale_ADSR_amplitude;

      var scale_input = effect_number !== 1
        ? 100
        : lerp(
          100,
          100 + scale_MAX_amplitude,
          (input_C_value - inputs_ABC_min_value) / (inputs_ABC_max_value - inputs_ABC_min_value),
        );
      var scale_rc_signal = rc_signal(scale_input, time, scale_rc_signal_state);

      /* */
      var signed_scale = sgn * scale_ADSR;
      /* *
      var signed_scale = use_2nd_FX1_variant
        ? sgn * scale_rc_signal
        : sgn * scale_ADSR;
      /* *
      if (effect_number !== 1) use_both_FX1_variants = false;
      var signed_scale = use_both_FX1_variants
        ? sgn * Math.max(scale_ADSR, scale_rc_signal)
        : sgn * scale_ADSR;
      /* */

      /* TODO ? *
      if (!warp_inputs) warp_inputs = window_stats;
      if (input_C_value <= warp_inputs.min || input_C_value >= warp_inputs.max) warp_inputs = window_stats;
      if (warp_inputs.max - warp_inputs.min !== 0) {
        S_WarpFishEye_Amount = lerp(
          0,
          S_WarpFishEye_Amount_neg_max,
          (input_C_value - warp_inputs.min) / (warp_inputs.max - warp_inputs.min)
        );
      } else S_WarpFishEye_Amount = 0;
      /* */
      S_WarpFishEye_Amount = lerp(
        0,
        S_WarpFishEye_Amount_neg_max,
        (input_C_value - inputs_ABC_min_value) / (inputs_ABC_max_value - inputs_ABC_min_value),
      );
      /* */

      hue = fract_abs(hue + hue_drift);

      bcc_x_ray = transition_010_step(
        bcc_x_ray,
        bcc_x_ray_state,
        time,
        last_FX_activation_time,
        XRAY_SILENCE_TIME_BEFORE_ACTIVATION,
        XRAY_ACTIVATION_TRANSITION_TIME,
        XRAY_DEACTIVATION_TRANSITION_TIME
      );

      /* В After Effects выражениях (три 3D Point: script_output012 / script_output345 / script_output678):

      Time Remap
        thisComp.layer("beat").effect("script_output012")("3D Point")[0];

      Effects
        S_WarpFishEye
          Amount:
            thisComp.layer("beat").effect("script_output345")("3D Point")[0];
        S_BlurMotion
          From Z Dist: 1
          To Z Dist: 0.9
          Exposure Bias: 0
        CC Composite
          Opacity:
            thisComp.layer("beat").effect("script_output345")("3D Point")[1];
          Transfer Mode: Luminosity
        BCC+X-Ray
          Mix with Original
            bcc_x_ray = thisComp.layer("beat").effect("script_output345")("3D Point")[2];
            (1 - bcc_x_ray) * 100;
        BCC Hue-Sat-Lightness
          Color Space: HSLuma (вроде как не портит яркость, по крайней мере если после посмотреть через Tint)
          Hue:
            thisComp.layer("beat").effect("script_output012")("3D Point")[2];
        BCC Mixed Colors
          Scale X: 1, 1000
          Detail: 10
          Coarseness: 10
          Mutation: -1000, +1000
            Math.sin(0.0005 * time) * 1000;
          Opacity: 0, 100
            bcc_mixed_colors = thisComp.layer("beat").effect("script_output678")("3D Point")[0];
            bcc_mixed_colors * 100;

      Transform
        Scale:
          signed_scale = thisComp.layer("beat").effect("script_output012")("3D Point")[1];
          [signed_scale, Math.abs(signed_scale)];

      --- НИЖЕ НЕИСПОЛЬЗУЕМОЕ ---

      Effects
        S_BlurMotion
          "From Z Dist" or "To Z Dist":
            signed_scale = thisComp.layer("beat").effect("script_output012")("3D Point")[1]; // [100;200] | [-100;-200]
            unsigned_normalized = (Math.abs(signed_scale) - 100) / 100; // [0;1]
            1 - 0.1 * unsigned_normalized;
      Transform
        Anchor Point:
          center_x = thisComp.layer("beat").effect("script_output345")("3D Point")[2];
          center_y = thisComp.layer("beat").effect("script_output678")("3D Point")[0];
          signed_x_scale = thisComp.layer("beat").effect("script_output012")("3D Point")[1];
          if (signed_x_scale < 0) center_x = thisComp.width - center_x; // это надо сделать либо для Anchor Point, либо для Position
          [center_x, center_y];
        Position:
          center_x = thisComp.layer("beat").effect("script_output345")("3D Point")[2];
          center_y = thisComp.layer("beat").effect("script_output678")("3D Point")[0];
          [center_x, center_y];
      */
      frame_times[index_in_batch] = time;
      frame_output012_values[index_in_batch] = [current_position, signed_scale, hue * 360];
      frame_output345_values[index_in_batch] = [S_WarpFishEye_Amount, opacity, bcc_x_ray];
      frame_output678_values[index_in_batch] = [bcc_mixed_colors, 0, 0]; // ? если два не используются - может заменить на Slider
    }

    var setValuesAtTimes_start_time = Date.now();
    // Если последняя порция неполная, не используем slice, т.к. в конце просто останутся старые значения из предыдущих итераций
    script_output012_control.setValuesAtTimes(frame_times, frame_output012_values);
    script_output345_control.setValuesAtTimes(frame_times, frame_output345_values);
    script_output678_control.setValuesAtTimes(frame_times, frame_output678_values);
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
  const stopped_at_message = time_processing_stopped_at !== null ? "STOPPED AT " + time_processing_stopped_at + "\n" : "";
  const processed_duration_minutes = time_processing_stopped_at !== null ? (time_processing_stopped_at - work_start_time) / 60 : work_area_duration_minutes;

  // Формируем построчный вывод последовательностей
  var pointer_sequences_stats_lines = [];
  var sum_duration = 0;
  var count_valid = 0;
  for (var i = 0; i < pointer_sequences_stats.length; i++) {
    var seq = pointer_sequences_stats[i];
    var n = i + 1;
    var length_minutes = seq.duration_minutes.toFixed(1); // округление до 1 знака после запятой
    var start_time_formatted = formatTime(seq.start_time_seconds);
    pointer_sequences_stats_lines.push(start_time_formatted + " " + n + ": " + length_minutes + "мин, " + seq.real_sequence_size + "/" + seq.pointers_count + "ук\n");
    if (seq.duration_minutes > 0) {
      sum_duration += seq.duration_minutes;
      count_valid++;
    }
  }
  var avg_duration = count_valid > 0 ? (sum_duration / count_valid).toFixed(1) : "0.0";
  var pointer_sequences_stats_output = pointer_sequences_stats_lines.length > 0
    ? "pointer_sequences_stats:\n" + pointer_sequences_stats_lines.join("") + "\nсредняя длительность: " + avg_duration + "мин\n"
    : "pointer_sequences_stats: (empty)\n";

  var alert_message =
    // script_filename + "\n" +
    "script_total_time = " + script_total_time + "\n" +
    // "setValuesAtTimes_total_time = " + setValuesAtTimes_total_time + "\n" +
    // "setValuesAtTimes_called_times = " + setValuesAtTimes_called_times + "\n" +
    // "frames_batch_size = " + frames_batch_size + "\n" +
    // "inputs_ABC_max_value = " + inputs_ABC_max_value + "\n" +
    // "inputs_ABC_min_value = " + inputs_ABC_min_value + "\n" +
    "deactivate_min_avg = " + deactivate_min_avg + "\n" +
    "activate_avg_max = " + activate_avg_max + "\n" +
    // "?activate_avg_max? * inputs_ABC_max_value = " + activate_avg_max * inputs_ABC_max_value + "\n" + // TODO ?
    "FX_triggered_total = " + FX_triggered_total + "\n" +
    "FX_triggered_but_skipped = " + FX_triggered_but_skipped + "\n" +
    // "FX_triggered_but_skipped / FX_triggered_total = " + FX_triggered_but_skipped / FX_triggered_total + "\n" +
    "FX_triggered_per_minute TOTAL = " + FX_triggered_total / processed_duration_minutes + "\n" +
    "FX_triggered_per_minute REGULAR = " + (FX_triggered_total - FX_triggered_but_skipped) / processed_duration_minutes + "\n" +
    // "FX_triggered_avg_period_seconds = " + processed_duration_minutes * 60 / FX_triggered_total + "\n" +
    "REGULAR_FX_MIN_ACTIVATION_INTERVAL = " + REGULAR_FX_MIN_ACTIVATION_INTERVAL + "\n" +
    "FORCE_DEACTIVATE_FX_AFTER = " + FORCE_DEACTIVATE_FX_AFTER + "\n" +
    "auto_correction_window SECONDS = " + auto_correction_window + "\n" +
    "scale_MAX_amplitude = " + scale_MAX_amplitude + "\n" +
    "scale_ADSR_attack = " + scale_ADSR_attack + "\n" +
    "scale_ADSR_delay = " + scale_ADSR_delay + "\n" +
    // "scale_ADSR_sustain = " + scale_ADSR_sustain + "\n" +
    // "scale_ADSR_release = " + scale_ADSR_release + "\n" +
    "speed_max = " + speed_max + "\n" +
    "speed_avg = " + speed_avg + "\n" +
    "speed_min = " + speed_min + "\n" +
    // "S_WarpFishEye_Amount_neg_max = " + S_WarpFishEye_Amount_neg_max + "\n" +
    "desired_pointer_length_seconds = " + desired_pointer_length_seconds + "\n" +
    "RANDOMIZE_POINTERS_BEFORE_START = " + RANDOMIZE_POINTERS_BEFORE_START + "\n" +
    "POINTERS_SEQUENCE_SIZE = " + POINTERS_SEQUENCE_SIZE + "\n" +
    "DONT_SHUFFLE_FIRST_SEQUENCE = " + DONT_SHUFFLE_FIRST_SEQUENCE + "\n" +
    "ELAPSED_BEFORE_BOUNCE_FWD = " + ELAPSED_BEFORE_BOUNCE_FWD + "\n" +
    "ELAPSED_BEFORE_BOUNCE_BWD = " + ELAPSED_BEFORE_BOUNCE_BWD + "\n" +
    "MIN_BOUNCES_TO_REMOVE_POINTER = " + MIN_BOUNCES_TO_REMOVE_POINTER + "\n" +
    "DONT_REMOVE_POINTERS_BELOW = " + DONT_REMOVE_POINTERS_BELOW + "\n" +
    (time_pointers_reach_threshold ? "time_pointers_reach_threshold = " + formatTime(time_pointers_reach_threshold) + "\n" : "") +
    "STOP_IF_ONLY_BOUNCED_LEFT = " + STOP_IF_ONLY_BOUNCED_LEFT + "\n" +
    (time_only_bounced_left !== null ? "time_only_bounced_left = " + formatTime(time_only_bounced_left) + "\n" : "") +
    "STOP_AFTER_SEQUENCES = " + STOP_AFTER_SEQUENCES + "\n" +
    "time_remap_use_clips_for_pointers = " + time_remap_use_clips_for_pointers + "\n" +
    "USE_WORKAREA_INSTEAD_OF_CLIPS = " + USE_WORKAREA_INSTEAD_OF_CLIPS + "\n" +
    (!USE_WORKAREA_INSTEAD_OF_CLIPS ? "USED_CLIPS_COUNT = " + video_clips_times.length + "\n" : "") +
    "POINTERS_LEFT_TO_STOP = " + POINTERS_LEFT_TO_STOP + "\n" +
    stopped_at_message +
    "bounced_total_max = " + bounced_total_max + "\n" +
    (bounced_total_max_time !== null ? "bounced_total_max_time = " + formatTime(bounced_total_max_time) + "\n" : "") +
    "hue_drift = " + hue_drift + "\n" +
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
    "total_accumulated_time / processed_duration = " + total_accumulated_time_minutes / processed_duration_minutes + "\n" +
    "processed_duration / video_duration = " + processed_duration_minutes / video_duration_minutes + "\n" +
    "processed_duration_minutes = " + processed_duration_minutes + "\n" +
    "effect_sequence = " + JSON.stringify(effect_sequence, null, " ") + "\n" +
    "input_C_deactivation_value_equal_activation_value = " + input_C_deactivation_value_equal_activation_value + "\n" +
    "windows_stats_max_equal_min = " + windows_stats_max_equal_min + "\n" +
    "pointers_counters = " + JSON.stringify(pointers_counters) + "\n" +
    pointer_sequences_stats_output + "\n" +
    "SET_FX_MARKERS = " + SET_FX_MARKERS + "\n" +
    "SET_FX_STOP_MARKERS = " + SET_FX_STOP_MARKERS + "\n" +
    "CLEAR_FX_MARKERS = " + CLEAR_FX_MARKERS + "\n" +
    "XRAY_SILENCE_TIME_BEFORE_ACTIVATION = " + XRAY_SILENCE_TIME_BEFORE_ACTIVATION + "\n" +
    "XRAY_ACTIVATION_TRANSITION_TIME = " + XRAY_ACTIVATION_TRANSITION_TIME + "\n" +
    "XRAY_DEACTIVATION_TRANSITION_TIME = " + XRAY_DEACTIVATION_TRANSITION_TIME + "\n" +
    "all_pointers_bounced_once_at = " + formatTime(all_pointers_bounced_once_at) + "\n";

  // Автосохранение статистики рядом с файлом проекта: {name}.stats.txt
  var projectFile = app.project.file;
  var parentFolder = projectFile.parent;
  var baseName = projectFile.name.replace(/\.aep$/i, "");
  var statsPath = parentFolder.fsName + "/" + baseName + ".stats.txt";
  var statsFile = new File(statsPath);
  if (statsFile.exists) {
    var prevPath = parentFolder.fsName + "/" + baseName + ".prev_stats.txt";
    var prevFile = new File(prevPath);
    if (prevFile.exists) prevFile.remove();
    statsFile.rename(prevFile);
    statsFile = new File(statsPath);
  }
  if (statsFile.open("w")) {
    statsFile.encoding = "UTF-8";
    statsFile.write(alert_message);
    statsFile.close();
  } else {
    alert("Не удалось сохранить статистику в:\n" + statsPath);
  }

  showScrollableDialog(script_filename, alert_message, 1000, 800, 20);

})();
