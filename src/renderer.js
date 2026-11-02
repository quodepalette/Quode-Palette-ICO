// ---- Modern renderer: real Blob/canvas.toBlob, no ActiveX/MSXML, no
// file:// taint workarounds needed — Chromium handles local File objects
// (via <input type=file> / drag-drop) without tainting the canvas. ----

var SIZES = [16, 32, 48, 64, 128, 256];
var state = { img: null, fileName: null, sizes: { 16: true, 32: true, 48: true, 64: true }, depth: 32, icoBytes: null };

var sizeGrid = document.getElementById('sizeGrid');
function buildSizeGrid() {
  sizeGrid.innerHTML = '';
  SIZES.forEach(function (sz) {
    var on = !!state.sizes[sz];
    var card = document.createElement('div');
    card.className = 'size-card' + (on ? ' on' : '');
    card.innerHTML = '<div class="px">' + sz + '</div><div class="lbl">' + sz + '&times;' + sz + 'px</div>' +
      (sz === 256 ? '<div class="note">32-bit only</div>' : '');
    card.onclick = function () {
      if (sz === 256 && state.depth === 8) return;
      state.sizes[sz] = !state.sizes[sz];
      buildSizeGrid();
      updateConvertState();
    };
    sizeGrid.appendChild(card);
  });
}
buildSizeGrid();

var depthRow = document.getElementById('depthRow');
var depthOpts = depthRow.getElementsByClassName('depth-opt');
Array.prototype.forEach.call(depthOpts, function (opt) {
  opt.onclick = function () {
    Array.prototype.forEach.call(depthOpts, function (o) { o.className = 'depth-opt'; });
    opt.className = 'depth-opt on';
    state.depth = parseInt(opt.getAttribute('data-depth'), 10);
    if (state.depth === 8) { state.sizes[256] = false; }
    buildSizeGrid();
  };
});

var dropzone = document.getElementById('dropzone');
var fileInput = document.getElementById('fileInput');
var previewRow = document.getElementById('previewRow');
var previewImg = document.getElementById('previewImg');
var previewMeta = document.getElementById('previewMeta');
var statusEl = document.getElementById('status');
var convertBtn = document.getElementById('convertBtn');
var saveBtn = document.getElementById('saveBtn');

dropzone.onclick = function () { fileInput.click(); };
fileInput.onchange = function () {
  if (fileInput.files && fileInput.files.length > 0) { handleFile(fileInput.files[0]); }
};

// Drag & drop support (bonus over the HTA version)
['dragenter', 'dragover'].forEach(function (evt) {
  dropzone.addEventListener(evt, function (e) {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('drag');
  });
});
['dragleave', 'drop'].forEach(function (evt) {
  dropzone.addEventListener(evt, function (e) {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('drag');
  });
});
dropzone.addEventListener('drop', function (e) {
  var files = e.dataTransfer.files;
  if (files && files.length > 0) { handleFile(files[0]); }
});

function setStatus(msg, kind) {
  statusEl.innerHTML = msg || '';
  statusEl.className = kind || '';
}

function handleFile(file) {
  setStatus('');
  if (file.size > 4 * 1024 * 1024) { setStatus('File exceeds 4 MB limit.', 'err'); return; }

  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      state.img = img;
      state.fileName = file.name;
      previewImg.src = reader.result;
      var ratioNote = (img.width !== img.height) ? ' &middot; not square, will letterbox' : '';
      previewMeta.innerHTML = '<b>' + escapeHtml(file.name) + '</b><br>' + img.width + '&times;' + img.height + 'px' + ratioNote;
      previewRow.style.display = 'table';
      document.getElementById('resultPanel').style.display = 'none';
      updateConvertState();
    };
    img.onerror = function () { setStatus('Could not read that image.', 'err'); };
    img.src = reader.result; // data: URI — safe, does not taint the canvas
  };
  reader.onerror = function () { setStatus('Could not read that file.', 'err'); };
  reader.readAsDataURL(file);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function updateConvertState() {
  var any = false;
  for (var k in state.sizes) { if (state.sizes[k]) any = true; }
  convertBtn.disabled = !(state.img && any);
}

function renderToCanvas(img, size) {
  var canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  var scale = Math.min(size / img.width, size / img.height);
  var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  var x = Math.floor((size - w) / 2), y = Math.floor((size - h) / 2);
  ctx.drawImage(img, x, y, w, h);
  return canvas;
}

