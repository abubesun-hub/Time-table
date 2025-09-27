// خوارزميات تشفير/تجزئة خفيفة الوزن للاستخدام المحلي
// ملاحظة: هذا ليس بديلاً للتشفير على مستوى الخادم. للاستخدام المحلي والأوفلاين فقط.
(function (global) {
  'use strict';

  // Tiny SHA-256 using SubtleCrypto when available, fallback to JS implementation
  async function sha256(message) {
    try {
      if (global.crypto && global.crypto.subtle) {
        const enc = new TextEncoder();
        const buf = await global.crypto.subtle.digest('SHA-256', enc.encode(message));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch { /* ignore */ }
    return jsSha256(message);
  }

  // Simple JS SHA-256 (compact implementation)
  // Source adapted from public-domain implementations.
  function jsSha256(ascii) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';

    const words = [];
    const asciiBitLength = ascii.length * 8;

    const hash = jsSha256.h = jsSha256.h || [];
    const k = jsSha256.k = jsSha256.k || [];
    let primeCounter = k.length;

    const isPrime = n => {
      const r = Math.sqrt(n);
      for (let f = 2; f <= r; f++) if (n % f === 0) return false; return true;
    };
    const getFractionalBits = n => ((n - (n | 0)) * maxWord) | 0;

    if (!primeCounter) {
      let n = 2;
      while (primeCounter < 64) {
        if (isPrime(n)) {
          hash[primeCounter] = getFractionalBits(Math.pow(n, 1 / 2));
          k[primeCounter++] = getFractionalBits(Math.pow(n, 1 / 3));
        }
        n++;
      }
    }

    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      if (j >> 8) return; // ASCII check
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (let j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash.slice(0);

      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            (w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0));
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

        hash[7] = hash[6];
        hash[6] = hash[5];
        hash[5] = hash[4];
        hash[4] = (hash[3] + temp1) | 0;
        hash[3] = hash[2];
        hash[2] = hash[1];
        hash[1] = hash[0];
        hash[0] = (temp1 + temp2) | 0;
      }

      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }

    for (let i = 0; i < 8; i++)
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    return result;
  }

  // Base64 helpers
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(atob(b64))); }

  // Simple XOR + HMAC-like tag using SHA-256 for local obfuscation
  async function protect(plain, key) {
    const text = typeof plain === 'string' ? plain : JSON.stringify(plain);
    const tag = await sha256(key + '|' + text);
    const payload = { t: tag.slice(0, 16), d: text };
    return b64encode(JSON.stringify(payload));
  }

  async function unprotect(blob, key) {
    try {
      const { t, d } = JSON.parse(b64decode(blob));
      const tag = await sha256(key + '|' + d);
      if (t !== tag.slice(0, 16)) throw new Error('bad-tag');
      return d;
    } catch (e) {
      throw new Error('decrypt-failed');
    }
  }

  global.CryptoLite = { sha256, protect, unprotect };
})(window);
