let wasm;

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedFloat64ArrayMemory0 = null;

function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedInt32ArrayMemory0 = null;

function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
/**
 * @param {number} seed
 * @param {number} sides
 * @param {number} count
 * @returns {string}
 */
export function initial_geometry(seed, sides, count) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.initial_geometry(seed, sides, count);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function hypot(a, b) {
    const ret = wasm.hypot(a, b);
    return ret;
}

/**
 * @param {number} state
 * @returns {number}
 */
export function random_next(state) {
    const ret = wasm.random_next(state);
    return ret >>> 0;
}

const RustMatchFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rustmatch_free(ptr >>> 0, 1));

export class RustMatch {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RustMatchFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rustmatch_free(ptr, 0);
    }
    /**
     * @param {number} tick
     */
    advance_to(tick) {
        wasm.rustmatch_advance_to(this.__wbg_ptr, tick);
    }
    /**
     * @returns {Float64Array}
     */
    populations() {
        const ret = wasm.rustmatch_populations(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} winner
     * @param {number} reason
     */
    set_outcome(winner, reason) {
        wasm.rustmatch_set_outcome(this.__wbg_ptr, winner, reason);
    }
    /**
     * @param {number} side
     * @param {number} index
     * @returns {boolean}
     */
    toggle_rule(side, index) {
        const ret = wasm.rustmatch_toggle_rule(this.__wbg_ptr, side, index);
        return ret !== 0;
    }
    /**
     * @param {number} side
     * @returns {Float64Array}
     */
    view_header(side) {
        const ret = wasm.rustmatch_view_header(this.__wbg_ptr, side);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} side
     * @param {number} kind
     * @returns {Float64Array}
     */
    view_swarms(side, kind) {
        const ret = wasm.rustmatch_view_swarms(this.__wbg_ptr, side, kind);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} side
     * @returns {Float64Array}
     */
    view_totals(side) {
        const ret = wasm.rustmatch_view_totals(this.__wbg_ptr, side);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} side
     * @returns {Float64Array}
     */
    view_planets(side) {
        const ret = wasm.rustmatch_view_planets(this.__wbg_ptr, side);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} side
     * @returns {Float64Array}
     */
    rule_snapshot(side) {
        const ret = wasm.rustmatch_rule_snapshot(this.__wbg_ptr, side);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    swarm_snapshot() {
        const ret = wasm.rustmatch_swarm_snapshot(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    planet_snapshot() {
        const ret = wasm.rustmatch_planet_snapshot(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} side
     * @returns {Uint32Array}
     */
    visible_indices(side) {
        const ret = wasm.rustmatch_visible_indices(this.__wbg_ptr, side);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {any} seed
     * @param {string} options
     * @param {Uint32Array} teams
     * @param {number} tick
     * @param {number} end_tick
     * @param {number} next_id
     * @param {Float64Array} swarms
     * @param {Float64Array} planets
     */
    constructor(seed, options, teams, tick, end_tick, next_id, swarms, planets) {
        const ptr0 = passStringToWasm0(options, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(teams, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(swarms, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(planets, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.rustmatch_new(seed, ptr0, len0, ptr1, len1, tick, end_tick, next_id, ptr2, len2, ptr3, len3);
        this.__wbg_ptr = ret >>> 0;
        RustMatchFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {any}
     */
    seed() {
        const ret = wasm.rustmatch_seed(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    tick() {
        const ret = wasm.rustmatch_tick(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint32Array}
     */
    teams() {
        const ret = wasm.rustmatch_teams(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    finish() {
        wasm.rustmatch_finish(this.__wbg_ptr);
    }
    advance() {
        wasm.rustmatch_advance(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    next_id() {
        const ret = wasm.rustmatch_next_id(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    options() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.rustmatch_options(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Int32Array}
     */
    outcome() {
        const ret = wasm.rustmatch_outcome(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} side
     * @param {number} id
     * @returns {boolean}
     */
    release(side, id) {
        const ret = wasm.rustmatch_release(this.__wbg_ptr, side, id);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    end_tick() {
        const ret = wasm.rustmatch_end_tick(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} side
     * @param {number} id
     * @returns {number}
     */
    split_id(side, id) {
        const ret = wasm.rustmatch_split_id(this.__wbg_ptr, side, id);
        return ret;
    }
    /**
     * @param {number} side
     * @param {number} x
     * @param {number} y
     * @param {number} n
     * @returns {number}
     */
    add_swarm(side, x, y, n) {
        const ret = wasm.rustmatch_add_swarm(this.__wbg_ptr, side, x, y, n);
        return ret;
    }
    /**
     * @param {number} side
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    set_order(side, id, x, y) {
        const ret = wasm.rustmatch_set_order(this.__wbg_ptr, side, id, x, y);
        return ret !== 0;
    }
    /**
     * @param {number} side
     * @param {Float64Array} rules
     */
    set_rules(side, rules) {
        const ptr0 = passArrayF64ToWasm0(rules, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.rustmatch_set_rules(this.__wbg_ptr, side, ptr0, len0);
    }
    /**
     * @param {number} side
     */
    surrender(side) {
        wasm.rustmatch_surrender(this.__wbg_ptr, side);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_0;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('botters_sim_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