// ---- Median-cut quantizer for 8-bit palette entries (unchanged algorithm) ----
function channelRange(box, ch) {
  var min = 255, max = 0;
  for (var i = 0; i < box.length; i++) { var v = box[i][ch]; if (v < min) min = v; if (v > max) max = v; }
  return max - min;
}
function longestChannel(box) {
  var r = channelRange(box, 0), g = channelRange(box, 1), b = channelRange(box, 2);
  if (r >= g && r >= b) return { ch: 0, range: r };
  if (g >= r && g >= b) return { ch: 1, range: g };
  return { ch: 2, range: b };
}
function boxScore(box) { var lc = longestChannel(box); return lc.range * box.length; }

function quantize(imageData, maxColors) {
  var px = imageData.data;
  var pixels = [];
  for (var i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    pixels.push([px[i], px[i + 1], px[i + 2]]);
  }
  if (pixels.length === 0) { return { palette: [[0, 0, 0]] }; }
  var boxes = [pixels];
  while (boxes.length < maxColors) {
    boxes.sort(function (a, b) { return boxScore(b) - boxScore(a); });
    var box = boxes.shift();
    if (box.length < 2) { boxes.push(box); break; }
    var lc = longestChannel(box);
    box.sort(function (a, b) { return a[lc.ch] - b[lc.ch]; });
    var mid = box.length >> 1;
    boxes.push(box.slice(0, mid));
    boxes.push(box.slice(mid));
    if (boxes.length >= maxColors) break;
  }
  var palette = [];
  for (var bi = 0; bi < boxes.length; bi++) {
    var bx = boxes[bi], r = 0, g = 0, b = 0;
    for (var pi = 0; pi < bx.length; pi++) { r += bx[pi][0]; g += bx[pi][1]; b += bx[pi][2]; }
    var n = bx.length;
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  }
  while (palette.length < maxColors) palette.push([0, 0, 0]);
  return { palette: palette };
}

function nearestPaletteIndex(palette, r, g, b) {
  var best = 0, bestD = Infinity;
  for (var i = 0; i < palette.length; i++) {
    var p = palette[i];
    var dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    var dist = dr * dr + dg * dg + db * db;
    if (dist < bestD) { bestD = dist; best = i; }
  }
  return best;
}

function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

// PNG bytes straight from canvas.toDataURL — no ActiveX/MSXML base64 dance needed.
function canvasToPngBytes(canvas) {
  var dataUrl = canvas.toDataURL('image/png');
  var b64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
  var binStr = atob(b64);
  var bytes = new Uint8Array(binStr.length);
  for (var i = 0; i < binStr.length; i++) { bytes[i] = binStr.charCodeAt(i); }
  return bytes;
}

function build8bitBmpEntry(canvas) {
  var size = canvas.width;
  var ctx = canvas.getContext('2d');
  var imageData = ctx.getImageData(0, 0, size, size);
  var q = quantize(imageData, 256);
  var palette = q.palette;
  var px = imageData.data;
  var rowSize = Math.ceil(size / 4) * 4;
  var andRowSize = Math.ceil((size / 8) / 4) * 4;

  var header = new Uint8Array(40);
  var dv = new DataView(header.buffer);
  dv.setUint32(0, 40, true);
  dv.setInt32(4, size, true);
  dv.setInt32(8, size * 2, true);
  dv.setUint16(12, 1, true);
  dv.setUint16(14, 8, true);
  dv.setUint32(16, 0, true);
  dv.setUint32(20, 0, true);
  dv.setInt32(24, 0, true);
  dv.setInt32(28, 0, true);
  dv.setUint32(32, 256, true);
  dv.setUint32(36, 256, true);

  var paletteBytes = new Uint8Array(256 * 4);
  for (var i = 0; i < 256; i++) {
    var c = palette[i] || [0, 0, 0];
    paletteBytes[i * 4 + 0] = c[2];
    paletteBytes[i * 4 + 1] = c[1];
    paletteBytes[i * 4 + 2] = c[0];
    paletteBytes[i * 4 + 3] = 0;
  }

  var xor = new Uint8Array(rowSize * size);
  var and = new Uint8Array(andRowSize * size);
  for (var y = 0; y < size; y++) {
    var srcY = size - 1 - y;
    for (var x = 0; x < size; x++) {
      var si = (srcY * size + x) * 4;
      var r = px[si], g = px[si + 1], b = px[si + 2], a = px[si + 3];
      var transparent = a < 128;
      var idx = transparent ? nearestPaletteIndex(palette, 0, 0, 0) : nearestPaletteIndex(palette, r, g, b);
      xor[y * rowSize + x] = idx;
      if (transparent) { and[y * andRowSize + (x >> 3)] |= (0x80 >> (x & 7)); }
    }
  }

  var total = new Uint8Array(header.length + paletteBytes.length + xor.length + and.length);
  total.set(header, 0);
  total.set(paletteBytes, header.length);
  total.set(xor, header.length + paletteBytes.length);
  total.set(and, header.length + paletteBytes.length + xor.length);
  return total;
}

