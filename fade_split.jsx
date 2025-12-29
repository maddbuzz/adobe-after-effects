var comp = app.project.activeItem;
if (!(comp && comp instanceof CompItem)) throw "No comp";

app.beginUndoGroup("Auto Split Fades All Layers");

var points = [
  [comp.width / 2, comp.height / 2],  // центр
  [comp.width / 2, 0.5],              // верх
  [comp.width / 2, comp.height - 0.5], // низ
  [0.5, comp.height / 2],             // лево
  [comp.width - 0.5, comp.height / 2] // право
];

var step = 1 / comp.frameRate;
var delta_threshold = 0.02;
var variance_threshold = 0.005;
var min_fade_duration = 0.25;

function luminanceAt(layer, pos, time) {
  var c = layer.sampleImage(pos, [0.5, 0.5], true, time);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

for (var l = 1; l <= comp.numLayers; l++) {
  var layer = comp.layer(l);
  if (!(layer instanceof AVLayer)) continue; // только видео/аудио слои

  var in_fade = true;
  for (var i = 0; i < points.length; i++) {
    if (luminanceAt(layer, points[i], layer.inPoint) > 0.001) {
      in_fade = false;
      break;
    }
  }
  var fade_start_time = in_fade ? layer.inPoint : 0;

  for (var t = layer.inPoint + step; t < layer.outPoint; t += step) {
    var deltas = [];
    for (var i = 0; i < points.length; i++) {
      var l1 = luminanceAt(layer, points[i], t - step);
      var l2 = luminanceAt(layer, points[i], t);
      deltas.push(l2 - l1);
    }

    var mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    var variance = deltas.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / deltas.length;

    var is_fade_frame = Math.abs(mean) > delta_threshold && variance < variance_threshold;

    if (!in_fade && is_fade_frame) {
      in_fade = true;
      fade_start_time = t;
    }

    if (in_fade && !is_fade_frame) {
      if (t - fade_start_time >= min_fade_duration) {
        var new_layer = layer.duplicate();
        layer.outPoint = fade_start_time;
        new_layer.inPoint = fade_start_time;
        new_layer.outPoint = t;
        layer = new_layer; // продолжаем на новом слое
      }
      in_fade = false;
    }
  }
}

app.endUndoGroup();
