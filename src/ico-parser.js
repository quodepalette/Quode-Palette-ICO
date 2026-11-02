// ---- ICO -> PNG: parses the .ico container and decodes each embedded
// resolution (either an embedded PNG, or a raw DIB/BMP entry) into a
// canvas, so it can be re-exported as a standalone .png per size. ----

var IcoParser = (function () {
  function u16(bytes, off) { return bytes[off] | (bytes[off + 1] << 8); }
  function u32(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
  }
  function i32(bytes, off) { return u32(bytes, off) | 0; }

  var PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  function isPngSignature(bytes, off) {
    for (var i = 0; i < PNG_MAGIC.length; i++) {
      if (bytes[off + i] !== PNG_MAGIC[i]) return false;
    }
    return true;
  }

  // Parses the top-level ICO directory. Throws on malformed input.
  function parseDirectory(bytes) {
    if (bytes.length < 6) throw new Error('File is too small to be a valid .ico');
    var reserved = u16(bytes, 0);
    var type = u16(bytes, 2);
    var count = u16(bytes, 4);
    if (reserved !== 0 || (type !== 1 && type !== 2)) {
      throw new Error('Not a valid .ico file (bad header)');
    }
    if (count === 0) throw new Error('.ico file contains no images');

    var entries = [];
    for (var i = 0; i < count; i++) {
      var off = 6 + i * 16;
      if (off + 16 > bytes.length) throw new Error('.ico directory is truncated');
      var w = bytes[off];
      var h = bytes[off + 1];
      var bitCount = u16(bytes, off + 6);
      var bytesInRes = u32(bytes, off + 8);
      var imageOffset = u32(bytes, off + 12);
      entries.push({
        width: w === 0 ? 256 : w,
        height: h === 0 ? 256 : h,
        bitCount: bitCount,
        byteLength: bytesInRes,
        offset: imageOffset
      });
    }
    return entries;
  }

  // Decodes a raw (non-PNG) DIB/BMP-style ICO entry into an ImageData.
  function decodeDib(data, declaredW, declaredH) {
    var headerSize = u32(data, 0);
    if (headerSize < 40 || headerSize > data.length) {
      throw new Error('Unsupported or corrupt icon bitmap header');
    }
    var biWidth = i32(data, 4);
    var biHeightRaw = i32(data, 8);
    var biBitCount = u16(data, 14);
    var biCompression = u32(data, 16);
    var biClrUsed = u32(data, 32);

    if (biCompression !== 0) {
      throw new Error('Compressed icon bitmaps are not supported');
    }

    var width = biWidth || declaredW;
    // biHeight covers XOR+AND masks stacked together, so the real image
    // height is half of it.
    var height = Math.abs(biHeightRaw) / 2;
    if (!height) height = declaredH;

    var paletteColors = biClrUsed;
    if (paletteColors === 0 && biBitCount <= 8) paletteColors = 1 << biBitCount;
    var paletteOffset = headerSize;
    var palette = [];
    if (biBitCount <= 8) {
      for (var p = 0; p < paletteColors; p++) {
        var po = paletteOffset + p * 4;
        palette.push([data[po + 2], data[po + 1], data[po], 255]); // BGRA -> RGBA (opaque)
      }
    }
    var pixelOffset = paletteOffset + (biBitCount <= 8 ? paletteColors * 4 : 0);

    var xorRowSize = Math.floor((biBitCount * width + 31) / 32) * 4;
    var andRowSize = Math.floor((width + 31) / 32) * 4;
    var andOffset = pixelOffset + xorRowSize * height;

    var out = new Uint8ClampedArray(width * height * 4);

    function getAndBit(x, y) {
      var rowStart = andOffset + y * andRowSize;
      var byteIndex = rowStart + (x >> 3);
      if (byteIndex >= data.length) return 0;
      var bit = 7 - (x & 7);
      return (data[byteIndex] >> bit) & 1;
    }

    for (var y = 0; y < height; y++) {
      // BMP rows are stored bottom-up; row 0 in source is the bottom row.
      var srcY = height - 1 - y;
      var rowStart = pixelOffset + srcY * xorRowSize;
      for (var x = 0; x < width; x++) {
        var r, g, b, a;
        if (biBitCount === 32) {
          var o = rowStart + x * 4;
          b = data[o]; g = data[o + 1]; r = data[o + 2]; a = data[o + 3];
        } else if (biBitCount === 24) {
          var o3 = rowStart + x * 3;
          b = data[o3]; g = data[o3 + 1]; r = data[o3 + 2];
          a = getAndBit(x, srcY) ? 0 : 255;
        } else if (biBitCount === 8) {
          var idx8 = data[rowStart + x];
          var c8 = palette[idx8] || [0, 0, 0, 255];
          r = c8[0]; g = c8[1]; b = c8[2];
          a = getAndBit(x, srcY) ? 0 : 255;
        } else if (biBitCount === 4) {
          var byte4 = data[rowStart + (x >> 1)];
          var idx4 = (x & 1) === 0 ? (byte4 >> 4) : (byte4 & 0x0f);
          var c4 = palette[idx4] || [0, 0, 0, 255];
          r = c4[0]; g = c4[1]; b = c4[2];
          a = getAndBit(x, srcY) ? 0 : 255;
        } else if (biBitCount === 1) {
          var byte1 = data[rowStart + (x >> 3)];
          var bit1 = 7 - (x & 7);
          var idx1 = (byte1 >> bit1) & 1;
          var c1 = palette[idx1] || [0, 0, 0, 255];
          r = c1[0]; g = c1[1]; b = c1[2];
          a = getAndBit(x, srcY) ? 0 : 255;
        } else {
          throw new Error('Unsupported icon color depth: ' + biBitCount + '-bit');
        }
        var di = (y * width + x) * 4;
        out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
      }
    }

    return { width: width, height: height, imageData: new ImageData(out, width, height) };
  }

  // Loads a raw PNG byte range as an <img>, resolved via a Promise (needed
  // because Image decoding is async).
  function loadPngAsImage(bytes) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([bytes], { type: 'image/png' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Embedded PNG entry failed to decode')); };
      img.src = url;
    });
  }

  // Public: parses an ArrayBuffer/Uint8Array of a .ico file and resolves to
  // an array of { width, height, bitCount, isPng, canvas } — one per
  // resolution stored in the file, in directory order.
  function extractEntries(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    var dir = parseDirectory(bytes);
    var jobs = dir.map(function (entry) {
      var data = bytes.subarray(entry.offset, entry.offset + entry.byteLength);
      if (data.length < 4) return Promise.reject(new Error('Icon entry is truncated'));

      if (isPngSignature(data, 0)) {
        return loadPngAsImage(data).then(function (img) {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || entry.width;
          canvas.height = img.naturalHeight || entry.height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return {
            width: canvas.width,
            height: canvas.height,
            bitCount: entry.bitCount || 32,
            isPng: true,
            canvas: canvas,
            rawPngBytes: data // embedded bytes are already a valid PNG file
          };
        });
      }

      var decoded;
      try {
        decoded = decodeDib(data, entry.width, entry.height);
      } catch (err) {
        return Promise.reject(err);
      }
      var canvas = document.createElement('canvas');
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      canvas.getContext('2d').putImageData(decoded.imageData, 0, 0);
      return Promise.resolve({
        width: decoded.width,
        height: decoded.height,
        bitCount: entry.bitCount || 32,
        isPng: false,
        canvas: canvas,
        rawPngBytes: null
      });
    });

    return Promise.all(jobs);
  }

  return { extractEntries: extractEntries };
})();