function convert() {
  setStatus('Rendering&hellip;');
  convertBtn.disabled = true;
  var sizes = [];
  for (var k in state.sizes) { if (state.sizes[k]) sizes.push(parseInt(k, 10)); }
  sizes.sort(function (a, b) { return a - b; });

  var stripEl = document.getElementById('strip');
  stripEl.innerHTML = '';
  var entries = [];

  for (var s = 0; s < sizes.length; s++) {
    var sz = sizes[s];
    var canvas = renderToCanvas(state.img, sz);
    var data, bitCount, colorCountByte;
    if (sz === 256 || state.depth === 32) {
      data = canvasToPngBytes(canvas);
      bitCount = 32; colorCountByte = 0;
    } else {
      data = build8bitBmpEntry(canvas);
      bitCount = 8; colorCountByte = 0;
    }
    entries.push({ size: sz, data: data, bitCount: bitCount, colorCountByte: colorCountByte });

    var dispSize = sz >= 64 ? 64 : (sz >= 32 ? 44 : 30);
    var item = document.createElement('div');
    item.className = 'strip-item';
    var wrap = document.createElement('div');
    wrap.className = 'strip-canvas-wrap';
    wrap.style.width = dispSize + 'px'; wrap.style.height = dispSize + 'px';
    var pc = document.createElement('canvas');
    pc.width = dispSize; pc.height = dispSize;
    var pctx = pc.getContext('2d');
    pctx.drawImage(canvas, 0, 0, dispSize, dispSize);
    wrap.appendChild(pc);
    item.appendChild(wrap);
    var label = document.createElement('div');
    label.className = 'strip-label';
    label.innerHTML = '<b>' + sz + 'px</b><br>' + bitCount + '-bit';
    item.appendChild(label);
    stripEl.appendChild(item);
  }

  var count = entries.length;
  var dirHeader = new Uint8Array(6);
  dirHeader.set(u16(0), 0); dirHeader.set(u16(1), 2); dirHeader.set(u16(count), 4);

  var offset = 6 + count * 16;
  var dirEntries = [];
  for (var e = 0; e < entries.length; e++) {
    var ent = entries[e];
    var dim = ent.size === 256 ? 0 : ent.size;
    var entry = new Uint8Array(16);
    entry[0] = dim; entry[1] = dim;
    entry[2] = ent.colorCountByte; entry[3] = 0;
    entry.set(u16(1), 4);
    entry.set(u16(ent.bitCount), 6);
    entry.set(u32(ent.data.length), 8);
    entry.set(u32(offset), 12);
    dirEntries.push(entry);
    offset += ent.data.length;
  }

  var totalSize = offset;
  var out = new Uint8Array(totalSize);
  var p = 0;
  out.set(dirHeader, p); p += dirHeader.length;
  for (var de = 0; de < dirEntries.length; de++) { out.set(dirEntries[de], p); p += dirEntries[de].length; }
  for (var ee = 0; ee < entries.length; ee++) { out.set(entries[ee].data, p); p += entries[ee].data.length; }

  state.icoBytes = out;
  document.getElementById('filesize').innerHTML = (totalSize / 1024).toFixed(1) + ' KB &middot; ' + count + ' resolution' + (count > 1 ? 's' : '');
  document.getElementById('resultPanel').style.display = 'block';
  setStatus('Done.', 'ok');
  convertBtn.disabled = false;
}

convertBtn.onclick = function () {
  try { convert(); }
  catch (err) { setStatus('Conversion failed: ' + err.message, 'err'); convertBtn.disabled = false; }
};

