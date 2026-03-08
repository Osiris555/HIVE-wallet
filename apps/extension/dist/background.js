var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@noble/hashes/esm/crypto.js
var crypto3;
var init_crypto = __esm({
  "node_modules/@noble/hashes/esm/crypto.js"() {
    crypto3 = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;
  }
});

// node_modules/@noble/hashes/esm/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber2(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes2(b, ...lengths) {
  if (!isBytes2(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash should be wrapped by utils.createHasher");
  anumber2(h.outputLen);
  anumber2(h.blockLen);
}
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput2(out, instance) {
  abytes2(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function u322(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function byteSwap2(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap322(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap2(arr[i]);
  }
  return arr;
}
async function asyncLoop(iters, tick, cb) {
  let ts = Date.now();
  for (let i = 0; i < iters; i++) {
    cb(i);
    const diff = Date.now() - ts;
    if (diff >= 0 && diff < tick)
      continue;
    await nextTick();
    ts += diff;
  }
}
function utf8ToBytes2(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes2(data) {
  if (typeof data === "string")
    data = utf8ToBytes2(data);
  abytes2(data);
  return data;
}
function kdfInputToBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes2(data);
  abytes2(data);
  return data;
}
function checkOpts(defaults, opts) {
  if (opts !== void 0 && {}.toString.call(opts) !== "[object Object]")
    throw new Error("options should be object or undefined");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes2(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes3(bytesLength = 32) {
  if (crypto3 && typeof crypto3.getRandomValues === "function") {
    return crypto3.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto3 && typeof crypto3.randomBytes === "function") {
    return Uint8Array.from(crypto3.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}
var isLE2, swap32IfBE, nextTick, Hash2;
var init_utils = __esm({
  "node_modules/@noble/hashes/esm/utils.js"() {
    init_crypto();
    isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
    swap32IfBE = isLE2 ? (u) => u : byteSwap322;
    nextTick = async () => {
    };
    Hash2 = class {
    };
  }
});

// node_modules/@noble/hashes/esm/hmac.js
var HMAC, hmac;
var init_hmac = __esm({
  "node_modules/@noble/hashes/esm/hmac.js"() {
    init_utils();
    HMAC = class extends Hash2 {
      constructor(hash, _key) {
        super();
        this.finished = false;
        this.destroyed = false;
        ahash(hash);
        const key = toBytes2(_key);
        this.iHash = hash.create();
        if (typeof this.iHash.update !== "function")
          throw new Error("Expected instance of class which extends utils.Hash");
        this.blockLen = this.iHash.blockLen;
        this.outputLen = this.iHash.outputLen;
        const blockLen = this.blockLen;
        const pad = new Uint8Array(blockLen);
        pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54;
        this.iHash.update(pad);
        this.oHash = hash.create();
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54 ^ 92;
        this.oHash.update(pad);
        clean(pad);
      }
      update(buf) {
        aexists2(this);
        this.iHash.update(buf);
        return this;
      }
      digestInto(out) {
        aexists2(this);
        abytes2(out, this.outputLen);
        this.finished = true;
        this.iHash.digestInto(out);
        this.oHash.update(out);
        this.oHash.digestInto(out);
        this.destroy();
      }
      digest() {
        const out = new Uint8Array(this.oHash.outputLen);
        this.digestInto(out);
        return out;
      }
      _cloneInto(to) {
        to || (to = Object.create(Object.getPrototypeOf(this), {}));
        const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
        to = to;
        to.finished = finished;
        to.destroyed = destroyed;
        to.blockLen = blockLen;
        to.outputLen = outputLen;
        to.oHash = oHash._cloneInto(to.oHash);
        to.iHash = iHash._cloneInto(to.iHash);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
      destroy() {
        this.destroyed = true;
        this.oHash.destroy();
        this.iHash.destroy();
      }
    };
    hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
    hmac.create = (hash, key) => new HMAC(hash, key);
  }
});

// node_modules/@noble/hashes/esm/_u64.js
function fromBig2(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK642), l: Number(n >> _32n2 & U32_MASK642) };
  return { h: Number(n >> _32n2 & U32_MASK642) | 0, l: Number(n & U32_MASK642) | 0 };
}
function split2(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig2(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var U32_MASK642, _32n2, shrSH, shrSL, rotrSH, rotrSL, rotrBH, rotrBL, rotlSH2, rotlSL2, rotlBH2, rotlBL2, add3L, add3H, add4L, add4H, add5L, add5H;
var init_u64 = __esm({
  "node_modules/@noble/hashes/esm/_u64.js"() {
    U32_MASK642 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
    _32n2 = /* @__PURE__ */ BigInt(32);
    shrSH = (h, _l, s) => h >>> s;
    shrSL = (h, l, s) => h << 32 - s | l >>> s;
    rotrSH = (h, l, s) => h >>> s | l << 32 - s;
    rotrSL = (h, l, s) => h << 32 - s | l >>> s;
    rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
    rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
    rotlSH2 = (h, l, s) => h << s | l >>> 32 - s;
    rotlSL2 = (h, l, s) => l << s | h >>> 32 - s;
    rotlBH2 = (h, l, s) => l << s - 32 | h >>> 64 - s;
    rotlBL2 = (h, l, s) => h << s - 32 | l >>> 64 - s;
    add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
    add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
    add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
    add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
    add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
    add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
  }
});

// node_modules/@noble/hashes/esm/pbkdf2.js
function pbkdf2Init(hash, _password, _salt, _opts) {
  ahash(hash);
  const opts = checkOpts({ dkLen: 32, asyncTick: 10 }, _opts);
  const { c, dkLen, asyncTick } = opts;
  anumber2(c);
  anumber2(dkLen);
  anumber2(asyncTick);
  if (c < 1)
    throw new Error("iterations (c) should be >= 1");
  const password = kdfInputToBytes(_password);
  const salt = kdfInputToBytes(_salt);
  const DK = new Uint8Array(dkLen);
  const PRF = hmac.create(hash, password);
  const PRFSalt = PRF._cloneInto().update(salt);
  return { c, dkLen, asyncTick, DK, PRF, PRFSalt };
}
function pbkdf2Output(PRF, PRFSalt, DK, prfW, u) {
  PRF.destroy();
  PRFSalt.destroy();
  if (prfW)
    prfW.destroy();
  clean(u);
  return DK;
}
function pbkdf2(hash, password, salt, opts) {
  const { c, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
  let prfW;
  const arr = new Uint8Array(4);
  const view = createView(arr);
  const u = new Uint8Array(PRF.outputLen);
  for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
    const Ti = DK.subarray(pos, pos + PRF.outputLen);
    view.setInt32(0, ti, false);
    (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
    Ti.set(u.subarray(0, Ti.length));
    for (let ui = 1; ui < c; ui++) {
      PRF._cloneInto(prfW).update(u).digestInto(u);
      for (let i = 0; i < Ti.length; i++)
        Ti[i] ^= u[i];
    }
  }
  return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
async function pbkdf2Async(hash, password, salt, opts) {
  const { c, dkLen, asyncTick, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
  let prfW;
  const arr = new Uint8Array(4);
  const view = createView(arr);
  const u = new Uint8Array(PRF.outputLen);
  for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
    const Ti = DK.subarray(pos, pos + PRF.outputLen);
    view.setInt32(0, ti, false);
    (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
    Ti.set(u.subarray(0, Ti.length));
    await asyncLoop(c - 1, asyncTick, () => {
      PRF._cloneInto(prfW).update(u).digestInto(u);
      for (let i = 0; i < Ti.length; i++)
        Ti[i] ^= u[i];
    });
  }
  return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
var init_pbkdf2 = __esm({
  "node_modules/@noble/hashes/esm/pbkdf2.js"() {
    init_hmac();
    init_utils();
  }
});

// node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE3) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE3);
  const _32n3 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n3 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE3 ? 4 : 0;
  const l = isLE3 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE3);
  view.setUint32(byteOffset + l, wl, isLE3);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD, SHA256_IV, SHA512_IV;
var init_md = __esm({
  "node_modules/@noble/hashes/esm/_md.js"() {
    init_utils();
    HashMD = class extends Hash2 {
      constructor(blockLen, outputLen, padOffset, isLE3) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE3;
        this.buffer = new Uint8Array(blockLen);
        this.view = createView(this.buffer);
      }
      update(data) {
        aexists2(this);
        data = toBytes2(data);
        abytes2(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
          const take = Math.min(blockLen - this.pos, len - pos);
          if (take === blockLen) {
            const dataView = createView(data);
            for (; blockLen <= len - pos; pos += blockLen)
              this.process(dataView, pos);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos);
          this.pos += take;
          pos += take;
          if (this.pos === blockLen) {
            this.process(view, 0);
            this.pos = 0;
          }
        }
        this.length += data.length;
        this.roundClean();
        return this;
      }
      digestInto(out) {
        aexists2(this);
        aoutput2(out, this);
        this.finished = true;
        const { buffer, view, blockLen, isLE: isLE3 } = this;
        let { pos } = this;
        buffer[pos++] = 128;
        clean(this.buffer.subarray(pos));
        if (this.padOffset > blockLen - pos) {
          this.process(view, 0);
          pos = 0;
        }
        for (let i = pos; i < blockLen; i++)
          buffer[i] = 0;
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE3);
        this.process(view, 0);
        const oview = createView(out);
        const len = this.outputLen;
        if (len % 4)
          throw new Error("_sha2: outputLen should be aligned to 32bit");
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
          throw new Error("_sha2: outputLen bigger than state");
        for (let i = 0; i < outLen; i++)
          oview.setUint32(4 * i, state[i], isLE3);
      }
      digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
      }
      _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
          to.buffer.set(buffer);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    SHA256_IV = /* @__PURE__ */ Uint32Array.from([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    SHA512_IV = /* @__PURE__ */ Uint32Array.from([
      1779033703,
      4089235720,
      3144134277,
      2227873595,
      1013904242,
      4271175723,
      2773480762,
      1595750129,
      1359893119,
      2917565137,
      2600822924,
      725511199,
      528734635,
      4215389547,
      1541459225,
      327033209
    ]);
  }
});

// node_modules/@noble/hashes/esm/sha2.js
var SHA256_K, SHA256_W, SHA256, K512, SHA512_Kh, SHA512_Kl, SHA512_W_H, SHA512_W_L, SHA512, sha256, sha512;
var init_sha2 = __esm({
  "node_modules/@noble/hashes/esm/sha2.js"() {
    init_md();
    init_u64();
    init_utils();
    SHA256_K = /* @__PURE__ */ Uint32Array.from([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    SHA256_W = /* @__PURE__ */ new Uint32Array(64);
    SHA256 = class extends HashMD {
      constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        this.A = SHA256_IV[0] | 0;
        this.B = SHA256_IV[1] | 0;
        this.C = SHA256_IV[2] | 0;
        this.D = SHA256_IV[3] | 0;
        this.E = SHA256_IV[4] | 0;
        this.F = SHA256_IV[5] | 0;
        this.G = SHA256_IV[6] | 0;
        this.H = SHA256_IV[7] | 0;
      }
      get() {
        const { A, B, C, D: D2, E, F: F2, G, H } = this;
        return [A, B, C, D2, E, F2, G, H];
      }
      // prettier-ignore
      set(A, B, C, D2, E, F2, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D2 | 0;
        this.E = E | 0;
        this.F = F2 | 0;
        this.G = G | 0;
        this.H = H | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA256_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
          const W15 = SHA256_W[i - 15];
          const W2 = SHA256_W[i - 2];
          const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
          const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
          SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
        }
        let { A, B, C, D: D2, E, F: F2, G, H } = this;
        for (let i = 0; i < 64; i++) {
          const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
          const T1 = H + sigma1 + Chi(E, F2, G) + SHA256_K[i] + SHA256_W[i] | 0;
          const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
          const T2 = sigma0 + Maj(A, B, C) | 0;
          H = G;
          G = F2;
          F2 = E;
          E = D2 + T1 | 0;
          D2 = C;
          C = B;
          B = A;
          A = T1 + T2 | 0;
        }
        A = A + this.A | 0;
        B = B + this.B | 0;
        C = C + this.C | 0;
        D2 = D2 + this.D | 0;
        E = E + this.E | 0;
        F2 = F2 + this.F | 0;
        G = G + this.G | 0;
        H = H + this.H | 0;
        this.set(A, B, C, D2, E, F2, G, H);
      }
      roundClean() {
        clean(SHA256_W);
      }
      destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        clean(this.buffer);
      }
    };
    K512 = /* @__PURE__ */ (() => split2([
      "0x428a2f98d728ae22",
      "0x7137449123ef65cd",
      "0xb5c0fbcfec4d3b2f",
      "0xe9b5dba58189dbbc",
      "0x3956c25bf348b538",
      "0x59f111f1b605d019",
      "0x923f82a4af194f9b",
      "0xab1c5ed5da6d8118",
      "0xd807aa98a3030242",
      "0x12835b0145706fbe",
      "0x243185be4ee4b28c",
      "0x550c7dc3d5ffb4e2",
      "0x72be5d74f27b896f",
      "0x80deb1fe3b1696b1",
      "0x9bdc06a725c71235",
      "0xc19bf174cf692694",
      "0xe49b69c19ef14ad2",
      "0xefbe4786384f25e3",
      "0x0fc19dc68b8cd5b5",
      "0x240ca1cc77ac9c65",
      "0x2de92c6f592b0275",
      "0x4a7484aa6ea6e483",
      "0x5cb0a9dcbd41fbd4",
      "0x76f988da831153b5",
      "0x983e5152ee66dfab",
      "0xa831c66d2db43210",
      "0xb00327c898fb213f",
      "0xbf597fc7beef0ee4",
      "0xc6e00bf33da88fc2",
      "0xd5a79147930aa725",
      "0x06ca6351e003826f",
      "0x142929670a0e6e70",
      "0x27b70a8546d22ffc",
      "0x2e1b21385c26c926",
      "0x4d2c6dfc5ac42aed",
      "0x53380d139d95b3df",
      "0x650a73548baf63de",
      "0x766a0abb3c77b2a8",
      "0x81c2c92e47edaee6",
      "0x92722c851482353b",
      "0xa2bfe8a14cf10364",
      "0xa81a664bbc423001",
      "0xc24b8b70d0f89791",
      "0xc76c51a30654be30",
      "0xd192e819d6ef5218",
      "0xd69906245565a910",
      "0xf40e35855771202a",
      "0x106aa07032bbd1b8",
      "0x19a4c116b8d2d0c8",
      "0x1e376c085141ab53",
      "0x2748774cdf8eeb99",
      "0x34b0bcb5e19b48a8",
      "0x391c0cb3c5c95a63",
      "0x4ed8aa4ae3418acb",
      "0x5b9cca4f7763e373",
      "0x682e6ff3d6b2b8a3",
      "0x748f82ee5defb2fc",
      "0x78a5636f43172f60",
      "0x84c87814a1f0ab72",
      "0x8cc702081a6439ec",
      "0x90befffa23631e28",
      "0xa4506cebde82bde9",
      "0xbef9a3f7b2c67915",
      "0xc67178f2e372532b",
      "0xca273eceea26619c",
      "0xd186b8c721c0c207",
      "0xeada7dd6cde0eb1e",
      "0xf57d4f7fee6ed178",
      "0x06f067aa72176fba",
      "0x0a637dc5a2c898a6",
      "0x113f9804bef90dae",
      "0x1b710b35131c471b",
      "0x28db77f523047d84",
      "0x32caab7b40c72493",
      "0x3c9ebe0a15c9bebc",
      "0x431d67c49c100d4c",
      "0x4cc5d4becb3e42b6",
      "0x597f299cfc657e2a",
      "0x5fcb6fab3ad6faec",
      "0x6c44198c4a475817"
    ].map((n) => BigInt(n))))();
    SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
    SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
    SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
    SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
    SHA512 = class extends HashMD {
      constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        this.Ah = SHA512_IV[0] | 0;
        this.Al = SHA512_IV[1] | 0;
        this.Bh = SHA512_IV[2] | 0;
        this.Bl = SHA512_IV[3] | 0;
        this.Ch = SHA512_IV[4] | 0;
        this.Cl = SHA512_IV[5] | 0;
        this.Dh = SHA512_IV[6] | 0;
        this.Dl = SHA512_IV[7] | 0;
        this.Eh = SHA512_IV[8] | 0;
        this.El = SHA512_IV[9] | 0;
        this.Fh = SHA512_IV[10] | 0;
        this.Fl = SHA512_IV[11] | 0;
        this.Gh = SHA512_IV[12] | 0;
        this.Gl = SHA512_IV[13] | 0;
        this.Hh = SHA512_IV[14] | 0;
        this.Hl = SHA512_IV[15] | 0;
      }
      // prettier-ignore
      get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
      }
      // prettier-ignore
      set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4) {
          SHA512_W_H[i] = view.getUint32(offset);
          SHA512_W_L[i] = view.getUint32(offset += 4);
        }
        for (let i = 16; i < 80; i++) {
          const W15h = SHA512_W_H[i - 15] | 0;
          const W15l = SHA512_W_L[i - 15] | 0;
          const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
          const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
          const W2h = SHA512_W_H[i - 2] | 0;
          const W2l = SHA512_W_L[i - 2] | 0;
          const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
          const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
          const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
          const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
          SHA512_W_H[i] = SUMh | 0;
          SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        for (let i = 0; i < 80; i++) {
          const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
          const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
          const CHIh = Eh & Fh ^ ~Eh & Gh;
          const CHIl = El & Fl ^ ~El & Gl;
          const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
          const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
          const T1l = T1ll | 0;
          const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
          const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
          const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
          const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
          Hh = Gh | 0;
          Hl = Gl | 0;
          Gh = Fh | 0;
          Gl = Fl | 0;
          Fh = Eh | 0;
          Fl = El | 0;
          ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
          Dh = Ch | 0;
          Dl = Cl | 0;
          Ch = Bh | 0;
          Cl = Bl | 0;
          Bh = Ah | 0;
          Bl = Al | 0;
          const All = add3L(T1l, sigma0l, MAJl);
          Ah = add3H(All, T1h, sigma0h, MAJh);
          Al = All | 0;
        }
        ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
      }
      roundClean() {
        clean(SHA512_W_H, SHA512_W_L);
      }
      destroy() {
        clean(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    };
    sha256 = /* @__PURE__ */ createHasher(() => new SHA256());
    sha512 = /* @__PURE__ */ createHasher(() => new SHA512());
  }
});

// node_modules/@scure/base/lib/esm/index.js
function isBytes3(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function isArrayOf(isString, arr) {
  if (!Array.isArray(arr))
    return false;
  if (arr.length === 0)
    return true;
  if (isString) {
    return arr.every((item) => typeof item === "string");
  } else {
    return arr.every((item) => Number.isSafeInteger(item));
  }
}
function afn(input) {
  if (typeof input !== "function")
    throw new Error("function expected");
  return true;
}
function astr(label, input) {
  if (typeof input !== "string")
    throw new Error(`${label}: string expected`);
  return true;
}
function anumber3(n) {
  if (!Number.isSafeInteger(n))
    throw new Error(`invalid integer: ${n}`);
}
function aArr(input) {
  if (!Array.isArray(input))
    throw new Error("array expected");
}
function astrArr(label, input) {
  if (!isArrayOf(true, input))
    throw new Error(`${label}: array of strings expected`);
}
function anumArr(label, input) {
  if (!isArrayOf(false, input))
    throw new Error(`${label}: array of numbers expected`);
}
// @__NO_SIDE_EFFECTS__
function chain(...args) {
  const id2 = (a) => a;
  const wrap = (a, b) => (c) => a(b(c));
  const encode = args.map((x) => x.encode).reduceRight(wrap, id2);
  const decode = args.map((x) => x.decode).reduce(wrap, id2);
  return { encode, decode };
}
// @__NO_SIDE_EFFECTS__
function alphabet(letters) {
  const lettersA = typeof letters === "string" ? letters.split("") : letters;
  const len = lettersA.length;
  astrArr("alphabet", lettersA);
  const indexes = new Map(lettersA.map((l, i) => [l, i]));
  return {
    encode: (digits) => {
      aArr(digits);
      return digits.map((i) => {
        if (!Number.isSafeInteger(i) || i < 0 || i >= len)
          throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
        return lettersA[i];
      });
    },
    decode: (input) => {
      aArr(input);
      return input.map((letter) => {
        astr("alphabet.decode", letter);
        const i = indexes.get(letter);
        if (i === void 0)
          throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
        return i;
      });
    }
  };
}
// @__NO_SIDE_EFFECTS__
function join(separator = "") {
  astr("join", separator);
  return {
    encode: (from) => {
      astrArr("join.decode", from);
      return from.join(separator);
    },
    decode: (to) => {
      astr("join.decode", to);
      return to.split(separator);
    }
  };
}
// @__NO_SIDE_EFFECTS__
function padding(bits, chr = "=") {
  anumber3(bits);
  astr("padding", chr);
  return {
    encode(data) {
      astrArr("padding.encode", data);
      while (data.length * bits % 8)
        data.push(chr);
      return data;
    },
    decode(input) {
      astrArr("padding.decode", input);
      let end = input.length;
      if (end * bits % 8)
        throw new Error("padding: invalid, string should have whole number of bytes");
      for (; end > 0 && input[end - 1] === chr; end--) {
        const last = end - 1;
        const byte = last * bits;
        if (byte % 8 === 0)
          throw new Error("padding: invalid, string has too much padding");
      }
      return input.slice(0, end);
    }
  };
}
function convertRadix(data, from, to) {
  if (from < 2)
    throw new Error(`convertRadix: invalid from=${from}, base cannot be less than 2`);
  if (to < 2)
    throw new Error(`convertRadix: invalid to=${to}, base cannot be less than 2`);
  aArr(data);
  if (!data.length)
    return [];
  let pos = 0;
  const res = [];
  const digits = Array.from(data, (d) => {
    anumber3(d);
    if (d < 0 || d >= from)
      throw new Error(`invalid integer: ${d}`);
    return d;
  });
  const dlen = digits.length;
  while (true) {
    let carry = 0;
    let done = true;
    for (let i = pos; i < dlen; i++) {
      const digit = digits[i];
      const fromCarry = from * carry;
      const digitBase = fromCarry + digit;
      if (!Number.isSafeInteger(digitBase) || fromCarry / from !== carry || digitBase - digit !== fromCarry) {
        throw new Error("convertRadix: carry overflow");
      }
      const div = digitBase / to;
      carry = digitBase % to;
      const rounded = Math.floor(div);
      digits[i] = rounded;
      if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
        throw new Error("convertRadix: carry overflow");
      if (!done)
        continue;
      else if (!rounded)
        pos = i;
      else
        done = false;
    }
    res.push(carry);
    if (done)
      break;
  }
  for (let i = 0; i < data.length - 1 && data[i] === 0; i++)
    res.push(0);
  return res.reverse();
}
function convertRadix2(data, from, to, padding2) {
  aArr(data);
  if (from <= 0 || from > 32)
    throw new Error(`convertRadix2: wrong from=${from}`);
  if (to <= 0 || to > 32)
    throw new Error(`convertRadix2: wrong to=${to}`);
  if (/* @__PURE__ */ radix2carry(from, to) > 32) {
    throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry(from, to)}`);
  }
  let carry = 0;
  let pos = 0;
  const max = powers[from];
  const mask = powers[to] - 1;
  const res = [];
  for (const n of data) {
    anumber3(n);
    if (n >= max)
      throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
    carry = carry << from | n;
    if (pos + from > 32)
      throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
    pos += from;
    for (; pos >= to; pos -= to)
      res.push((carry >> pos - to & mask) >>> 0);
    const pow = powers[pos];
    if (pow === void 0)
      throw new Error("invalid carry");
    carry &= pow - 1;
  }
  carry = carry << to - pos & mask;
  if (!padding2 && pos >= from)
    throw new Error("Excess padding");
  if (!padding2 && carry > 0)
    throw new Error(`Non-zero padding: ${carry}`);
  if (padding2 && pos > 0)
    res.push(carry >>> 0);
  return res;
}
// @__NO_SIDE_EFFECTS__
function radix(num) {
  anumber3(num);
  const _256 = 2 ** 8;
  return {
    encode: (bytes) => {
      if (!isBytes3(bytes))
        throw new Error("radix.encode input should be Uint8Array");
      return convertRadix(Array.from(bytes), _256, num);
    },
    decode: (digits) => {
      anumArr("radix.decode", digits);
      return Uint8Array.from(convertRadix(digits, num, _256));
    }
  };
}
// @__NO_SIDE_EFFECTS__
function radix2(bits, revPadding = false) {
  anumber3(bits);
  if (bits <= 0 || bits > 32)
    throw new Error("radix2: bits should be in (0..32]");
  if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32)
    throw new Error("radix2: carry overflow");
  return {
    encode: (bytes) => {
      if (!isBytes3(bytes))
        throw new Error("radix2.encode input should be Uint8Array");
      return convertRadix2(Array.from(bytes), 8, bits, !revPadding);
    },
    decode: (digits) => {
      anumArr("radix2.decode", digits);
      return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
    }
  };
}
function checksum(len, fn) {
  anumber3(len);
  afn(fn);
  return {
    encode(data) {
      if (!isBytes3(data))
        throw new Error("checksum.encode: input should be Uint8Array");
      const sum = fn(data).slice(0, len);
      const res = new Uint8Array(data.length + len);
      res.set(data);
      res.set(sum, data.length);
      return res;
    },
    decode(data) {
      if (!isBytes3(data))
        throw new Error("checksum.decode: input should be Uint8Array");
      const payload = data.slice(0, -len);
      const oldChecksum = data.slice(-len);
      const newChecksum = fn(payload).slice(0, len);
      for (let i = 0; i < len; i++)
        if (newChecksum[i] !== oldChecksum[i])
          throw new Error("Invalid checksum");
      return payload;
    }
  };
}
var gcd, radix2carry, powers, utils;
var init_esm = __esm({
  "node_modules/@scure/base/lib/esm/index.js"() {
    gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
    powers = /* @__PURE__ */ (() => {
      let res = [];
      for (let i = 0; i < 40; i++)
        res.push(2 ** i);
      return res;
    })();
    utils = {
      alphabet,
      chain,
      checksum,
      convertRadix,
      convertRadix2,
      radix,
      radix2,
      join,
      padding
    };
  }
});

// node_modules/@scure/bip39/esm/index.js
var esm_exports = {};
__export(esm_exports, {
  entropyToMnemonic: () => entropyToMnemonic,
  generateMnemonic: () => generateMnemonic,
  mnemonicToEntropy: () => mnemonicToEntropy,
  mnemonicToSeed: () => mnemonicToSeed,
  mnemonicToSeedSync: () => mnemonicToSeedSync,
  validateMnemonic: () => validateMnemonic
});
function nfkd(str) {
  if (typeof str !== "string")
    throw new TypeError("invalid mnemonic type: " + typeof str);
  return str.normalize("NFKD");
}
function normalize(str) {
  const norm = nfkd(str);
  const words = norm.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length))
    throw new Error("Invalid mnemonic");
  return { nfkd: norm, words };
}
function aentropy(ent) {
  abytes2(ent, 16, 20, 24, 28, 32);
}
function generateMnemonic(wordlist2, strength = 128) {
  anumber2(strength);
  if (strength % 32 !== 0 || strength > 256)
    throw new TypeError("Invalid entropy");
  return entropyToMnemonic(randomBytes3(strength / 8), wordlist2);
}
function getCoder(wordlist2) {
  if (!Array.isArray(wordlist2) || wordlist2.length !== 2048 || typeof wordlist2[0] !== "string")
    throw new Error("Wordlist: expected array of 2048 strings");
  wordlist2.forEach((i) => {
    if (typeof i !== "string")
      throw new Error("wordlist: non-string element: " + i);
  });
  return utils.chain(utils.checksum(1, calcChecksum), utils.radix2(11, true), utils.alphabet(wordlist2));
}
function mnemonicToEntropy(mnemonic, wordlist2) {
  const { words } = normalize(mnemonic);
  const entropy = getCoder(wordlist2).decode(words);
  aentropy(entropy);
  return entropy;
}
function entropyToMnemonic(entropy, wordlist2) {
  aentropy(entropy);
  const words = getCoder(wordlist2).encode(entropy);
  return words.join(isJapanese(wordlist2) ? "\u3000" : " ");
}
function validateMnemonic(mnemonic, wordlist2) {
  try {
    mnemonicToEntropy(mnemonic, wordlist2);
  } catch (e) {
    return false;
  }
  return true;
}
function mnemonicToSeed(mnemonic, passphrase = "") {
  return pbkdf2Async(sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
}
function mnemonicToSeedSync(mnemonic, passphrase = "") {
  return pbkdf2(sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
}
var isJapanese, calcChecksum, psalt;
var init_esm2 = __esm({
  "node_modules/@scure/bip39/esm/index.js"() {
    init_pbkdf2();
    init_sha2();
    init_utils();
    init_esm();
    isJapanese = (wordlist2) => wordlist2[0] === "\u3042\u3044\u3053\u304F\u3057\u3093";
    calcChecksum = (entropy) => {
      const bitsLeft = 8 - entropy.length / 4;
      return new Uint8Array([sha256(entropy)[0] >> bitsLeft << bitsLeft]);
    };
    psalt = (passphrase) => nfkd("mnemonic" + passphrase);
  }
});

// node_modules/@scure/bip39/esm/wordlists/english.js
var english_exports = {};
__export(english_exports, {
  wordlist: () => wordlist
});
var wordlist;
var init_english = __esm({
  "node_modules/@scure/bip39/esm/wordlists/english.js"() {
    wordlist = `abandon
ability
able
about
above
absent
absorb
abstract
absurd
abuse
access
accident
account
accuse
achieve
acid
acoustic
acquire
across
act
action
actor
actress
actual
adapt
add
addict
address
adjust
admit
adult
advance
advice
aerobic
affair
afford
afraid
again
age
agent
agree
ahead
aim
air
airport
aisle
alarm
album
alcohol
alert
alien
all
alley
allow
almost
alone
alpha
already
also
alter
always
amateur
amazing
among
amount
amused
analyst
anchor
ancient
anger
angle
angry
animal
ankle
announce
annual
another
answer
antenna
antique
anxiety
any
apart
apology
appear
apple
approve
april
arch
arctic
area
arena
argue
arm
armed
armor
army
around
arrange
arrest
arrive
arrow
art
artefact
artist
artwork
ask
aspect
assault
asset
assist
assume
asthma
athlete
atom
attack
attend
attitude
attract
auction
audit
august
aunt
author
auto
autumn
average
avocado
avoid
awake
aware
away
awesome
awful
awkward
axis
baby
bachelor
bacon
badge
bag
balance
balcony
ball
bamboo
banana
banner
bar
barely
bargain
barrel
base
basic
basket
battle
beach
bean
beauty
because
become
beef
before
begin
behave
behind
believe
below
belt
bench
benefit
best
betray
better
between
beyond
bicycle
bid
bike
bind
biology
bird
birth
bitter
black
blade
blame
blanket
blast
bleak
bless
blind
blood
blossom
blouse
blue
blur
blush
board
boat
body
boil
bomb
bone
bonus
book
boost
border
boring
borrow
boss
bottom
bounce
box
boy
bracket
brain
brand
brass
brave
bread
breeze
brick
bridge
brief
bright
bring
brisk
broccoli
broken
bronze
broom
brother
brown
brush
bubble
buddy
budget
buffalo
build
bulb
bulk
bullet
bundle
bunker
burden
burger
burst
bus
business
busy
butter
buyer
buzz
cabbage
cabin
cable
cactus
cage
cake
call
calm
camera
camp
can
canal
cancel
candy
cannon
canoe
canvas
canyon
capable
capital
captain
car
carbon
card
cargo
carpet
carry
cart
case
cash
casino
castle
casual
cat
catalog
catch
category
cattle
caught
cause
caution
cave
ceiling
celery
cement
census
century
cereal
certain
chair
chalk
champion
change
chaos
chapter
charge
chase
chat
cheap
check
cheese
chef
cherry
chest
chicken
chief
child
chimney
choice
choose
chronic
chuckle
chunk
churn
cigar
cinnamon
circle
citizen
city
civil
claim
clap
clarify
claw
clay
clean
clerk
clever
click
client
cliff
climb
clinic
clip
clock
clog
close
cloth
cloud
clown
club
clump
cluster
clutch
coach
coast
coconut
code
coffee
coil
coin
collect
color
column
combine
come
comfort
comic
common
company
concert
conduct
confirm
congress
connect
consider
control
convince
cook
cool
copper
copy
coral
core
corn
correct
cost
cotton
couch
country
couple
course
cousin
cover
coyote
crack
cradle
craft
cram
crane
crash
crater
crawl
crazy
cream
credit
creek
crew
cricket
crime
crisp
critic
crop
cross
crouch
crowd
crucial
cruel
cruise
crumble
crunch
crush
cry
crystal
cube
culture
cup
cupboard
curious
current
curtain
curve
cushion
custom
cute
cycle
dad
damage
damp
dance
danger
daring
dash
daughter
dawn
day
deal
debate
debris
decade
december
decide
decline
decorate
decrease
deer
defense
define
defy
degree
delay
deliver
demand
demise
denial
dentist
deny
depart
depend
deposit
depth
deputy
derive
describe
desert
design
desk
despair
destroy
detail
detect
develop
device
devote
diagram
dial
diamond
diary
dice
diesel
diet
differ
digital
dignity
dilemma
dinner
dinosaur
direct
dirt
disagree
discover
disease
dish
dismiss
disorder
display
distance
divert
divide
divorce
dizzy
doctor
document
dog
doll
dolphin
domain
donate
donkey
donor
door
dose
double
dove
draft
dragon
drama
drastic
draw
dream
dress
drift
drill
drink
drip
drive
drop
drum
dry
duck
dumb
dune
during
dust
dutch
duty
dwarf
dynamic
eager
eagle
early
earn
earth
easily
east
easy
echo
ecology
economy
edge
edit
educate
effort
egg
eight
either
elbow
elder
electric
elegant
element
elephant
elevator
elite
else
embark
embody
embrace
emerge
emotion
employ
empower
empty
enable
enact
end
endless
endorse
enemy
energy
enforce
engage
engine
enhance
enjoy
enlist
enough
enrich
enroll
ensure
enter
entire
entry
envelope
episode
equal
equip
era
erase
erode
erosion
error
erupt
escape
essay
essence
estate
eternal
ethics
evidence
evil
evoke
evolve
exact
example
excess
exchange
excite
exclude
excuse
execute
exercise
exhaust
exhibit
exile
exist
exit
exotic
expand
expect
expire
explain
expose
express
extend
extra
eye
eyebrow
fabric
face
faculty
fade
faint
faith
fall
false
fame
family
famous
fan
fancy
fantasy
farm
fashion
fat
fatal
father
fatigue
fault
favorite
feature
february
federal
fee
feed
feel
female
fence
festival
fetch
fever
few
fiber
fiction
field
figure
file
film
filter
final
find
fine
finger
finish
fire
firm
first
fiscal
fish
fit
fitness
fix
flag
flame
flash
flat
flavor
flee
flight
flip
float
flock
floor
flower
fluid
flush
fly
foam
focus
fog
foil
fold
follow
food
foot
force
forest
forget
fork
fortune
forum
forward
fossil
foster
found
fox
fragile
frame
frequent
fresh
friend
fringe
frog
front
frost
frown
frozen
fruit
fuel
fun
funny
furnace
fury
future
gadget
gain
galaxy
gallery
game
gap
garage
garbage
garden
garlic
garment
gas
gasp
gate
gather
gauge
gaze
general
genius
genre
gentle
genuine
gesture
ghost
giant
gift
giggle
ginger
giraffe
girl
give
glad
glance
glare
glass
glide
glimpse
globe
gloom
glory
glove
glow
glue
goat
goddess
gold
good
goose
gorilla
gospel
gossip
govern
gown
grab
grace
grain
grant
grape
grass
gravity
great
green
grid
grief
grit
grocery
group
grow
grunt
guard
guess
guide
guilt
guitar
gun
gym
habit
hair
half
hammer
hamster
hand
happy
harbor
hard
harsh
harvest
hat
have
hawk
hazard
head
health
heart
heavy
hedgehog
height
hello
helmet
help
hen
hero
hidden
high
hill
hint
hip
hire
history
hobby
hockey
hold
hole
holiday
hollow
home
honey
hood
hope
horn
horror
horse
hospital
host
hotel
hour
hover
hub
huge
human
humble
humor
hundred
hungry
hunt
hurdle
hurry
hurt
husband
hybrid
ice
icon
idea
identify
idle
ignore
ill
illegal
illness
image
imitate
immense
immune
impact
impose
improve
impulse
inch
include
income
increase
index
indicate
indoor
industry
infant
inflict
inform
inhale
inherit
initial
inject
injury
inmate
inner
innocent
input
inquiry
insane
insect
inside
inspire
install
intact
interest
into
invest
invite
involve
iron
island
isolate
issue
item
ivory
jacket
jaguar
jar
jazz
jealous
jeans
jelly
jewel
job
join
joke
journey
joy
judge
juice
jump
jungle
junior
junk
just
kangaroo
keen
keep
ketchup
key
kick
kid
kidney
kind
kingdom
kiss
kit
kitchen
kite
kitten
kiwi
knee
knife
knock
know
lab
label
labor
ladder
lady
lake
lamp
language
laptop
large
later
latin
laugh
laundry
lava
law
lawn
lawsuit
layer
lazy
leader
leaf
learn
leave
lecture
left
leg
legal
legend
leisure
lemon
lend
length
lens
leopard
lesson
letter
level
liar
liberty
library
license
life
lift
light
like
limb
limit
link
lion
liquid
list
little
live
lizard
load
loan
lobster
local
lock
logic
lonely
long
loop
lottery
loud
lounge
love
loyal
lucky
luggage
lumber
lunar
lunch
luxury
lyrics
machine
mad
magic
magnet
maid
mail
main
major
make
mammal
man
manage
mandate
mango
mansion
manual
maple
marble
march
margin
marine
market
marriage
mask
mass
master
match
material
math
matrix
matter
maximum
maze
meadow
mean
measure
meat
mechanic
medal
media
melody
melt
member
memory
mention
menu
mercy
merge
merit
merry
mesh
message
metal
method
middle
midnight
milk
million
mimic
mind
minimum
minor
minute
miracle
mirror
misery
miss
mistake
mix
mixed
mixture
mobile
model
modify
mom
moment
monitor
monkey
monster
month
moon
moral
more
morning
mosquito
mother
motion
motor
mountain
mouse
move
movie
much
muffin
mule
multiply
muscle
museum
mushroom
music
must
mutual
myself
mystery
myth
naive
name
napkin
narrow
nasty
nation
nature
near
neck
need
negative
neglect
neither
nephew
nerve
nest
net
network
neutral
never
news
next
nice
night
noble
noise
nominee
noodle
normal
north
nose
notable
note
nothing
notice
novel
now
nuclear
number
nurse
nut
oak
obey
object
oblige
obscure
observe
obtain
obvious
occur
ocean
october
odor
off
offer
office
often
oil
okay
old
olive
olympic
omit
once
one
onion
online
only
open
opera
opinion
oppose
option
orange
orbit
orchard
order
ordinary
organ
orient
original
orphan
ostrich
other
outdoor
outer
output
outside
oval
oven
over
own
owner
oxygen
oyster
ozone
pact
paddle
page
pair
palace
palm
panda
panel
panic
panther
paper
parade
parent
park
parrot
party
pass
patch
path
patient
patrol
pattern
pause
pave
payment
peace
peanut
pear
peasant
pelican
pen
penalty
pencil
people
pepper
perfect
permit
person
pet
phone
photo
phrase
physical
piano
picnic
picture
piece
pig
pigeon
pill
pilot
pink
pioneer
pipe
pistol
pitch
pizza
place
planet
plastic
plate
play
please
pledge
pluck
plug
plunge
poem
poet
point
polar
pole
police
pond
pony
pool
popular
portion
position
possible
post
potato
pottery
poverty
powder
power
practice
praise
predict
prefer
prepare
present
pretty
prevent
price
pride
primary
print
priority
prison
private
prize
problem
process
produce
profit
program
project
promote
proof
property
prosper
protect
proud
provide
public
pudding
pull
pulp
pulse
pumpkin
punch
pupil
puppy
purchase
purity
purpose
purse
push
put
puzzle
pyramid
quality
quantum
quarter
question
quick
quit
quiz
quote
rabbit
raccoon
race
rack
radar
radio
rail
rain
raise
rally
ramp
ranch
random
range
rapid
rare
rate
rather
raven
raw
razor
ready
real
reason
rebel
rebuild
recall
receive
recipe
record
recycle
reduce
reflect
reform
refuse
region
regret
regular
reject
relax
release
relief
rely
remain
remember
remind
remove
render
renew
rent
reopen
repair
repeat
replace
report
require
rescue
resemble
resist
resource
response
result
retire
retreat
return
reunion
reveal
review
reward
rhythm
rib
ribbon
rice
rich
ride
ridge
rifle
right
rigid
ring
riot
ripple
risk
ritual
rival
river
road
roast
robot
robust
rocket
romance
roof
rookie
room
rose
rotate
rough
round
route
royal
rubber
rude
rug
rule
run
runway
rural
sad
saddle
sadness
safe
sail
salad
salmon
salon
salt
salute
same
sample
sand
satisfy
satoshi
sauce
sausage
save
say
scale
scan
scare
scatter
scene
scheme
school
science
scissors
scorpion
scout
scrap
screen
script
scrub
sea
search
season
seat
second
secret
section
security
seed
seek
segment
select
sell
seminar
senior
sense
sentence
series
service
session
settle
setup
seven
shadow
shaft
shallow
share
shed
shell
sheriff
shield
shift
shine
ship
shiver
shock
shoe
shoot
shop
short
shoulder
shove
shrimp
shrug
shuffle
shy
sibling
sick
side
siege
sight
sign
silent
silk
silly
silver
similar
simple
since
sing
siren
sister
situate
six
size
skate
sketch
ski
skill
skin
skirt
skull
slab
slam
sleep
slender
slice
slide
slight
slim
slogan
slot
slow
slush
small
smart
smile
smoke
smooth
snack
snake
snap
sniff
snow
soap
soccer
social
sock
soda
soft
solar
soldier
solid
solution
solve
someone
song
soon
sorry
sort
soul
sound
soup
source
south
space
spare
spatial
spawn
speak
special
speed
spell
spend
sphere
spice
spider
spike
spin
spirit
split
spoil
sponsor
spoon
sport
spot
spray
spread
spring
spy
square
squeeze
squirrel
stable
stadium
staff
stage
stairs
stamp
stand
start
state
stay
steak
steel
stem
step
stereo
stick
still
sting
stock
stomach
stone
stool
story
stove
strategy
street
strike
strong
struggle
student
stuff
stumble
style
subject
submit
subway
success
such
sudden
suffer
sugar
suggest
suit
summer
sun
sunny
sunset
super
supply
supreme
sure
surface
surge
surprise
surround
survey
suspect
sustain
swallow
swamp
swap
swarm
swear
sweet
swift
swim
swing
switch
sword
symbol
symptom
syrup
system
table
tackle
tag
tail
talent
talk
tank
tape
target
task
taste
tattoo
taxi
teach
team
tell
ten
tenant
tennis
tent
term
test
text
thank
that
theme
then
theory
there
they
thing
this
thought
three
thrive
throw
thumb
thunder
ticket
tide
tiger
tilt
timber
time
tiny
tip
tired
tissue
title
toast
tobacco
today
toddler
toe
together
toilet
token
tomato
tomorrow
tone
tongue
tonight
tool
tooth
top
topic
topple
torch
tornado
tortoise
toss
total
tourist
toward
tower
town
toy
track
trade
traffic
tragic
train
transfer
trap
trash
travel
tray
treat
tree
trend
trial
tribe
trick
trigger
trim
trip
trophy
trouble
truck
true
truly
trumpet
trust
truth
try
tube
tuition
tumble
tuna
tunnel
turkey
turn
turtle
twelve
twenty
twice
twin
twist
two
type
typical
ugly
umbrella
unable
unaware
uncle
uncover
under
undo
unfair
unfold
unhappy
uniform
unique
unit
universe
unknown
unlock
until
unusual
unveil
update
upgrade
uphold
upon
upper
upset
urban
urge
usage
use
used
useful
useless
usual
utility
vacant
vacuum
vague
valid
valley
valve
van
vanish
vapor
various
vast
vault
vehicle
velvet
vendor
venture
venue
verb
verify
version
very
vessel
veteran
viable
vibrant
vicious
victory
video
view
village
vintage
violin
virtual
virus
visa
visit
visual
vital
vivid
vocal
voice
void
volcano
volume
vote
voyage
wage
wagon
wait
walk
wall
walnut
want
warfare
warm
warrior
wash
wasp
waste
water
wave
way
wealth
weapon
wear
weasel
weather
web
wedding
weekend
weird
welcome
west
wet
whale
what
wheat
wheel
when
where
whip
whisper
wide
width
wife
wild
will
win
window
wine
wing
wink
winner
winter
wire
wisdom
wise
wish
witness
wolf
woman
wonder
wood
wool
word
work
world
worry
worth
wrap
wreck
wrestle
wrist
write
wrong
yard
year
yellow
you
young
youth
zebra
zero
zone
zoo`.split("\n");
  }
});

// node_modules/@noble/post-quantum/node_modules/@noble/hashes/esm/_assert.js
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}

// node_modules/@noble/post-quantum/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  let Ah = new Uint32Array(lst.length);
  let Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/@noble/post-quantum/node_modules/@noble/hashes/esm/crypto.js
var crypto2 = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;

// node_modules/@noble/post-quantum/node_modules/@noble/hashes/esm/utils.js
var u32 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
var byteSwap = (word) => word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("utf8ToBytes expected string, got " + typeof str);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
function wrapConstructor(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function wrapXOFConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}
function randomBytes(bytesLength = 32) {
  if (crypto2 && typeof crypto2.getRandomValues === "function") {
    return crypto2.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto2 && typeof crypto2.randomBytes === "function") {
    return crypto2.randomBytes(bytesLength);
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/@noble/post-quantum/node_modules/@noble/hashes/esm/sha3.js
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _7n = /* @__PURE__ */ BigInt(7);
var _256n = /* @__PURE__ */ BigInt(256);
var _0x71n = /* @__PURE__ */ BigInt(113);
for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n)
      t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n;
  }
  _SHA3_IOTA.push(t);
}
var [SHA3_IOTA_H, SHA3_IOTA_L] = /* @__PURE__ */ split(_SHA3_IOTA, true);
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  B.fill(0);
}
var Keccak = class _Keccak extends Hash {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    anumber(outputLen);
    if (0 >= this.blockLen || this.blockLen >= 200)
      throw new Error("Sha3 supports only keccak-f1600 function");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  keccak() {
    if (!isLE)
      byteSwap32(this.state32);
    keccakP(this.state32, this.rounds);
    if (!isLE)
      byteSwap32(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    const { blockLen, state } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen = (suffix, blockLen, outputLen) => wrapConstructor(() => new Keccak(blockLen, suffix, outputLen));
var sha3_224 = /* @__PURE__ */ gen(6, 144, 224 / 8);
var sha3_256 = /* @__PURE__ */ gen(6, 136, 256 / 8);
var sha3_384 = /* @__PURE__ */ gen(6, 104, 384 / 8);
var sha3_512 = /* @__PURE__ */ gen(6, 72, 512 / 8);
var keccak_224 = /* @__PURE__ */ gen(1, 144, 224 / 8);
var keccak_256 = /* @__PURE__ */ gen(1, 136, 256 / 8);
var keccak_384 = /* @__PURE__ */ gen(1, 104, 384 / 8);
var keccak_512 = /* @__PURE__ */ gen(1, 72, 512 / 8);
var genShake = (suffix, blockLen, outputLen) => wrapXOFConstructorWithOpts((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
var shake128 = /* @__PURE__ */ genShake(31, 168, 128 / 8);
var shake256 = /* @__PURE__ */ genShake(31, 136, 256 / 8);

// node_modules/@noble/post-quantum/esm/utils.js
var ensureBytes = abytes;
var randomBytes2 = randomBytes;
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function splitCoder(...lengths) {
  const getLength = (c) => typeof c === "number" ? c : c.bytesLen;
  const bytesLen = lengths.reduce((sum, a) => sum + getLength(a), 0);
  return {
    bytesLen,
    encode: (bufs) => {
      const res = new Uint8Array(bytesLen);
      for (let i = 0, pos = 0; i < lengths.length; i++) {
        const c = lengths[i];
        const l = getLength(c);
        const b = typeof c === "number" ? bufs[i] : c.encode(bufs[i]);
        ensureBytes(b, l);
        res.set(b, pos);
        if (typeof c !== "number")
          b.fill(0);
        pos += l;
      }
      return res;
    },
    decode: (buf) => {
      ensureBytes(buf, bytesLen);
      const res = [];
      for (const c of lengths) {
        const l = getLength(c);
        const b = buf.subarray(0, l);
        res.push(typeof c === "number" ? b : c.decode(b));
        buf = buf.subarray(l);
      }
      return res;
    }
  };
}
function vecCoder(c, vecLen) {
  const bytesLen = vecLen * c.bytesLen;
  return {
    bytesLen,
    encode: (u) => {
      if (u.length !== vecLen)
        throw new Error(`vecCoder.encode: wrong length=${u.length}. Expected: ${vecLen}`);
      const res = new Uint8Array(bytesLen);
      for (let i = 0, pos = 0; i < u.length; i++) {
        const b = c.encode(u[i]);
        res.set(b, pos);
        b.fill(0);
        pos += b.length;
      }
      return res;
    },
    decode: (a) => {
      ensureBytes(a, bytesLen);
      const r = [];
      for (let i = 0; i < a.length; i += c.bytesLen)
        r.push(c.decode(a.subarray(i, i + c.bytesLen)));
      return r;
    }
  };
}
function cleanBytes(...list) {
  for (const t of list) {
    if (Array.isArray(t))
      for (const b of t)
        b.fill(0);
    else
      t.fill(0);
  }
}
function getMask(bits) {
  return (1 << bits) - 1;
}

// node_modules/@noble/post-quantum/esm/_crystals.js
function bitReversal(n, bits = 8) {
  const padded = n.toString(2).padStart(8, "0");
  const sliced = padded.slice(-bits).padStart(7, "0");
  const revrsd = sliced.split("").reverse().join("");
  return Number.parseInt(revrsd, 2);
}
var genCrystals = (opts) => {
  const { newPoly: newPoly2, N: N2, Q: Q2, F: F2, ROOT_OF_UNITY: ROOT_OF_UNITY2, brvBits, isKyber } = opts;
  const mod2 = (a, modulo = Q2) => {
    const result = a % modulo | 0;
    return (result >= 0 ? result | 0 : modulo + result | 0) | 0;
  };
  const smod2 = (a, modulo = Q2) => {
    const r = mod2(a, modulo) | 0;
    return (r > modulo >> 1 ? r - modulo | 0 : r) | 0;
  };
  function getZettas() {
    const out = newPoly2(N2);
    for (let i = 0; i < N2; i++) {
      const b = bitReversal(i, brvBits);
      const p = BigInt(ROOT_OF_UNITY2) ** BigInt(b) % BigInt(Q2);
      out[i] = Number(p) | 0;
    }
    return out;
  }
  const nttZetas = getZettas();
  const LEN1 = isKyber ? 128 : N2;
  const LEN2 = isKyber ? 1 : 0;
  const NTT2 = {
    encode: (r) => {
      for (let k = 1, len = 128; len > LEN2; len >>= 1) {
        for (let start = 0; start < N2; start += 2 * len) {
          const zeta = nttZetas[k++];
          for (let j = start; j < start + len; j++) {
            const t = mod2(zeta * r[j + len]);
            r[j + len] = mod2(r[j] - t) | 0;
            r[j] = mod2(r[j] + t) | 0;
          }
        }
      }
      return r;
    },
    decode: (r) => {
      for (let k = LEN1 - 1, len = 1 + LEN2; len < LEN1 + LEN2; len <<= 1) {
        for (let start = 0; start < N2; start += 2 * len) {
          const zeta = nttZetas[k--];
          for (let j = start; j < start + len; j++) {
            const t = r[j];
            r[j] = mod2(t + r[j + len]);
            r[j + len] = mod2(zeta * (r[j + len] - t));
          }
        }
      }
      for (let i = 0; i < r.length; i++)
        r[i] = mod2(F2 * r[i]);
      return r;
    }
  };
  const bitsCoder2 = (d, c) => {
    const mask = getMask(d);
    const bytesLen = d * (N2 / 8);
    return {
      bytesLen,
      encode: (poly) => {
        const r = new Uint8Array(bytesLen);
        for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < poly.length; i++) {
          buf |= (c.encode(poly[i]) & mask) << bufLen;
          bufLen += d;
          for (; bufLen >= 8; bufLen -= 8, buf >>= 8)
            r[pos++] = buf & getMask(bufLen);
        }
        return r;
      },
      decode: (bytes) => {
        const r = newPoly2(N2);
        for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < bytes.length; i++) {
          buf |= bytes[i] << bufLen;
          bufLen += 8;
          for (; bufLen >= d; bufLen -= d, buf >>= d)
            r[pos++] = c.decode(buf & mask);
        }
        return r;
      }
    };
  };
  return { mod: mod2, smod: smod2, nttZetas, NTT: NTT2, bitsCoder: bitsCoder2 };
};
var createXofShake = (shake) => (seed, blockLen) => {
  if (!blockLen)
    blockLen = shake.blockLen;
  const _seed = new Uint8Array(seed.length + 2);
  _seed.set(seed);
  const seedLen = seed.length;
  const buf = new Uint8Array(blockLen);
  let h = shake.create({});
  let calls = 0;
  let xofs = 0;
  return {
    stats: () => ({ calls, xofs }),
    get: (x, y) => {
      _seed[seedLen + 0] = x;
      _seed[seedLen + 1] = y;
      h.destroy();
      h = shake.create({}).update(_seed);
      calls++;
      return () => {
        xofs++;
        return h.xofInto(buf);
      };
    },
    clean: () => {
      h.destroy();
      buf.fill(0);
      _seed.fill(0);
    }
  };
};
var XOF128 = /* @__PURE__ */ createXofShake(shake128);
var XOF256 = /* @__PURE__ */ createXofShake(shake256);

// node_modules/@noble/post-quantum/esm/ml-dsa.js
var N = 256;
var Q = 8380417;
var ROOT_OF_UNITY = 1753;
var F = 8347681;
var D = 13;
var GAMMA2_1 = Math.floor((Q - 1) / 88) | 0;
var GAMMA2_2 = Math.floor((Q - 1) / 32) | 0;
var PARAMS = {
  2: { K: 4, L: 4, D, GAMMA1: 2 ** 17, GAMMA2: GAMMA2_1, TAU: 39, ETA: 2, OMEGA: 80 },
  3: { K: 6, L: 5, D, GAMMA1: 2 ** 19, GAMMA2: GAMMA2_2, TAU: 49, ETA: 4, OMEGA: 55 },
  5: { K: 8, L: 7, D, GAMMA1: 2 ** 19, GAMMA2: GAMMA2_2, TAU: 60, ETA: 2, OMEGA: 75 }
};
var newPoly = (n) => new Int32Array(n);
var { mod, smod, NTT, bitsCoder } = genCrystals({
  N,
  Q,
  F,
  ROOT_OF_UNITY,
  newPoly,
  isKyber: false,
  brvBits: 8
});
var id = (n) => n;
var polyCoder = (d, compress = id, verify = id) => bitsCoder(d, {
  encode: (i) => compress(verify(i)),
  decode: (i) => verify(compress(i))
});
var polyAdd = (a, b) => {
  for (let i = 0; i < a.length; i++)
    a[i] = mod(a[i] + b[i]);
  return a;
};
var polySub = (a, b) => {
  for (let i = 0; i < a.length; i++)
    a[i] = mod(a[i] - b[i]);
  return a;
};
var polyShiftl = (p) => {
  for (let i = 0; i < N; i++)
    p[i] <<= D;
  return p;
};
var polyChknorm = (p, B) => {
  for (let i = 0; i < N; i++)
    if (Math.abs(smod(p[i])) >= B)
      return true;
  return false;
};
var MultiplyNTTs = (a, b) => {
  const c = newPoly(N);
  for (let i = 0; i < a.length; i++)
    c[i] = mod(a[i] * b[i]);
  return c;
};
function RejNTTPoly(xof) {
  const r = newPoly(N);
  for (let j = 0; j < N; ) {
    const b = xof();
    if (b.length % 3)
      throw new Error("RejNTTPoly: unaligned block");
    for (let i = 0; j < N && i <= b.length - 3; i += 3) {
      const t = (b[i + 0] | b[i + 1] << 8 | b[i + 2] << 16) & 8388607;
      if (t < Q)
        r[j++] = t;
    }
  }
  return r;
}
var EMPTY = new Uint8Array(0);
function getDilithium(opts) {
  const { K, L, GAMMA1, GAMMA2, TAU, ETA, OMEGA } = opts;
  const { CRH_BYTES, TR_BYTES, C_TILDE_BYTES, XOF128: XOF1282, XOF256: XOF2562 } = opts;
  if (![2, 4].includes(ETA))
    throw new Error("Wrong ETA");
  if (![1 << 17, 1 << 19].includes(GAMMA1))
    throw new Error("Wrong GAMMA1");
  if (![GAMMA2_1, GAMMA2_2].includes(GAMMA2))
    throw new Error("Wrong GAMMA2");
  const BETA = TAU * ETA;
  const decompose = (r) => {
    const rPlus = mod(r);
    const r0 = smod(rPlus, 2 * GAMMA2) | 0;
    if (rPlus - r0 === Q - 1)
      return { r1: 0 | 0, r0: r0 - 1 | 0 };
    const r1 = Math.floor((rPlus - r0) / (2 * GAMMA2)) | 0;
    return { r1, r0 };
  };
  const HighBits = (r) => decompose(r).r1;
  const LowBits = (r) => decompose(r).r0;
  const MakeHint = (z, r) => {
    const res0 = z <= GAMMA2 || z > Q - GAMMA2 || z === Q - GAMMA2 && r === 0 ? 0 : 1;
    return res0;
  };
  const UseHint = (h, r) => {
    const m = Math.floor((Q - 1) / (2 * GAMMA2));
    const { r1, r0 } = decompose(r);
    if (h === 1)
      return r0 > 0 ? mod(r1 + 1, m) | 0 : mod(r1 - 1, m) | 0;
    return r1 | 0;
  };
  const Power2Round = (r) => {
    const rPlus = mod(r);
    const r0 = smod(rPlus, 2 ** D) | 0;
    return { r1: Math.floor((rPlus - r0) / 2 ** D) | 0, r0 };
  };
  const hintCoder = {
    bytesLen: OMEGA + K,
    encode: (h) => {
      if (h === false)
        throw new Error("hint.encode: hint is false");
      const res = new Uint8Array(OMEGA + K);
      for (let i = 0, k = 0; i < K; i++) {
        for (let j = 0; j < N; j++)
          if (h[i][j] !== 0)
            res[k++] = j;
        res[OMEGA + i] = k;
      }
      return res;
    },
    decode: (buf) => {
      const h = [];
      let k = 0;
      for (let i = 0; i < K; i++) {
        const hi = newPoly(N);
        if (buf[OMEGA + i] < k || buf[OMEGA + i] > OMEGA)
          return false;
        for (let j = k; j < buf[OMEGA + i]; j++) {
          if (j > k && buf[j] <= buf[j - 1])
            return false;
          hi[buf[j]] = 1;
        }
        k = buf[OMEGA + i];
        h.push(hi);
      }
      for (let j = k; j < OMEGA; j++)
        if (buf[j] !== 0)
          return false;
      return h;
    }
  };
  const ETACoder = polyCoder(ETA === 2 ? 3 : 4, (i) => ETA - i, (i) => {
    if (!(-ETA <= i && i <= ETA))
      throw new Error(`malformed key s1/s3 ${i} outside of ETA range [${-ETA}, ${ETA}]`);
    return i;
  });
  const T0Coder = polyCoder(13, (i) => (1 << D - 1) - i);
  const T1Coder = polyCoder(10);
  const ZCoder = polyCoder(GAMMA1 === 1 << 17 ? 18 : 20, (i) => smod(GAMMA1 - i));
  const W1Coder = polyCoder(GAMMA2 === GAMMA2_1 ? 6 : 4);
  const W1Vec = vecCoder(W1Coder, K);
  const publicCoder = splitCoder(32, vecCoder(T1Coder, K));
  const secretCoder = splitCoder(32, 32, TR_BYTES, vecCoder(ETACoder, L), vecCoder(ETACoder, K), vecCoder(T0Coder, K));
  const sigCoder = splitCoder(C_TILDE_BYTES, vecCoder(ZCoder, L), hintCoder);
  const CoefFromHalfByte = ETA === 2 ? (n) => n < 15 ? 2 - n % 5 : false : (n) => n < 9 ? 4 - n : false;
  function RejBoundedPoly(xof) {
    const r = newPoly(N);
    for (let j = 0; j < N; ) {
      const b = xof();
      for (let i = 0; j < N && i < b.length; i += 1) {
        const d1 = CoefFromHalfByte(b[i] & 15);
        const d2 = CoefFromHalfByte(b[i] >> 4 & 15);
        if (d1 !== false)
          r[j++] = d1;
        if (j < N && d2 !== false)
          r[j++] = d2;
      }
    }
    return r;
  }
  const SampleInBall = (seed) => {
    const pre = newPoly(N);
    const s = shake256.create({}).update(seed);
    const buf = new Uint8Array(shake256.blockLen);
    s.xofInto(buf);
    const masks = buf.slice(0, 8);
    for (let i = N - TAU, pos = 8, maskPos = 0, maskBit = 0; i < N; i++) {
      let b = i + 1;
      for (; b > i; ) {
        b = buf[pos++];
        if (pos < shake256.blockLen)
          continue;
        s.xofInto(buf);
        pos = 0;
      }
      pre[i] = pre[b];
      pre[b] = 1 - ((masks[maskPos] >> maskBit++ & 1) << 1);
      if (maskBit >= 8) {
        maskPos++;
        maskBit = 0;
      }
    }
    return pre;
  };
  const polyPowerRound = (p) => {
    const res0 = newPoly(N);
    const res1 = newPoly(N);
    for (let i = 0; i < p.length; i++) {
      const { r0, r1 } = Power2Round(p[i]);
      res0[i] = r0;
      res1[i] = r1;
    }
    return { r0: res0, r1: res1 };
  };
  const polyUseHint = (u, h) => {
    for (let i = 0; i < N; i++)
      u[i] = UseHint(h[i], u[i]);
    return u;
  };
  const polyMakeHint = (a, b) => {
    const v = newPoly(N);
    let cnt = 0;
    for (let i = 0; i < N; i++) {
      const h = MakeHint(a[i], b[i]);
      v[i] = h;
      cnt += h;
    }
    return { v, cnt };
  };
  const signRandBytes = 32;
  const seedCoder = splitCoder(32, 64, 32);
  const internal = {
    signRandBytes,
    keygen: (seed = randomBytes2(32)) => {
      const seedDst = new Uint8Array(32 + 2);
      seedDst.set(seed);
      seedDst[32] = K;
      seedDst[33] = L;
      const [rho, rhoPrime, K_] = seedCoder.decode(shake256(seedDst, { dkLen: seedCoder.bytesLen }));
      const xofPrime = XOF2562(rhoPrime);
      const s1 = [];
      for (let i = 0; i < L; i++)
        s1.push(RejBoundedPoly(xofPrime.get(i & 255, i >> 8 & 255)));
      const s2 = [];
      for (let i = L; i < L + K; i++)
        s2.push(RejBoundedPoly(xofPrime.get(i & 255, i >> 8 & 255)));
      const s1Hat = s1.map((i) => NTT.encode(i.slice()));
      const t0 = [];
      const t1 = [];
      const xof = XOF1282(rho);
      const t = newPoly(N);
      for (let i = 0; i < K; i++) {
        t.fill(0);
        for (let j = 0; j < L; j++) {
          const aij = RejNTTPoly(xof.get(j, i));
          polyAdd(t, MultiplyNTTs(aij, s1Hat[j]));
        }
        NTT.decode(t);
        const { r0, r1 } = polyPowerRound(polyAdd(t, s2[i]));
        t0.push(r0);
        t1.push(r1);
      }
      const publicKey = publicCoder.encode([rho, t1]);
      const tr = shake256(publicKey, { dkLen: TR_BYTES });
      const secretKey = secretCoder.encode([rho, K_, tr, s1, s2, t0]);
      xof.clean();
      xofPrime.clean();
      cleanBytes(rho, rhoPrime, K_, s1, s2, s1Hat, t, t0, t1, tr, seedDst);
      return { publicKey, secretKey };
    },
    // NOTE: random is optional.
    sign: (secretKey, msg, random) => {
      const [rho, _K, tr, s1, s2, t0] = secretCoder.decode(secretKey);
      const A = [];
      const xof = XOF1282(rho);
      for (let i = 0; i < K; i++) {
        const pv = [];
        for (let j = 0; j < L; j++)
          pv.push(RejNTTPoly(xof.get(j, i)));
        A.push(pv);
      }
      xof.clean();
      for (let i = 0; i < L; i++)
        NTT.encode(s1[i]);
      for (let i = 0; i < K; i++) {
        NTT.encode(s2[i]);
        NTT.encode(t0[i]);
      }
      const mu = shake256.create({ dkLen: CRH_BYTES }).update(tr).update(msg).digest();
      const rnd = random ? random : new Uint8Array(32);
      ensureBytes(rnd);
      const rhoprime = shake256.create({ dkLen: CRH_BYTES }).update(_K).update(rnd).update(mu).digest();
      ensureBytes(rhoprime, CRH_BYTES);
      const x256 = XOF2562(rhoprime, ZCoder.bytesLen);
      main_loop: for (let kappa = 0; ; ) {
        const y = [];
        for (let i = 0; i < L; i++, kappa++)
          y.push(ZCoder.decode(x256.get(kappa & 255, kappa >> 8)()));
        const z = y.map((i) => NTT.encode(i.slice()));
        const w = [];
        for (let i = 0; i < K; i++) {
          const wi = newPoly(N);
          for (let j = 0; j < L; j++)
            polyAdd(wi, MultiplyNTTs(A[i][j], z[j]));
          NTT.decode(wi);
          w.push(wi);
        }
        const w1 = w.map((j) => j.map(HighBits));
        const cTilde = shake256.create({ dkLen: C_TILDE_BYTES }).update(mu).update(W1Vec.encode(w1)).digest();
        const cHat = NTT.encode(SampleInBall(cTilde));
        const cs1 = s1.map((i) => MultiplyNTTs(i, cHat));
        for (let i = 0; i < L; i++) {
          polyAdd(NTT.decode(cs1[i]), y[i]);
          if (polyChknorm(cs1[i], GAMMA1 - BETA))
            continue main_loop;
        }
        let cnt = 0;
        const h = [];
        for (let i = 0; i < K; i++) {
          const cs2 = NTT.decode(MultiplyNTTs(s2[i], cHat));
          const r0 = polySub(w[i], cs2).map(LowBits);
          if (polyChknorm(r0, GAMMA2 - BETA))
            continue main_loop;
          const ct0 = NTT.decode(MultiplyNTTs(t0[i], cHat));
          if (polyChknorm(ct0, GAMMA2))
            continue main_loop;
          polyAdd(r0, ct0);
          const hint = polyMakeHint(r0, w1[i]);
          h.push(hint.v);
          cnt += hint.cnt;
        }
        if (cnt > OMEGA)
          continue;
        x256.clean();
        const res = sigCoder.encode([cTilde, cs1, h]);
        cleanBytes(cTilde, cs1, h, cHat, w1, w, z, y, rhoprime, mu, s1, s2, t0, ...A);
        return res;
      }
      throw new Error("Unreachable code path reached, report this error");
    },
    verify: (publicKey, msg, sig) => {
      const [rho, t1] = publicCoder.decode(publicKey);
      const tr = shake256(publicKey, { dkLen: TR_BYTES });
      if (sig.length !== sigCoder.bytesLen)
        return false;
      const [cTilde, z, h] = sigCoder.decode(sig);
      if (h === false)
        return false;
      for (let i = 0; i < L; i++)
        if (polyChknorm(z[i], GAMMA1 - BETA))
          return false;
      const mu = shake256.create({ dkLen: CRH_BYTES }).update(tr).update(msg).digest();
      const c = NTT.encode(SampleInBall(cTilde));
      const zNtt = z.map((i) => i.slice());
      for (let i = 0; i < L; i++)
        NTT.encode(zNtt[i]);
      const wTick1 = [];
      const xof = XOF1282(rho);
      for (let i = 0; i < K; i++) {
        const ct12d = MultiplyNTTs(NTT.encode(polyShiftl(t1[i])), c);
        const Az = newPoly(N);
        for (let j = 0; j < L; j++) {
          const aij = RejNTTPoly(xof.get(j, i));
          polyAdd(Az, MultiplyNTTs(aij, zNtt[j]));
        }
        const wApprox = NTT.decode(polySub(Az, ct12d));
        wTick1.push(polyUseHint(wApprox, h[i]));
      }
      xof.clean();
      const c2 = shake256.create({ dkLen: C_TILDE_BYTES }).update(mu).update(W1Vec.encode(wTick1)).digest();
      for (const t of h) {
        const sum = t.reduce((acc, i) => acc + i, 0);
        if (!(sum <= OMEGA))
          return false;
      }
      for (const t of z)
        if (polyChknorm(t, GAMMA1 - BETA))
          return false;
      return equalBytes(cTilde, c2);
    }
  };
  const getMessage = (msg, ctx = EMPTY) => {
    ensureBytes(msg);
    ensureBytes(ctx);
    if (ctx.length > 255)
      throw new Error("context should be less than 255 bytes");
    return concatBytes(new Uint8Array([0, ctx.length]), ctx, msg);
  };
  return {
    internal,
    keygen: internal.keygen,
    signRandBytes: internal.signRandBytes,
    sign: (secretKey, msg, ctx = EMPTY, random) => {
      const M = getMessage(msg, ctx);
      const res = internal.sign(secretKey, M, random);
      M.fill(0);
      return res;
    },
    verify: (publicKey, msg, sig, ctx = EMPTY) => {
      return internal.verify(publicKey, getMessage(msg, ctx), sig);
    }
  };
}
var ml_dsa44 = /* @__PURE__ */ getDilithium({
  ...PARAMS[2],
  CRH_BYTES: 64,
  TR_BYTES: 64,
  C_TILDE_BYTES: 32,
  XOF128,
  XOF256
});
var ml_dsa65 = /* @__PURE__ */ getDilithium({
  ...PARAMS[3],
  CRH_BYTES: 64,
  TR_BYTES: 64,
  C_TILDE_BYTES: 48,
  XOF128,
  XOF256
});
var ml_dsa87 = /* @__PURE__ */ getDilithium({
  ...PARAMS[5],
  CRH_BYTES: 64,
  TR_BYTES: 64,
  C_TILDE_BYTES: 64,
  XOF128,
  XOF256
});

// node_modules/@noble/hashes/esm/hkdf.js
init_hmac();
init_utils();
function extract(hash, ikm, salt) {
  ahash(hash);
  if (salt === void 0)
    salt = new Uint8Array(hash.outputLen);
  return hmac(hash, toBytes2(salt), toBytes2(ikm));
}
var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.from([0]);
var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
function expand(hash, prk, info, length = 32) {
  ahash(hash);
  anumber2(length);
  const olen = hash.outputLen;
  if (length > 255 * olen)
    throw new Error("Length should be <= 255*HashLen");
  const blocks = Math.ceil(length / olen);
  if (info === void 0)
    info = EMPTY_BUFFER;
  const okm = new Uint8Array(blocks * olen);
  const HMAC2 = hmac.create(hash, prk);
  const HMACTmp = HMAC2._cloneInto();
  const T = new Uint8Array(HMAC2.outputLen);
  for (let counter = 0; counter < blocks; counter++) {
    HKDF_COUNTER[0] = counter + 1;
    HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
    okm.set(T, olen * counter);
    HMAC2._cloneInto(HMACTmp);
  }
  HMAC2.destroy();
  HMACTmp.destroy();
  clean(T, HKDF_COUNTER);
  return okm.slice(0, length);
}
var hkdf = (hash, ikm, salt, info, length) => expand(hash, extract(hash, ikm, salt), info, length);

// node_modules/@noble/hashes/esm/sha3.js
init_u64();
init_utils();
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n2 = BigInt(2);
var _7n2 = BigInt(7);
var _256n2 = BigInt(256);
var _0x71n2 = BigInt(113);
var SHA3_PI2 = [];
var SHA3_ROTL2 = [];
var _SHA3_IOTA2 = [];
for (let round = 0, R = _1n2, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI2.push(2 * (5 * y + x));
  SHA3_ROTL2.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n2;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n2 ^ (R >> _7n2) * _0x71n2) % _256n2;
    if (R & _2n2)
      t ^= _1n2 << (_1n2 << /* @__PURE__ */ BigInt(j)) - _1n2;
  }
  _SHA3_IOTA2.push(t);
}
var IOTAS = split2(_SHA3_IOTA2, true);
var SHA3_IOTA_H2 = IOTAS[0];
var SHA3_IOTA_L2 = IOTAS[1];
var rotlH2 = (h, l, s) => s > 32 ? rotlBH2(h, l, s) : rotlSH2(h, l, s);
var rotlL2 = (h, l, s) => s > 32 ? rotlBL2(h, l, s) : rotlSL2(h, l, s);
function keccakP2(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH2(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL2(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL2[t];
      const Th = rotlH2(curH, curL, shift);
      const Tl = rotlL2(curH, curL, shift);
      const PI = SHA3_PI2[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H2[round];
    s[1] ^= SHA3_IOTA_L2[round];
  }
  clean(B);
}
var Keccak2 = class _Keccak extends Hash2 {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    this.enableXOF = false;
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    anumber2(outputLen);
    if (!(0 < blockLen && blockLen < 200))
      throw new Error("only keccak-f1600 function is supported");
    this.state = new Uint8Array(200);
    this.state32 = u322(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE(this.state32);
    keccakP2(this.state32, this.rounds);
    swap32IfBE(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists2(this);
    data = toBytes2(data);
    abytes2(data);
    const { blockLen, state } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists2(this, false);
    abytes2(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber2(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput2(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    clean(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen2 = (suffix, blockLen, outputLen) => createHasher(() => new Keccak2(blockLen, suffix, outputLen));
var sha3_2562 = /* @__PURE__ */ (() => gen2(6, 136, 256 / 8))();

// src/shared/crypto.ts
init_pbkdf2();
init_sha2();
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
function indexBytes(n) {
  const b = new Uint8Array(4);
  b[0] = n >> 24 & 255;
  b[1] = n >> 16 & 255;
  b[2] = n >> 8 & 255;
  b[3] = n & 255;
  return b;
}
function bytesToHex(u8) {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function mnemonicToMasterSeed(mnemonic) {
  const normalised = mnemonic.trim().toLowerCase();
  const mnemonicBytes = new TextEncoder().encode(normalised);
  const saltBytes = new TextEncoder().encode("mnemonic");
  const full64 = pbkdf2(sha512, mnemonicBytes, saltBytes, { c: 2048, dkLen: 64 });
  return full64.slice(0, 32);
}
var HIVE_DSA_DOMAIN = new TextEncoder().encode("HIVE_WALLET_DSA_v1");
function deriveHiveKeypair(masterSeed, index) {
  const info = concat(HIVE_DSA_DOMAIN, indexBytes(index));
  const seed32 = hkdf(sha3_2562, masterSeed, void 0, info, 32);
  const { publicKey, secretKey } = ml_dsa65.keygen(seed32);
  const hash = sha3_2562(publicKey);
  const address = `HNY_${bytesToHex(hash).slice(0, 40)}`;
  return { publicKey, secretKey, address };
}
function signMessage(secretKey, message) {
  const msgBytes = new TextEncoder().encode(message);
  const sig = ml_dsa65.sign(secretKey, msgBytes);
  return bytesToHex(sig);
}
async function deriveEncryptionKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptSeed(password, seed) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, seed);
  const blob = new Uint8Array(28 + ct.byteLength);
  blob.set(salt, 0);
  blob.set(iv, 16);
  blob.set(new Uint8Array(ct), 28);
  return btoa(String.fromCharCode(...blob));
}
async function decryptSeed(password, blobB64) {
  const blob = Uint8Array.from(atob(blobB64), (c) => c.charCodeAt(0));
  const salt = blob.slice(0, 16);
  const iv = blob.slice(16, 28);
  const ct = blob.slice(28);
  const key = await deriveEncryptionKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

// src/shared/storage.ts
var KEY_STATE = "hive_ext_state";
var KEY_SEED = "hive_encrypted_seed";
var KEY_SESSION = "hive_session_seed";
var KEY_SESSION_PASS = "hive_session_pass";
var KEY_PROFILES = "hive_profiles";
var KEY_ACTIVE_PROFILE = "hive_active_profile";
var KEY_CUSTOM_NETS = "hive_custom_networks";
var KEY_ACTIVE_NETWORK = "hive_active_network";
function chromeGet(area, key) {
  return new Promise((resolve) => area.get(key, (r) => resolve(r[key])));
}
function chromeSet(area, key, value) {
  return new Promise((resolve) => area.set({ [key]: value }, resolve));
}
function chromeRemove(area, key) {
  return new Promise((resolve) => area.remove(key, resolve));
}
async function getExtState() {
  return chromeGet(chrome.storage.local, KEY_STATE);
}
async function setExtState(state) {
  return chromeSet(chrome.storage.local, KEY_STATE, state);
}
async function getEncryptedSeed() {
  return chromeGet(chrome.storage.local, KEY_SEED);
}
async function setEncryptedSeed(blob) {
  return chromeSet(chrome.storage.local, KEY_SEED, blob);
}
async function getSessionSeed() {
  if (!chrome.storage.session) return void 0;
  return chromeGet(chrome.storage.session, KEY_SESSION);
}
async function setSessionSeed(seedB64) {
  if (!chrome.storage.session) return;
  return chromeSet(chrome.storage.session, KEY_SESSION, seedB64);
}
async function clearSessionSeed() {
  if (!chrome.storage.session) return;
  return chromeRemove(chrome.storage.session, KEY_SESSION);
}
async function getSessionPassword() {
  if (!chrome.storage.session) return void 0;
  return chromeGet(chrome.storage.session, KEY_SESSION_PASS);
}
async function setSessionPassword(password) {
  if (!chrome.storage.session) return;
  return chromeSet(chrome.storage.session, KEY_SESSION_PASS, password);
}
async function clearSessionPassword() {
  if (!chrome.storage.session) return;
  return chromeRemove(chrome.storage.session, KEY_SESSION_PASS);
}
async function getProfiles() {
  return await chromeGet(chrome.storage.local, KEY_PROFILES) ?? [];
}
async function setProfiles(profiles) {
  return chromeSet(chrome.storage.local, KEY_PROFILES, profiles);
}
async function getActiveProfileId() {
  return chromeGet(chrome.storage.local, KEY_ACTIVE_PROFILE);
}
async function setActiveProfileId(id2) {
  return chromeSet(chrome.storage.local, KEY_ACTIVE_PROFILE, id2);
}
async function getCustomNetworks() {
  return await chromeGet(chrome.storage.local, KEY_CUSTOM_NETS) ?? [];
}
async function setCustomNetworks(nets) {
  return chromeSet(chrome.storage.local, KEY_CUSTOM_NETS, nets);
}
async function getActiveNetworkId() {
  return chromeGet(chrome.storage.local, KEY_ACTIVE_NETWORK);
}
async function setActiveNetworkId(id2) {
  return chromeSet(chrome.storage.local, KEY_ACTIVE_NETWORK, id2);
}
async function clearAll() {
  const keys = [KEY_STATE, KEY_SEED, KEY_PROFILES, KEY_ACTIVE_PROFILE, KEY_CUSTOM_NETS, KEY_ACTIVE_NETWORK];
  await Promise.all(keys.map((k) => chromeRemove(chrome.storage.local, k)));
  await clearSessionSeed();
  await clearSessionPassword();
}
function seedToB64(seed) {
  return btoa(String.fromCharCode(...seed));
}
function b64ToSeed(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// src/background.ts
var PRESET_NETWORKS = [
  {
    id: "hny-devnet",
    name: "Honey Network Testnet",
    shortName: "HNY-DEV",
    rpcUrl: "http://localhost:3000",
    currencySymbol: "HNY",
    isTestnet: true,
    type: "hive",
    isPreset: true
  },
  {
    id: "base-mainnet",
    name: "Base Mainnet",
    shortName: "BASE",
    rpcUrl: "https://mainnet.base.org",
    chainId: "8453",
    currencySymbol: "ETH",
    blockExplorer: "https://basescan.org",
    isTestnet: false,
    type: "evm",
    isPreset: true
  },
  {
    id: "base-sepolia",
    name: "Base Sepolia",
    shortName: "BASE-SEP",
    rpcUrl: "https://sepolia.base.org",
    chainId: "84532",
    currencySymbol: "ETH",
    blockExplorer: "https://sepolia.basescan.org",
    isTestnet: true,
    type: "evm",
    isPreset: true
  }
];
var pendingRequests = [];
var nextReqId = 1;
function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
  });
}
async function getUnlockedSeed() {
  const b64 = await getSessionSeed();
  return b64 ? b64ToSeed(b64) : null;
}
async function getHiveApi() {
  const netId = await getActiveNetworkId();
  const customs = await getCustomNetworks();
  const all = [...PRESET_NETWORKS, ...customs];
  const net = all.find((n) => n.id === netId && n.type === "hive");
  return net?.rpcUrl ?? "http://localhost:3000";
}
async function callServer(path, method = "GET", body) {
  const base = await getHiveApi();
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}
async function signTx(seed, index, message) {
  const kp = deriveHiveKeypair(seed, index);
  const mldsaPubKeyHex = bytesToHex(kp.publicKey);
  const signatureHex = signMessage(kp.secretKey, message);
  const attestMessage = `chrysalis_attest:${message}`;
  const chrysalisAttestation = {
    message: attestMessage,
    signatureHex: signMessage(kp.secretKey, attestMessage),
    mldsaPubKeyHex
  };
  return { signatureHex, mldsaPubKeyHex, address: kp.address, chrysalisAttestation };
}
async function registerChrysalis(seed, address, index) {
  try {
    const kp = deriveHiveKeypair(seed, index);
    const mldsaPubKeyHex = bytesToHex(kp.publicKey);
    const message = `chrysalis_register:${address}`;
    await callServer("/chrysalis/register", "POST", {
      wallet: address,
      mldsaPubKeyHex,
      kemPubKeyHex: mldsaPubKeyHex,
      signatureHex: signMessage(kp.secretKey, message)
    });
    const state = await getExtState();
    if (state) {
      state.chrysalisRegistered = true;
      await setExtState(state);
    }
    const profiles = await getProfiles();
    const activeId = await getActiveProfileId();
    const profile = profiles.find((p) => p.id === activeId);
    if (profile) {
      profile.chrysalisRegistered = true;
      await setProfiles(profiles);
    }
    return true;
  } catch {
    return false;
  }
}
async function buildProfile(name, mnemonic, password, existingCount) {
  const masterSeed = mnemonicToMasterSeed(mnemonic);
  const { address } = deriveHiveKeypair(masterSeed, 0);
  const encryptedSeed = await encryptSeed(password, masterSeed);
  const encryptedMnemonic = await encryptSeed(password, new TextEncoder().encode(mnemonic));
  return {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `Wallet ${existingCount + 1}`,
    address,
    walletIndex: 0,
    hdAddresses: [address],
    encryptedSeed,
    encryptedMnemonic,
    chrysalisRegistered: false
  };
}
async function activateProfile(profile, password) {
  const seed = await decryptSeed(password, profile.encryptedSeed);
  await setSessionSeed(seedToB64(seed));
  await setEncryptedSeed(profile.encryptedSeed);
  await setActiveProfileId(profile.id);
  const existing = await getExtState();
  const state = {
    status: "unlocked",
    address: profile.hdAddresses[profile.walletIndex] || profile.address,
    walletIndex: profile.walletIndex,
    connectedOrigins: existing?.connectedOrigins ?? [],
    chrysalisRegistered: profile.chrysalisRegistered,
    profileId: profile.id,
    networkId: existing?.networkId ?? "hny-devnet"
  };
  await setExtState(state);
  return state;
}
chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
  handleMessage(rawMsg, sendResponse, sender);
  return true;
});
async function handleMessage(msg, respond, sender) {
  const m = msg;
  switch (m["type"]) {
    // ── Setup new wallet ────────────────────────────────────
    case "setup": {
      const { mnemonic, password } = m;
      const profiles = await getProfiles();
      const profile = await buildProfile("Main Wallet", mnemonic.trim(), password, profiles.length);
      profiles.push(profile);
      await setProfiles(profiles);
      const state = await activateProfile(profile, password);
      await setSessionPassword(password);
      const seed = await getUnlockedSeed();
      if (seed) registerChrysalis(seed, profile.address, 0).then((ok) => {
        if (ok) broadcastToPopup({ type: "state_update", state: { ...state, chrysalisRegistered: true } });
      });
      respond({ ok: true, address: profile.address });
      broadcastToPopup({ type: "state_update", state });
      break;
    }
    // ── Unlock ──────────────────────────────────────────────
    case "unlock": {
      const { password } = m;
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile = profiles.find((p) => p.id === activeId) ?? profiles[0];
      const blob = profile?.encryptedSeed ?? await getEncryptedSeed();
      if (!blob) {
        respond({ ok: false, error: "No wallet found" });
        break;
      }
      try {
        const seed = await decryptSeed(password, blob);
        await setSessionSeed(seedToB64(seed));
        await setSessionPassword(password);
        const state = await getExtState();
        if (state) {
          state.status = "unlocked";
          await setExtState(state);
        }
        if (state && !state.chrysalisRegistered) {
          registerChrysalis(seed, state.address, state.walletIndex).then((ok) => {
            if (ok) broadcastToPopup({ type: "state_update", state: { ...state, chrysalisRegistered: true, status: "unlocked" } });
          });
        }
        respond({ ok: true });
        broadcastToPopup({ type: "state_update", state });
      } catch {
        respond({ ok: false, error: "Wrong password" });
      }
      break;
    }
    // ── Lock ─────────────────────────────────────────────────
    case "lock": {
      await clearSessionSeed();
      await clearSessionPassword();
      const state = await getExtState();
      if (state) {
        state.status = "locked";
        await setExtState(state);
      }
      respond({ ok: true });
      broadcastToPopup({ type: "state_update", state });
      break;
    }
    // ── Get pending requests (race-condition fix) ─────────────
    case "get_pending_requests": {
      respond({ requests: pendingRequests });
      break;
    }
    // ── Get state ────────────────────────────────────────────
    case "get_state": {
      const state = await getExtState();
      const hasWallet = !!await getEncryptedSeed() || (await getProfiles()).length > 0;
      if (!state) {
        respond({ status: hasWallet ? "locked" : "setup_required" });
        break;
      }
      const sessionOk = !!await getSessionSeed();
      if (!sessionOk && state.status === "unlocked") {
        state.status = "locked";
        await setExtState(state);
      }
      respond(state);
      break;
    }
    // ── Fetch wallet data ─────────────────────────────────────
    case "fetch_wallet_data": {
      const state = await getExtState();
      if (!state?.address) {
        respond({ error: "No wallet" });
        break;
      }
      const addr = state.address;
      const [balsRes, nftsRes, txsRes, chrysRes] = await Promise.allSettled([
        callServer(`/tokens/balances/${addr}`),
        callServer(`/nft/wallet/${addr}`),
        callServer(`/transactions/${addr}`),
        callServer(`/chrysalis/status/${addr}`)
      ]);
      const chrysalisRegistered = chrysRes.status === "fulfilled" ? chrysRes.value.registered : state.chrysalisRegistered ?? false;
      if (chrysRes.status === "fulfilled" && chrysRes.value.registered !== state.chrysalisRegistered) {
        state.chrysalisRegistered = chrysRes.value.registered;
        await setExtState(state);
      }
      const balances = {};
      if (balsRes.status === "fulfilled") {
        const rawBals = balsRes.value.balances ?? {};
        const rawToks = balsRes.value.tokens ?? {};
        for (const [sym, amt] of Object.entries(rawBals)) {
          const a = typeof amt === "number" ? amt : 0;
          const price = rawToks[sym]?.price;
          balances[sym] = { amount: a, valueUsd: price !== void 0 ? a * price : void 0 };
        }
      }
      const rawTxArr = txsRes.status === "fulfilled" && Array.isArray(txsRes.value) ? txsRes.value : [];
      const recentTxs = rawTxArr.slice(0, 20).map((tx) => ({
        id: tx.id,
        type: tx.type,
        from_wallet: tx.from,
        to_wallet: tx.to,
        amount: tx.amount,
        token: tx.token ?? "HNY",
        timestamp: tx.timestamp
      }));
      respond({ ok: true, balances, nfts: nftsRes.status === "fulfilled" ? nftsRes.value.nfts ?? [] : [], recentTxs, chrysalisRegistered });
      break;
    }
    // ── Swap quote ───────────────────────────────────────────
    case "get_swap_quote": {
      const { fromToken, toToken, amountIn } = m;
      try {
        const { pools } = await callServer("/liquidity/pools");
        const pool = pools.find(
          (p) => p.tokenA === fromToken && p.tokenB === toToken || p.tokenA === toToken && p.tokenB === fromToken
        );
        if (!pool) {
          respond({ error: "No pool found" });
          break;
        }
        const [rIn, rOut] = pool.tokenA === fromToken ? [pool.reserveA, pool.reserveB] : [pool.reserveB, pool.reserveA];
        const fee = pool.feeRate || 3e-3;
        respond({ ok: true, amountOut: rOut * amountIn * (1 - fee) / (rIn + amountIn * (1 - fee)), priceImpact: amountIn / (rIn + amountIn) * 100, fee });
      } catch (e) {
        respond({ error: String(e) });
      }
      break;
    }
    // ── Pool ratio for LP auto-calculate ─────────────────────
    case "get_pool_ratio": {
      const { tokenA, tokenB } = m;
      try {
        const { pools } = await callServer("/liquidity/pools");
        const pool = pools.find(
          (p) => p.tokenA === tokenA && p.tokenB === tokenB || p.tokenA === tokenB && p.tokenB === tokenA
        );
        if (!pool) {
          respond({ ok: true, ratio: 1 });
          break;
        }
        const ratio = pool.tokenA === tokenA ? pool.reserveA > 0 ? pool.reserveB / pool.reserveA : 1 : pool.reserveB > 0 ? pool.reserveA / pool.reserveB : 1;
        respond({ ok: true, ratio: isFinite(ratio) ? ratio : 1 });
      } catch {
        respond({ ok: true, ratio: 1 });
      }
      break;
    }
    // ── exec_send ────────────────────────────────────────────
    case "exec_send": {
      const { toWallet, amount, token } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      try {
        const from = state.address;
        const [statusRes, acctRes] = await Promise.all([
          callServer("/status"),
          callServer(`/account/${from}`)
        ]);
        const chainId = statusRes.chainId ?? "1";
        const gasFee = Number((statusRes.minGasFee ?? 1e-8).toFixed(8));
        const nonce = Number(acctRes.nonce ?? 0);
        const ts = Date.now();
        const expiresAtMs = ts + 6e4;
        const serviceFee = Number((Number(amount) * 5e-6).toFixed(8));
        const fmt8 = (n) => Number(n).toFixed(8);
        const txMsg = [
          chainId,
          "send",
          from,
          toWallet,
          fmt8(amount),
          String(nonce),
          fmt8(gasFee),
          fmt8(serviceFee),
          String(expiresAtMs),
          String(ts),
          ""
        ].join("|");
        const sig = await signTx(seed, state.walletIndex, txMsg);
        respond({ ok: true, result: await callServer("/send", "POST", {
          from,
          to: toWallet,
          amount,
          nonce,
          timestamp: ts,
          chainId,
          gasFee,
          serviceFee,
          expiresAtMs,
          ...sig
        }) });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── exec_swap ────────────────────────────────────────────
    case "exec_swap": {
      const { fromToken, toToken, amountIn } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      try {
        const ts = Date.now();
        const txMsg = `swap:${state.address}:${fromToken}:${toToken}:${amountIn}:${ts}`;
        const sig = await signTx(seed, state.walletIndex, txMsg);
        respond({ ok: true, result: await callServer("/swap", "POST", { wallet: state.address, fromToken, toToken, amountIn, timestamp: ts, ...sig }) });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── exec_stake ───────────────────────────────────────────
    case "exec_stake": {
      const { amount } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      try {
        const ts = Date.now();
        const sig = await signTx(seed, state.walletIndex, `stake:${state.address}:${amount}:${ts}`);
        respond({ ok: true, result: await callServer("/stake", "POST", { wallet: state.address, amount, timestamp: ts, ...sig }) });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── exec_unstake ─────────────────────────────────────────
    case "exec_unstake": {
      const { amount } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      try {
        const ts = Date.now();
        const sig = await signTx(seed, state.walletIndex, `unstake:${state.address}:${amount}:${ts}`);
        respond({ ok: true, result: await callServer("/unstake", "POST", { wallet: state.address, amount, timestamp: ts, ...sig }) });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── exec_add_lp ──────────────────────────────────────────
    case "exec_add_lp": {
      const { tokenA, tokenB, amountA, amountB } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      try {
        const ts = Date.now();
        const sig = await signTx(seed, state.walletIndex, `liquidity_add:${state.address}:${tokenA}:${tokenB}:${amountA}:${amountB}:${ts}`);
        respond({ ok: true, result: await callServer("/liquidity/add", "POST", { wallet: state.address, tokenA, tokenB, amountA, amountB, timestamp: ts, ...sig }) });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── exec_send_nft ────────────────────────────────────────
    case "exec_send_nft": {
      const { toWallet, nftId } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      try {
        const ts = Date.now();
        const sig = await signTx(seed, state.walletIndex, `nft_send:${state.address}:${toWallet}:${nftId}:${ts}`);
        respond({ ok: true, result: await callServer("/nft/send", "POST", { fromWallet: state.address, toWallet, nftId, timestamp: ts, ...sig }) });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── Approve dApp request ─────────────────────────────────
    case "approve_request": {
      const { requestId } = m;
      const req = pendingRequests.find((r) => r.id === requestId);
      if (!req) {
        respond({ ok: false, error: "Request not found" });
        break;
      }
      pendingRequests = pendingRequests.filter((r) => r.id !== requestId);
      try {
        const seed = await getUnlockedSeed();
        if (!seed) {
          respond({ ok: false, error: "Wallet locked" });
          break;
        }
        const state = await getExtState();
        if (req.type === "connect") {
          const connectedAddress = state?.address ?? "";
          if (state && !state.connectedOrigins.includes(req.origin)) {
            state.connectedOrigins.push(req.origin);
            await setExtState(state);
          }
          chrome.tabs.sendMessage(req.tabId, { type: "hive_response", requestId: req.inpageRequestId, result: [connectedAddress] });
        } else if (req.type === "sign" && req.message) {
          const kp = deriveHiveKeypair(seed, state?.walletIndex ?? 0);
          chrome.tabs.sendMessage(req.tabId, {
            type: "hive_response",
            requestId: req.inpageRequestId,
            result: { signature: signMessage(kp.secretKey, req.message), address: kp.address, publicKeyHex: bytesToHex(kp.publicKey) }
          });
        } else if (req.type === "tx" && req.txData) {
          const kp = deriveHiveKeypair(seed, state?.walletIndex ?? 0);
          try {
            const txData = req.txData;
            const params = txData.params ?? {};
            let result;
            if (txData.txType === "swap") {
              const ts = Date.now();
              const txMsg = `swap:${kp.address}:${txData.fromToken}:${txData.toToken}:${txData.amountIn}:${ts}`;
              const sig = await signTx(seed, state.walletIndex, txMsg);
              result = await callServer("/swap", "POST", {
                wallet: kp.address,
                fromToken: txData.fromToken,
                toToken: txData.toToken,
                amountIn: txData.amountIn,
                timestamp: ts,
                ...sig
              });
            } else if (txData.txType === "futures_open") {
              const ts = Date.now();
              const txMsg = `futures_open:${kp.address}:${txData.marketId}:${txData.side}:${params.size}:${txData.leverage}:${ts}`;
              const sig = await signTx(seed, state.walletIndex, txMsg);
              result = await callServer("/futures/open", "POST", {
                wallet: kp.address,
                market_id: txData.marketId,
                side: txData.side,
                size_hny: params.size,
                leverage: txData.leverage,
                timestamp: ts,
                ...sig
              });
            } else if (txData.txType === "futures_close") {
              const ts = Date.now();
              const txMsg = `futures_close:${kp.address}:${params.positionId}:${ts}`;
              const sig = await signTx(seed, state.walletIndex, txMsg);
              result = await callServer("/futures/close", "POST", {
                wallet: kp.address,
                position_id: params.positionId,
                timestamp: ts,
                ...sig
              });
            } else {
              result = { success: true, message: "Transaction signed" };
            }
            chrome.tabs.sendMessage(req.tabId, {
              type: "hive_response",
              requestId: req.inpageRequestId,
              result: { txId: result?.tx_id ?? `tx_${Date.now()}`, success: true }
            });
          } catch (e) {
            chrome.tabs.sendMessage(req.tabId, {
              type: "hive_response",
              requestId: req.inpageRequestId,
              error: String(e)
            });
          }
        }
        respond({ ok: true });
        broadcastToPopup({ type: "pending_requests", requests: pendingRequests });
      } catch (e) {
        respond({ ok: false, error: String(e) });
      }
      break;
    }
    // ── Reject dApp request ──────────────────────────────────
    case "reject_request": {
      const { requestId } = m;
      const req = pendingRequests.find((r) => r.id === requestId);
      if (req) chrome.tabs.sendMessage(req.tabId, { type: "hive_response", requestId: req.inpageRequestId, error: "User rejected" });
      pendingRequests = pendingRequests.filter((r) => r.id !== requestId);
      respond({ ok: true });
      broadcastToPopup({ type: "pending_requests", requests: pendingRequests });
      break;
    }
    // ── Disconnect site ──────────────────────────────────────
    case "disconnect_site": {
      const { origin } = m;
      const state = await getExtState();
      if (state) {
        state.connectedOrigins = state.connectedOrigins.filter((o) => o !== origin);
        await setExtState(state);
        respond({ ok: true });
        broadcastToPopup({ type: "state_update", state });
      } else {
        respond({ ok: false });
      }
      break;
    }
    // ── inpage provider ──────────────────────────────────────
    case "inpage_request": {
      const { method, params, requestId: reqId, origin, title } = m;
      const tabId = sender?.tab?.id ?? m.tabId ?? -1;
      const state = await getExtState();
      const seed = await getUnlockedSeed();
      if (method === "hive_chainId") {
        respond({ result: "0x01" });
        break;
      }
      if (method === "hive_accounts") {
        if (!state || state.status !== "unlocked" || !state.connectedOrigins.includes(origin)) {
          respond({ result: [] });
          break;
        }
        respond({ result: [state.address] });
        break;
      }
      if (method === "hive_requestAccounts") {
        if (!seed || !state || state.status !== "unlocked") {
          queueRequest({ type: "connect", origin, title, tabId, requestId: reqId });
          respond({ pending: true });
          break;
        }
        if (state.connectedOrigins.includes(origin)) {
          respond({ result: [state.address] });
        } else {
          queueRequest({ type: "connect", origin, title, tabId, requestId: reqId });
          respond({ pending: true });
        }
        break;
      }
      if (method === "hive_sign") {
        const message = params?.[0] ?? "";
        if (!seed || !state || state.status !== "unlocked") {
          respond({ error: "Wallet locked" });
          break;
        }
        if (!state.connectedOrigins.includes(origin)) {
          respond({ error: "Not connected" });
          break;
        }
        queueRequest({ type: "sign", origin, title, tabId, requestId: reqId, message });
        respond({ pending: true });
        break;
      }
      if (method === "hive_getBalance") {
        try {
          const r = await callServer(`/tokens/balances/${state?.address ?? ""}`);
          respond({ result: String(r.balances?.["HNY"]?.amount ?? 0) });
        } catch {
          respond({ result: "0" });
        }
        break;
      }
      if (method === "hive_requestTx") {
        const txData = params?.[0];
        if (!seed || !state || state.status !== "unlocked") {
          respond({ error: "Wallet locked \u2014 please unlock HIVE Wallet extension first" });
          break;
        }
        if (!txData) {
          respond({ error: "Missing transaction data" });
          break;
        }
        queueRequest({ type: "tx", origin, title, tabId, requestId: reqId, txData });
        respond({ pending: true });
        break;
      }
      respond({ error: `Unknown method: ${method}` });
      break;
    }
    // ── Wallet manager: list profiles ────────────────────────
    case "get_profiles": {
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      respond({ ok: true, profiles, activeId });
      break;
    }
    // ── Wallet manager: create new wallet ────────────────────
    case "create_profile": {
      const { name } = m;
      const pass = await getSessionPassword();
      if (!pass) {
        respond({ ok: false, error: "Session expired \u2014 please lock and unlock first" });
        break;
      }
      const { generateMnemonic: gen3 } = await Promise.resolve().then(() => (init_esm2(), esm_exports));
      const { wordlist: wordlist2 } = await Promise.resolve().then(() => (init_english(), english_exports));
      const mnemonic = gen3(wordlist2);
      const profiles = await getProfiles();
      const profile = await buildProfile(name, mnemonic, pass, profiles.length);
      profiles.push(profile);
      await setProfiles(profiles);
      respond({ ok: true, profile, mnemonic });
      break;
    }
    // ── Wallet manager: import wallet ────────────────────────
    case "import_profile": {
      const { name, mnemonic } = m;
      const pass = await getSessionPassword();
      if (!pass) {
        respond({ ok: false, error: "Session expired \u2014 please lock and unlock first" });
        break;
      }
      const profiles = await getProfiles();
      const profile = await buildProfile(name, mnemonic.trim(), pass, profiles.length);
      profiles.push(profile);
      await setProfiles(profiles);
      respond({ ok: true, profile });
      break;
    }
    // ── Wallet manager: switch wallet ────────────────────────
    case "switch_profile": {
      const { profileId } = m;
      const pass = await getSessionPassword();
      if (!pass) {
        respond({ ok: false, error: "Session expired \u2014 please lock and unlock" });
        break;
      }
      const profiles = await getProfiles();
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) {
        respond({ ok: false, error: "Profile not found" });
        break;
      }
      try {
        const state = await activateProfile(profile, pass);
        respond({ ok: true });
        broadcastToPopup({ type: "state_update", state });
      } catch {
        respond({ ok: false, error: "Failed to decrypt \u2014 profile may use a different password" });
      }
      break;
    }
    // ── Wallet manager: delete wallet ────────────────────────
    case "delete_profile": {
      const { profileId } = m;
      const activeId = await getActiveProfileId();
      if (profileId === activeId) {
        respond({ ok: false, error: "Cannot delete the active wallet. Switch first." });
        break;
      }
      const profiles = await getProfiles();
      await setProfiles(profiles.filter((p) => p.id !== profileId));
      respond({ ok: true });
      break;
    }
    // ── Wallet manager: add HD address ───────────────────────
    case "add_address": {
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile = profiles.find((p) => p.id === activeId);
      if (!profile) {
        respond({ ok: false, error: "Profile not found" });
        break;
      }
      const newIndex = profile.hdAddresses.length;
      const { address } = deriveHiveKeypair(seed, newIndex);
      profile.hdAddresses.push(address);
      await setProfiles(profiles);
      respond({ ok: true, address, index: newIndex, hdAddresses: profile.hdAddresses });
      break;
    }
    // ── Wallet manager: switch HD address ────────────────────
    case "switch_address": {
      const { index } = m;
      const seed = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) {
        respond({ ok: false, error: "Wallet locked" });
        break;
      }
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile = profiles.find((p) => p.id === activeId);
      if (!profile || !profile.hdAddresses[index]) {
        respond({ ok: false, error: "Address not found" });
        break;
      }
      profile.walletIndex = index;
      await setProfiles(profiles);
      state.address = profile.hdAddresses[index];
      state.walletIndex = index;
      await setExtState(state);
      respond({ ok: true });
      broadcastToPopup({ type: "state_update", state });
      break;
    }
    // ── Wallet manager: rename wallet ────────────────────────
    case "rename_profile": {
      const { profileId, name } = m;
      const profiles = await getProfiles();
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) {
        respond({ ok: false, error: "Profile not found" });
        break;
      }
      profile.name = name;
      await setProfiles(profiles);
      respond({ ok: true });
      break;
    }
    // ── View seed phrase (Chrysalis locked) ──────────────────
    case "get_seed_phrase": {
      const { password } = m;
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile = profiles.find((p) => p.id === activeId);
      if (!profile) {
        respond({ ok: false, error: "Seed phrase not available. Re-import your wallet to enable this feature." });
        break;
      }
      try {
        const bytes = await decryptSeed(password, profile.encryptedMnemonic);
        const mnemonic = new TextDecoder().decode(bytes);
        respond({ ok: true, mnemonic });
      } catch {
        respond({ ok: false, error: "Wrong password" });
      }
      break;
    }
    // ── Networks: list all ───────────────────────────────────
    case "get_networks": {
      const customs = await getCustomNetworks();
      const activeId = await getActiveNetworkId();
      respond({ ok: true, networks: [...PRESET_NETWORKS, ...customs], activeId: activeId ?? "hny-devnet" });
      break;
    }
    // ── Networks: add custom ─────────────────────────────────
    case "add_network": {
      const { network } = m;
      const customs = await getCustomNetworks();
      const exists = customs.find((n) => n.id === network.id);
      if (exists) {
        respond({ ok: false, error: "Network ID already exists" });
        break;
      }
      const newNet = { ...network, isPreset: false };
      await setCustomNetworks([...customs, newNet]);
      respond({ ok: true });
      break;
    }
    // ── Networks: remove custom ──────────────────────────────
    case "remove_network": {
      const { networkId } = m;
      const customs = await getCustomNetworks();
      await setCustomNetworks(customs.filter((n) => n.id !== networkId));
      const activeId = await getActiveNetworkId();
      if (activeId === networkId) await setActiveNetworkId("hny-devnet");
      respond({ ok: true });
      break;
    }
    // ── Networks: switch ─────────────────────────────────────
    case "switch_network": {
      const { networkId } = m;
      await setActiveNetworkId(networkId);
      const state = await getExtState();
      if (state) {
        state.networkId = networkId;
        await setExtState(state);
      }
      respond({ ok: true });
      if (state) broadcastToPopup({ type: "state_update", state });
      break;
    }
    // ── Factory reset ────────────────────────────────────────
    case "reset": {
      await clearAll();
      respond({ ok: true });
      break;
    }
    default:
      respond({ error: "Unknown message type" });
  }
}
function queueRequest(opts) {
  const req = {
    id: String(nextReqId++),
    type: opts.type,
    origin: opts.origin,
    title: opts.title,
    tabId: opts.tabId,
    inpageRequestId: opts.requestId,
    message: opts.message,
    txData: opts.txData
  };
  pendingRequests.push(req);
  broadcastToPopup({ type: "pending_requests", requests: pendingRequests });
  chrome.action.openPopup().catch(() => {
    if (opts.tabId > 0) {
      chrome.tabs.sendMessage(opts.tabId, { type: "hive_popup_required" }).catch(() => {
      });
    }
  });
  chrome.action.setBadgeText({ text: String(pendingRequests.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#f5b429" });
}
chrome.runtime.onStartup.addListener(async () => {
  const state = await getExtState();
  if (state) {
    state.status = "locked";
    await setExtState(state);
  }
  await clearSessionSeed();
  await clearSessionPassword();
});
export {
  PRESET_NETWORKS
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@scure/base/lib/esm/index.js:
  (*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@scure/bip39/esm/index.js:
  (*! scure-bip39 - MIT License (c) 2022 Patricio Palladino, Paul Miller (paulmillr.com) *)

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/post-quantum/esm/utils.js:
  (*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) *)

@noble/post-quantum/esm/_crystals.js:
  (*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) *)

@noble/post-quantum/esm/ml-dsa.js:
  (*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) *)
*/
