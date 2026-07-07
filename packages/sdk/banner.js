// Browser polyfills for Node.js modules - MUST RUN FIRST
(function() {
  var globalObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
  
  // Buffer polyfill - CRITICAL: Must be available globally before ANY bundle code runs
  (function() {
    var BufferImpl = function Buffer(arg, offset, length) {
      if (!(this instanceof BufferImpl)) {
        return new BufferImpl(arg, offset, length);
      }
      var buf;
      if (typeof arg === 'number') {
        buf = new Uint8Array(arg);
        if (length !== undefined && typeof offset === 'number') {
          buf.fill(offset);
        }
      } else if (typeof arg === 'string') {
        var bytes = new TextEncoder().encode(arg);
        buf = new Uint8Array(bytes);
      } else if (arg instanceof ArrayBuffer) {
        buf = new Uint8Array(arg, offset || 0, length);
      } else if (arg instanceof Uint8Array) {
        buf = new Uint8Array(arg);
      } else if (Array.isArray(arg)) {
        buf = new Uint8Array(arg);
      } else if (arg && typeof arg.length === 'number') {
        buf = new Uint8Array(arg.length);
        for (var i = 0; i < arg.length; i++) {
          buf[i] = (arg[i] & 0xFF);
        }
      } else {
        buf = new Uint8Array(0);
      }
      Object.setPrototypeOf(buf, BufferImpl.prototype);
      return buf;
    };
    
    BufferImpl.prototype = Object.create(Uint8Array.prototype);
    
    // Add all common Buffer methods needed by Solana wallet adapters
    
    // 8-bit write methods
    BufferImpl.prototype.writeUInt8 = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value & 0xff);
      return offset + 1;
    };
    
    BufferImpl.prototype.writeInt8 = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value & 0xff);
      return offset + 1;
    };
    
    // 16-bit write methods
    BufferImpl.prototype.writeUInt16LE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value & 0xff);
      this[offset + 1] = (value >>> 8);
      return offset + 2;
    };
    
    BufferImpl.prototype.writeUInt16BE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value >>> 8);
      this[offset + 1] = (value & 0xff);
      return offset + 2;
    };
    
    BufferImpl.prototype.writeInt16LE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value & 0xff);
      this[offset + 1] = (value >>> 8);
      return offset + 2;
    };
    
    BufferImpl.prototype.writeInt16BE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value >>> 8);
      this[offset + 1] = (value & 0xff);
      return offset + 2;
    };
    
    // 32-bit write methods
    BufferImpl.prototype.writeUInt32BE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value >>> 24);
      this[offset + 1] = (value >>> 16);
      this[offset + 2] = (value >>> 8);
      this[offset + 3] = (value & 0xff);
      return offset + 4;
    };
    
    BufferImpl.prototype.writeUInt32LE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value & 0xff);
      this[offset + 1] = (value >>> 8);
      this[offset + 2] = (value >>> 16);
      this[offset + 3] = (value >>> 24);
      return offset + 4;
    };
    
    BufferImpl.prototype.writeInt32LE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value & 0xff);
      this[offset + 1] = (value >>> 8);
      this[offset + 2] = (value >>> 16);
      this[offset + 3] = (value >>> 24);
      return offset + 4;
    };
    
    BufferImpl.prototype.writeInt32BE = function(value, offset) {
      offset = offset >>> 0;
      value = +value;
      this[offset] = (value >>> 24);
      this[offset + 1] = (value >>> 16);
      this[offset + 2] = (value >>> 8);
      this[offset + 3] = (value & 0xff);
      return offset + 4;
    };
    
    // 8-bit read methods
    BufferImpl.prototype.readUInt8 = function(offset) {
      offset = offset >>> 0;
      return this[offset];
    };
    
    BufferImpl.prototype.readInt8 = function(offset) {
      offset = offset >>> 0;
      var val = this[offset];
      return (val & 0x80) ? val - 0x100 : val;
    };
    
    // 16-bit read methods
    BufferImpl.prototype.readUInt16LE = function(offset) {
      offset = offset >>> 0;
      return this[offset] | (this[offset + 1] << 8);
    };
    
    BufferImpl.prototype.readUInt16BE = function(offset) {
      offset = offset >>> 0;
      return (this[offset] << 8) | this[offset + 1];
    };
    
    BufferImpl.prototype.readInt16LE = function(offset) {
      offset = offset >>> 0;
      var val = this[offset] | (this[offset + 1] << 8);
      return (val & 0x8000) ? val | 0xFFFF0000 : val;
    };
    
    BufferImpl.prototype.readInt16BE = function(offset) {
      offset = offset >>> 0;
      var val = (this[offset] << 8) | this[offset + 1];
      return (val & 0x8000) ? val | 0xFFFF0000 : val;
    };
    
    // 32-bit read methods
    BufferImpl.prototype.readUInt32BE = function(offset) {
      offset = offset >>> 0;
      return ((this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]) >>> 0;
    };
    
    BufferImpl.prototype.readUInt32LE = function(offset) {
      offset = offset >>> 0;
      return ((this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24)) >>> 0;
    };
    
    BufferImpl.prototype.readInt32LE = function(offset) {
      offset = offset >>> 0;
      return (this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
    };
    
    BufferImpl.prototype.readInt32BE = function(offset) {
      offset = offset >>> 0;
      return (this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3];
    };
    
    BufferImpl.from = function(data, encoding) {
      if (typeof data === 'string') {
        if (encoding === 'hex') {
          var hex = data.length % 2 === 0 ? data : '0' + data;
          var hexBytes = new Uint8Array(hex.length / 2);
          for (var hi = 0; hi < hexBytes.length; hi++) {
            hexBytes[hi] = parseInt(hex.substr(hi * 2, 2), 16);
          }
          return new BufferImpl(hexBytes);
        }
        if (encoding === 'base64') {
          var binaryStr = atob(data);
          var b64Bytes = new Uint8Array(binaryStr.length);
          for (var bi = 0; bi < binaryStr.length; bi++) {
            b64Bytes[bi] = binaryStr.charCodeAt(bi);
          }
          return new BufferImpl(b64Bytes);
        }
        return new BufferImpl(new TextEncoder().encode(data));
      }
      if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        return new BufferImpl(data);
      }
      if (Array.isArray(data)) {
        return new BufferImpl(data);
      }
      return new BufferImpl(0);
    };

    BufferImpl.prototype.toString = function(encoding, start, end) {
      var bytes = this.subarray(start || 0, end !== undefined ? end : this.length);
      if (encoding === 'hex') {
        var hexOut = '';
        for (var i = 0; i < bytes.length; i++) {
          hexOut += bytes[i].toString(16).padStart(2, '0');
        }
        return hexOut;
      }
      if (encoding === 'base64') {
        var binary = '';
        for (var j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j]);
        }
        return btoa(binary);
      }
      return new TextDecoder().decode(bytes);
    };
    
    BufferImpl.alloc = function(size, fill) {
      var buf = new Uint8Array(size);
      if (fill !== undefined) {
        buf.fill(typeof fill === 'number' ? fill : 0);
      }
      Object.setPrototypeOf(buf, BufferImpl.prototype);
      return buf;
    };
    
    BufferImpl.allocUnsafe = function(size) {
      return BufferImpl.alloc(size);
    };
    
    BufferImpl.isBuffer = function(obj) {
      return obj instanceof Uint8Array || (obj && obj.buffer && obj.buffer instanceof ArrayBuffer);
    };
    
    BufferImpl.concat = function(list, totalLength) {
      if (!Array.isArray(list)) return new BufferImpl(0);
      var len = totalLength;
      if (len === undefined) {
        len = 0;
        for (var i = 0; i < list.length; i++) {
          len += list[i].length;
        }
      }
      var result = new Uint8Array(len);
      var pos = 0;
      for (var j = 0; j < list.length && pos < len; j++) {
        var item = list[j];
        if (item instanceof Uint8Array) {
          var copyLen = Math.min(item.length, len - pos);
          result.set(item.subarray(0, copyLen), pos);
          pos += copyLen;
        }
      }
      Object.setPrototypeOf(result, BufferImpl.prototype);
      return result;
    };
    
    // Set Buffer globally on ALL possible global objects
    globalObj.Buffer = BufferImpl;
    if (typeof window !== 'undefined') window.Buffer = BufferImpl;
    if (typeof global !== 'undefined') global.Buffer = BufferImpl;
    if (typeof self !== 'undefined') self.Buffer = BufferImpl;
  })();
  
  // Process polyfill - required for browser compatibility
  if (typeof process === 'undefined') {
    globalObj.process = {
      env: {
        NODE_ENV: 'production'
      },
      browser: true,
      version: '',
      versions: {},
      nextTick: function(fn) {
        setTimeout(fn, 0);
      },
      cwd: function() {
        return '/';
      },
      exit: function(code) {
        throw new Error('process.exit called with code ' + code);
      }
    };
    if (typeof window !== 'undefined') {
      window.process = globalObj.process;
    }
  }
  
  // Provide require function for dynamic requires in bundled code
  if (typeof require === 'undefined') {
    globalObj.require = function(id) {
      if (id === 'crypto' || id === 'node:crypto') {
        var cryptoObj = typeof globalObj.crypto !== 'undefined' ? globalObj.crypto : (typeof window !== 'undefined' && window.crypto ? window.crypto : {});
        return {
          createHash: function() {
            throw new Error('crypto.createHash is not available in browser. Use Web Crypto API instead.');
          },
          randomBytes: function(size) {
            var arr = new Uint8Array(size);
            if (cryptoObj.getRandomValues) {
              cryptoObj.getRandomValues(arr);
            } else {
              throw new Error('crypto.randomBytes is not available: no getRandomValues');
            }
            return arr;
          },
          randomFillSync: function(buffer) {
            var cryptoObj2 = typeof globalObj.crypto !== 'undefined' ? globalObj.crypto : (typeof window !== 'undefined' && window.crypto ? window.crypto : {});
            if (cryptoObj2.getRandomValues) {
              cryptoObj2.getRandomValues(buffer);
            } else {
              throw new Error('crypto.randomFillSync is not available: no getRandomValues');
            }
            return buffer;
          }
        };
      }
      if (id === 'buffer') {
        return { Buffer: globalObj.Buffer };
      }
      throw new Error('Dynamic require of "' + id + '" is not supported in browser bundle. Required: ' + id);
    };
  }
  
  // Deno stub (for snarkjs compatibility)
  if (typeof globalObj.Deno === 'undefined') {
    globalObj.Deno = {
      // Minimal stub to prevent "Deno is not defined" errors in snarkjs
      build: { os: 'browser' },
      env: { get: function() { return undefined; } },
    };
  }
})();