function bytesToBase64(bytes) {
  var CHUNK = 0x8000;
  var binStr = '';
  for (var i = 0; i < bytes.length; i += CHUNK) {
    binStr += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binStr);
}

// Native "Save As" dialog + disk write, via the main process (see preload.js / main.js).
saveBtn.onclick = function () {
  if (!state.icoBytes) return;
  var baseName = (state.fileName || 'favicon').replace(/\.[^.]+$/, '') + '.ico';
  setStatus('Waiting for save location&hellip;');
  var base64 = bytesToBase64(state.icoBytes);

  window.electronAPI.saveIco(base64, baseName).then(function (result) {
    if (result.canceled) { setStatus('Done.', 'ok'); return; }
    if (result.ok) { setStatus('Saved to ' + result.path, 'ok'); }
    else { setStatus('Save failed: ' + (result.error || 'unknown error'), 'err'); }
  }).catch(function (err) {
    setStatus('Save failed: ' + err.message, 'err');
  });
};

// =====================================================================
// Mode tabs: Image -> ICO  /  ICO -> PNG
// =====================================================================
var tabToIco = document.getElementById('tabToIco');
var tabToPng = document.getElementById('tabToPng');
var modeToIco = document.getElementById('mode-toIco');
var modeToPng = document.getElementById('mode-toPng');

function setMode(mode) {
  var toIco = mode === 'toIco';
  tabToIco.className = 'mode-tab' + (toIco ? ' on' : '');
  tabToPng.className = 'mode-tab' + (toIco ? '' : ' on');
  modeToIco.className = 'mode-panel' + (toIco ? ' on' : '');
  modeToPng.className = 'mode-panel' + (toIco ? '' : ' on');
}
tabToIco.onclick = function () { setMode('toIco'); };
tabToPng.onclick = function () { setMode('toPng'); };

// =====================================================================
// ICO -> PNG
// =====================================================================
var icoState = { entries: null, fileName: null };

var icoDropzone = document.getElementById('icoDropzone');
var icoFileInput = document.getElementById('icoFileInput');
var icoPreviewRow = document.getElementById('icoPreviewRow');
var icoPreviewMeta = document.getElementById('icoPreviewMeta');
var icoStatusEl = document.getElementById('icoStatus');
var icoResultPanel = document.getElementById('icoResultPanel');
var icoStrip = document.getElementById('icoStrip');
var icoResultSummary = document.getElementById('icoResultSummary');
var saveAllPngBtn = document.getElementById('saveAllPngBtn');

function setIcoStatus(msg, kind) {
  icoStatusEl.innerHTML = msg || '';
  icoStatusEl.className = kind || '';
}

icoDropzone.onclick = function () { icoFileInput.click(); };
icoFileInput.onchange = function () {
  if (icoFileInput.files && icoFileInput.files.length > 0) { handleIcoFile(icoFileInput.files[0]); }
};
['dragenter', 'dragover'].forEach(function (evt) {
  icoDropzone.addEventListener(evt, function (e) {
    e.preventDefault(); e.stopPropagation();
    icoDropzone.classList.add('drag');
  });
});
['dragleave', 'drop'].forEach(function (evt) {
  icoDropzone.addEventListener(evt, function (e) {
    e.preventDefault(); e.stopPropagation();
    icoDropzone.classList.remove('drag');
  });
});
icoDropzone.addEventListener('drop', function (e) {
  var files = e.dataTransfer.files;
  if (files && files.length > 0) { handleIcoFile(files[0]); }
});

function pngFileNameFor(baseName, entry, index, total) {
  var suffix = total > 1 ? ('-' + entry.width + 'x' + entry.height) : '';
  return baseName + suffix + '.png';
}

function handleIcoFile(file) {
  setIcoStatus('');
  icoResultPanel.style.display = 'none';
  icoState.entries = null;

  if (!/\.ico$/i.test(file.name)) { setIcoStatus('Please choose a .ico file.', 'err'); return; }
  if (file.size > 8 * 1024 * 1024) { setIcoStatus('File exceeds 8 MB limit.', 'err'); return; }

  var reader = new FileReader();
  reader.onload = function () {
    setIcoStatus('Reading&hellip;');
    icoState.fileName = file.name;
    icoPreviewMeta.innerHTML = '<b>' + escapeHtml(file.name) + '</b><br>' + (file.size / 1024).toFixed(1) + ' KB';
    icoPreviewRow.style.display = 'table';

    IcoParser.extractEntries(reader.result).then(function (entries) {
      icoState.entries = entries;
      renderIcoStrip(entries);
      setIcoStatus('Extracted ' + entries.length + ' resolution' + (entries.length > 1 ? 's' : '') + '.', 'ok');
    }).catch(function (err) {
      setIcoStatus('Could not read that .ico: ' + err.message, 'err');
    });
  };
  reader.onerror = function () { setIcoStatus('Could not read that file.', 'err'); };
  reader.readAsArrayBuffer(file);
}

function renderIcoStrip(entries) {
  icoStrip.innerHTML = '';
  var baseName = (icoState.fileName || 'icon').replace(/\.[^.]+$/, '');

  entries.forEach(function (entry, i) {
    var dispSize = entry.width >= 64 ? 64 : (entry.width >= 32 ? 44 : 30);
    var item = document.createElement('div');
    item.className = 'ico-strip-item';

    var wrap = document.createElement('div');
    wrap.className = 'strip-canvas-wrap';
    wrap.style.width = dispSize + 'px'; wrap.style.height = dispSize + 'px';
    wrap.style.margin = '0 auto';
    var pc = document.createElement('canvas');
    pc.width = dispSize; pc.height = dispSize;
    pc.getContext('2d').drawImage(entry.canvas, 0, 0, dispSize, dispSize);
    wrap.appendChild(pc);
    item.appendChild(wrap);

    var label = document.createElement('div');
    label.className = 'strip-label';
    label.innerHTML = '<b>' + entry.width + '&times;' + entry.height + '</b><br>' + entry.bitCount + '-bit';
    item.appendChild(label);

    var btn = document.createElement('button');
    btn.className = 'mini-save';
    btn.textContent = 'Save PNG';
    btn.onclick = function () {
      var name = pngFileNameFor(baseName, entry, i, entries.length);
      savePngEntry(entry, name, btn);
    };
    item.appendChild(btn);

    icoStrip.appendChild(item);
  });

  icoResultSummary.innerHTML = entries.length + ' resolution' + (entries.length > 1 ? 's' : '') + ' found';
  icoResultPanel.style.display = 'block';
}

function pngBytesForEntry(entry) {
  if (entry.isPng && entry.rawPngBytes) { return entry.rawPngBytes; }
  return canvasToPngBytes(entry.canvas); // re-encode decoded BMP entries as PNG
}

function savePngEntry(entry, suggestedName, btnEl) {
  var base64 = bytesToBase64(pngBytesForEntry(entry));
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Saving&hellip;'; }
  window.electronAPI.savePng(base64, suggestedName).then(function (result) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Save PNG'; }
    if (result.canceled) { return; }
    if (result.ok) { setIcoStatus('Saved to ' + result.path, 'ok'); }
    else { setIcoStatus('Save failed: ' + (result.error || 'unknown error'), 'err'); }
  }).catch(function (err) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Save PNG'; }
    setIcoStatus('Save failed: ' + err.message, 'err');
  });
}

saveAllPngBtn.onclick = function () {
  if (!icoState.entries || icoState.entries.length === 0) return;
  var baseName = (icoState.fileName || 'icon').replace(/\.[^.]+$/, '');
  var total = icoState.entries.length;
  var files = icoState.entries.map(function (entry, i) {
    return { name: pngFileNameFor(baseName, entry, i, total), base64: bytesToBase64(pngBytesForEntry(entry)) };
  });

  setIcoStatus('Waiting for a folder&hellip;');
  saveAllPngBtn.disabled = true;
  window.electronAPI.savePngBatch(files).then(function (result) {
    saveAllPngBtn.disabled = false;
    if (result.canceled) { setIcoStatus('Extracted ' + total + ' resolution' + (total > 1 ? 's' : '') + '.', 'ok'); return; }
    if (result.ok) { setIcoStatus('Saved ' + result.count + ' PNG' + (result.count > 1 ? 's' : '') + ' to ' + result.folder, 'ok'); }
    else { setIcoStatus('Save failed: ' + (result.error || 'unknown error'), 'err'); }
  }).catch(function (err) {
    saveAllPngBtn.disabled = false;
    setIcoStatus('Save failed: ' + err.message, 'err');
  });
};
