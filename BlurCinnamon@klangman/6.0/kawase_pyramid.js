// Independent backdrop renderer. The owner parents actor and puts the composed
// scene in content, in local coordinates. set_size() takes logical actor units.
const {Cinnamon, Clutter, Cogl, GLib, GObject, St} = imports.gi;
const Me = typeof global !== 'undefined' && imports.ui.extension.getCurrentExtension ?
    imports.ui.extension.getCurrentExtension() : null;
function importLocal(name) { return Me ? Me.imports[name] : require('./' + name); }
const Base = importLocal('effect_base');
const Utils = importLocal('utils');
const Stock = importLocal('dual_kawase_blur');
const direct = Base.USE_GLSL_EFFECT &&
    Cinnamon.GLSLEffect.prototype.get_pipeline !== Clutter.OffscreenEffect.prototype.get_pipeline;
const resolve = Base.USE_GLSL_EFFECT && !direct;
const manual = !Base.USE_GLSL_EFFECT && typeof Clutter.OffscreenEffect.prototype.get_pipeline !== 'function';
const tag = Math.floor(Math.random() * 1000000000);
const sourceOver = 'RGB = ADD (SRC_COLOR * (SRC_COLOR[A]), DST_COLOR * (1-SRC_COLOR[A]))\n' +
              'A = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))';

// Integrated absolute error of a blurred black/white step, in source pixels.
// Interpolate across the stock filter's abrupt depth change near radius 35.
const edgeSpread = [[0, 0], [4, 0.71], [8, 1.28], [18, 3.04], [24, 4.02],
    [33, 5.53], [38, 10.03], [42, 11.06], [64, 16.8], [100, 26.25]];
// Convert that spread to an offset in source texels for each pyramid tier.
// Keep offset below the 2D impulse-ghosting limit (~1.15 at depth 1, ~1.65 with
// the half-res mid-up pass, ~2.0 at depth 2) while matching the exact same edge
// spread at every tier boundary so the slider stays continuous.
const tiers = [
    {depth: 0, midUp: false, offsets: [[0, 0], [0.71, 1.2171]]},
    {depth: 1, midUp: false, offsets: [[0.71, 0.5371], [1.28, 1.0215], [1.46, 1.1533]]},
    {depth: 1, midUp: true,  offsets: [[1.46, 0.7508], [1.98, 1.0705], [2.51, 1.4115], [2.88, 1.6491]]},
    {depth: 2, midUp: false, offsets: [[2.88, 0.9992], [4.02, 1.4148], [5.53, 1.9562]]},
    {depth: 3, midUp: false, offsets: [[5.53, 0.9179], [8.0, 1.3595], [11.06, 1.9027], [16.8, 2.9888], [26.25, 4.7345], [52.5, 9.5326]]},
];
const MAX_DEPTH = tiers[tiers.length - 1].depth;

function interpolate(points, value) {
    let i = 1;
    while (i < points.length - 1 && value > points[i][0]) i++;
    const [a, x] = points[i - 1], [b, y] = points[i];
    return x + (y - x) * (value - a) / (b - a);
}

function plan(width, height, radius, scale, themeScale, gradePixel) {
    const sizes = [[width, height]];
    if (radius <= 0 || width <= 0 || height <= 0 || (width === 1 && height === 1 && (direct || scale === 1) && !gradePixel))
        return {sizes, steps: [], reach: 0};
    const spread = interpolate(edgeSpread, Math.min(100, radius)) * scale * themeScale;
    let tierIndex = 0;
    while (tierIndex < tiers.length - 1 && spread > tiers[tierIndex].offsets[tiers[tierIndex].offsets.length - 1][0])
        tierIndex++;
    const requested = tiers[tierIndex];
    while (sizes.length <= requested.depth && (width > 1 || height > 1)) {
        width = Math.ceil(width / 2);
        height = Math.ceil(height / 2);
        sizes.push([width, height]);
    }
    const depth = sizes.length - 1;
    const active = depth === requested.depth ? requested : tiers.find(t => t.depth === depth && !t.midUp);
    const offset = interpolate(active.offsets, spread);
    const steps = [];
    let reachX = 0, reachY = 0;
    const addStep = (down, from, to, level) => {
        const [w, h] = sizes[from], [dw, dh] = sizes[to];
        const ratio = down ? 0.5 : 2;
        const gridX = w === dw ? 1 : ratio, gridY = h === dh ? 1 : ratio;
        steps.push({down, from, to, offset, gridX, gridY});
        // Linear interpolation can touch a texel centre up to one source
        // texel beyond a tap. The inverse mappings keep a fixed 2:1 phase.
        const distance = (down ? 0.5 : 1.5) * offset + 1;
        if (w * (direct ? 1 : scale) > 1) reachX += distance * 2 ** level;
        if (h * (direct ? 1 : scale) > 1) reachY += distance * 2 ** level;
    };
    if (active.midUp) {
        // 3-pass half-resolution bridge (Down 1x->1/2, Up 1/2->1/2, Up 1/2->1x):
        // avoids both depth-1 ghosting and 1/4-res blockiness on crisp text.
        sizes.push([sizes[1][0], sizes[1][1]]);
        addStep(true, 0, 1, 0);
        addStep(false, 1, 2, 1);
        addStep(false, 2, 0, 1);
    } else if (depth === 0) {
        addStep(false, 0, 0, 0);
    } else {
        for (let i = 0; i < depth; i++)
            addStep(true, i, i + 1, i);
        for (let i = depth; i > 0; i--)
            addStep(false, i, i - 1, i);
    }
    return {sizes, steps, reach: Math.ceil(Math.max(reachX, reachY) / scale)};
}

function backingScale(actor, resource = actor?.get_resource_scale()) {
    const scale = Array.isArray(resource) ? resource[1] : resource;
    return Math.max(1, Math.ceil(scale || 1));
}

function logicalPlan(width, height, radius, scale, themeScale, gradePixel) {
    const units = direct ? scale : 1;
    return plan(Math.ceil(width * units), Math.ceil(height * units), radius, scale, themeScale, gradePixel);
}

function samplingMargin(width, height, radius, scale, themeScale, fallbackReach = 0) {
    if (!(width > 0 && height > 0)) return 0;
    // The margin can grow a tiny viewport enough to use the full pyramid.
    const minimumSize = 2 ** MAX_DEPTH + 1;
    const {reach} = logicalPlan(Math.max(width, minimumSize), Math.max(height, minimumSize),
        radius, scale, themeScale, false);
    return Math.max(reach, fallbackReach);
}

const scaleSignal = GObject.signal_lookup('resource-scale-changed', Clutter.Actor.$gtype) ?
    'resource-scale-changed' : 'notify::resource-scale';

function setFloat(effect, name, value) {
    if (Base.USE_GLSL_EFFECT) {
        effect.set_uniform_value(name, value);
    } else {
        const uniform = new GObject.Value();
        uniform.init(GObject.TYPE_FLOAT);
        uniform.set_float(value);
        effect.set_uniform_value(name, uniform);
    }
}

// Update EffectBase float uniforms from inside vfunc_paint_target without
// calling queue_repaint(), which would schedule a redundant extra frame.
function setFloatForPaint(effect, name, value) {
    if (Base.USE_GLSL_EFFECT) {
        if (!effect._effect_base_uniforms) {
            effect._effect_base_uniforms = new Map();
            effect._effect_base_changed = new Map();
        }
        value = Number(value);
        if (effect._effect_base_uniforms.get(name) === value)
            return;
        effect._effect_base_uniforms.set(name, value);
        effect._effect_base_changed.set(name, value);
    } else {
        setFloat(effect, name, value);
    }
}

const sourceCache = {};
function shader(down) {
    const kind = down ? 'down' : 'up';
    if (!sourceCache[kind]) {
        sourceCache[kind] = (manual ? '#define KAWASE_MANUAL_LINEAR\n' : '') +
            (resolve ? '#define KAWASE_STORE_ALPHA\n' : '') +
            Utils.get_shader_source('pyramid_pass.glsl') + '\n' +
            Utils.get_shader_source('dual_filtering_' + kind + '.glsl');
    }
    return sourceCache[kind];
}

function passType(down) {
    return GObject.registerClass({GTypeName: 'KawasePass' + (down ? 'Down' : 'Up') + tag},
        class extends Base.EffectBase {
            get_effect_source() { return shader(down); }

            vfunc_paint_target(context) {
                const [ok, w, h] = this.get_target_size();
                if (ok && (this.texWidth !== w || this.texHeight !== h)) {
                    this.texWidth = w;
                    this.texHeight = h;
                    // Muffin enlarges an integer actor volume by two logical
                    // pixels before its origin and one beyond its far edge.
                    const s = this.backingScale;
                    // Muffin scales the allocation, but translates the FBO viewport
                    // by the unscaled fbo_offset. The first texel stays at (2, 2).
                    setFloatForPaint(this, 'width', w);
                    setFloatForPaint(this, 'height', h);
                    setFloatForPaint(this, 'first_x', 2);
                    setFloatForPaint(this, 'first_y', 2);
                    setFloatForPaint(this, 'last_x', Math.max(2, w - 3 * s + 1));
                    setFloatForPaint(this, 'last_y', Math.max(2, h - 3 * s + 1));
                }
                if (!Base.USE_GLSL_EFFECT && !manual)
                    this.get_pipeline().set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
                super.vfunc_paint_target(context);
            }
        });
}

const Down = passType(true), Up = passType(false);
// Plain offscreen resolve used on Cinnamon 6.2-6.6 ONLY when no outer
// Clutter.OffscreenEffect (e.g. CornerEffect / RefractionEffect) wraps the
// pyramid, so premultiplied alpha stays exact over fractional stage FBOs.
const Composite = GObject.registerClass({GTypeName: 'KawaseComposite' + tag}, class extends Clutter.OffscreenEffect {});
const Level = GObject.registerClass({GTypeName: 'KawaseLevel' + tag}, class extends Clutter.Actor {
    vfunc_get_paint_volume(volume) { return volume.set_from_allocation(this); }
});

const pools = new Map([[Down, []], [Up, []], [Composite, []]]);
const templates = new Map();
const attachedEffects = new Set();
const DROPPED_VRAM_GC_BYTES = 4 * 1024 * 1024;
let pendingDroppedBytes = 0;
let urgentGcId = 0;

function noteDroppedBuffer(buffer) {
    if (!buffer) return;
    pendingDroppedBytes += (buffer.capW || buffer.w) * (buffer.capH || buffer.h) * 4;
    Utils.scheduleFramebufferGC();
    if (pendingDroppedBytes >= DROPPED_VRAM_GC_BYTES && !urgentGcId) {
        urgentGcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            urgentGcId = 0;
            pendingDroppedBytes = 0;
            imports.system.gc();
            return GLib.SOURCE_REMOVE;
        });
    }
}

function take(Type) { return pools.get(Type).pop() || new Type(); }
function release(effect) {
    const actor = effect.get_actor();
    if (actor) actor.remove_effect(effect);
    Base.releaseToPool(pools.get(effect.constructor), effect, 8);
}
function drainIdlePools() {
    for (const pool of pools.values()) Base.drainPool(pool);
}
function drainPools() {
    if (urgentGcId) {
        GLib.source_remove(urgentGcId);
        urgentGcId = 0;
    }
    pendingDroppedBytes = 0;
    // A shell-owned background can outlive extension disable (e.g. Expo).
    for (const effect of attachedEffects) effect.get_actor()?.remove_effect(effect);
    drainIdlePools();
    templates.clear();
}

function target(w, h, capW = w, capH = h) {
    const texture = Cogl.Texture.new_with_size(capW, capH, Cogl.TextureFlags.NO_SLICING, Cogl.PixelFormat.RGBA_8888_PRE);
    const fb = Cogl.Offscreen.new_with_texture(texture);
    if (!fb.allocate())
        throw new Error(`Could not allocate ${capW}×${capH} Kawase framebuffer`);
    fb.set_viewport(0, 0, w, h);
    fb.identity_matrix();
    return {texture, fb, w, h, capW, capH};
}

function resizeCapacity(size, level, prevCap = 0) {
    const step = Math.max(16, 128 >> level);
    const targetSize = prevCap > 0 ? Math.max(size, Math.ceil(prevCap * 1.25)) : size;
    return Math.ceil(targetSize / step) * step;
}

function makePipeline(down) {
    const Type = down ? Down : Up;
    if (!templates.has(Type)) templates.set(Type, new Type());
    const pipeline = templates.get(Type).get_pipeline().copy();
    pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    pipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
    return pipeline;
}

function uniforms(step, index, count, brightness, grain, glass) {
    const last = index === count - 1;
    const after = count - index - 1 + (glass ? 1 : 0);
    // Keep reduced-resolution inner dither gentle (0.5 LSB) so upsampling
    // from 1/4 or 1/8 targets does not inject low-frequency noise clouds.
    const innerDither = grain > 0 ? Math.min(0.5, grain * 0.5) : 0;
    const values = {offset: step.offset, grid_x: step.gridX, grid_y: step.gridY,
        dither_amount: after ? innerDither : grain, dither_pattern: after ? after % 2 : 2};
    if (!step.down) {
        values.brightness = brightness;
        values.is_last_pass = last ? 1 : 0;
    }
    return values;
}

function hasOuterOffscreen(actor, self) {
    if (!actor) return false;
    for (const effect of actor.get_effects()) {
        if (effect === self) break;
        if (effect.enabled && effect instanceof Clutter.OffscreenEffect)
            return true;
    }
    return false;
}

const Explicit = GObject.registerClass({GTypeName: 'KawaseExplicit' + tag}, class extends Clutter.Effect {
    _dropBuffers() {
        const oldBuffers = this.buffers;
        const oldDraws = this.draws;
        this.buffers = this.draws = null;
        this._intermediatesValid = false;
        if (oldDraws) {
            for (const draw of oldDraws) {
                try { draw.pipeline.set_layer_null_texture(0); } catch (_) {}
            }
        }
        if (oldBuffers) {
            for (const buffer of oldBuffers) noteDroppedBuffer(buffer);
            return true;
        }
        return false;
    }

    get fallbackReach() { return this._fallback?.sample_reach ?? 0; }

    _removeFallback(destroying = false) {
        const fallback = this._fallback;
        this._fallback = null;
        if (!destroying)
            fallback?.get_actor()?.remove_effect(fallback);
    }

    clear(destroying = false) {
        if (this._dropBuffers())
            Utils.scheduleFramebufferGC();
        this._removeFallback(destroying);
        this._failedSizes = null;
    }

    configure(layout, width, height, radius, brightness, grain, glass) {
        const failed = this._failedSizes;
        // Don't retry a rejected set of physical targets on each parameter
        // update. A new size, scale or depth can make allocation possible.
        const sameTargets = failed?.length === layout.sizes.length &&
            failed.every(([w, h], i) => w === layout.sizes[i][0] && h === layout.sizes[i][1]);
        if (!sameTargets) {
            try {
                this._configure(layout, width, height, brightness, grain, glass);
            } catch (error) {
                this._dropBuffers();
                this._failedSizes = layout.sizes;
                // Even the first configuration can leave partially allocated
                // targets held by JS wrappers until the scheduled collection.
                Utils.scheduleFramebufferGC();
                if (!failed)
                    global.logWarning(`BlurCinnamon: switching to the stable Dual Kawase blur: ${error.message}`);
            }
            if (this.buffers) {
                this._failedSizes = null;
                this._removeFallback();
                return;
            }
        }

        if (this._fallback && this._fallback.glass_backdrop !== glass)
            this._removeFallback();
        if (!this._fallback) {
            const fallback = new Stock.DualFilteringBlurEffect({radius, brightness, width, height, grain});
            fallback.glass_backdrop = glass;
            this.get_actor().add_effect(fallback);
            this._fallback = fallback;
        } else {
            this._fallback.radius = radius;
            this._fallback.brightness = brightness;
            this._fallback.grain = grain;
            this._fallback.width = width;
            this._fallback.height = height;
        }
        this.queue_repaint();
    }

    _configure(layout, width, height, brightness, grain, glass) {
        this._intermediatesValid = false;
        const oldBuffers = this.buffers;
        const buffers = layout.sizes.map(([w, h], i) => {
            const old = oldBuffers?.[i];
            if (old && w <= old.capW && h <= old.capH && w * h * 3 >= old.capW * old.capH) {
                old.w = w;
                old.h = h;
                old.fb.set_viewport(0, 0, w, h);
                return old;
            }
            // Initial allocation uses exact target dimensions; active resize growth
            // rounds up in coarse steps to avoid per-frame texture churn.
            const growing = !!old && (w > old.capW || h > old.capH);
            const capW = growing ? resizeCapacity(w, i, w > old.capW ? old.capW : 0) : w;
            const capH = growing ? resizeCapacity(h, i, h > old.capH ? old.capH : 0) : h;
            return target(w, h, capW, capH);
        });
        buffers[0].fb.orthographic(0, 0, width, height, -1, 1);
        const draws = layout.steps.map((step, i, steps) => {
            const src = buffers[step.from], last = i === steps.length - 1;
            const dst = last ? null : buffers[step.to];
            const old = this.draws?.[i];
            const pipeline = old?.down === step.down ? old.pipeline : makePipeline(step.down);
            // Inner quads cover their entire target. Store straight shader output
            // as premultiplied RGBA without reading or clearing the destination.
            pipeline.set_blend(last ? sourceOver :
                'RGB = ADD (SRC_COLOR * (SRC_COLOR[A]), 0)\nA = ADD (SRC_COLOR, 0)');
            pipeline.set_color4ub(255, 255, 255, 255);
            pipeline.set_layer_texture(0, src.texture);
            const values = uniforms(step, i, steps.length, brightness, grain, glass);
            Object.assign(values, {
                phase_x: 1, phase_y: 1,
                width: src.capW, height: src.capH,
                first_x: 0, first_y: 0,
                last_x: src.w - 1, last_y: src.h - 1,
            });
            for (const [name, value] of Object.entries(values)) {
                const key = name === 'is_last_pass' || name === 'dither_pattern' ? '_u_' + name : name;
                pipeline.set_uniform_1f(pipeline.get_uniform_location(key), value);
            }
            const [w, h] = layout.sizes[step.to];
            if (dst) {
                dst.fb.set_viewport(0, 0, w, h);
                dst.fb.orthographic(0, 0, w, h, -1, 1);
            }
            return {down: step.down, pipeline, fb: dst?.fb, w: last ? width : w, h: last ? height : h,
                u: w / (step.gridX * src.capW), v: h / (step.gridY * src.capH),
                beforeReuse: step.down && !steps[i + 1]?.down && steps[i + 1]?.to > 0 && steps[i + 1]?.to === step.from};
        });
        if (this.draws) {
            for (let i = draws.length; i < this.draws.length; i++) {
                try { this.draws[i].pipeline.set_layer_null_texture(0); } catch (_) {}
            }
        }
        if (oldBuffers) {
            for (let i = 0; i < oldBuffers.length; i++) {
                if (oldBuffers[i] !== buffers[i])
                    noteDroppedBuffer(oldBuffers[i]);
            }
        }
        this.buffers = buffers;
        this.draws = draws;
        this.queue_repaint();
    }

    vfunc_paint(context, flags) {
        const actor = this.get_actor();
        if (!this.buffers || (flags & Clutter.EffectPaintFlags.BYPASS_EFFECT)) {
            this._intermediatesValid = false;
            actor.continue_paint(context);
            return;
        }
        if (!this._intermediatesValid || (flags & Clutter.EffectPaintFlags.ACTOR_DIRTY)) {
            this._intermediatesValid = false;
            this._paintIntermediates(context, actor);
            this._intermediatesValid = true;
        }

        // The final pass draws into the current destination and applies paint
        // opacity. Its input is already available even on a clean repaint.
        const {pipeline, w, h, u, v} = this.draws[this.draws.length - 1];
        const opacity = actor.get_paint_opacity();
        pipeline.set_color4ub(opacity, opacity, opacity, opacity);
        context.get_framebuffer().draw_textured_rectangle(pipeline, 0, 0, w, h, 0, 0, u, v);
    }

    _paintIntermediates(context, actor) {
        const capture = this.buffers[0].fb;
        const previous = actor.get_opacity_override();
        capture.clear4f(Cogl.BufferBit.COLOR | Cogl.BufferBit.DEPTH, 0, 0, 0, 0);
        context.push_framebuffer(capture);
        actor.set_opacity_override(255);
        try {
            actor.continue_paint(context);
        } finally {
            actor.set_opacity_override(previous);
            context.pop_framebuffer();
        }
        for (const draw of this.draws) {
            if (!draw.fb) break;
            draw.fb.draw_textured_rectangle(draw.pipeline, 0, 0, draw.w, draw.h, 0, 0, draw.u, draw.v);
            // Submit the down chain before overwriting a level it sampled.
            // Muffin journals track framebuffer dependencies in both directions.
            if (draw.beforeReuse) Cogl.flush();
        }
    }
});

var KawasePyramid = class KawasePyramid {
    constructor({radius = 0, brightness = 1, grain = 0} = {}) {
        this.actor = new Level({width: 0, height: 0, clip_to_allocation: true});
        this.content = new Level({width: 0, height: 0, clip_to_allocation: true});
        this.actor.add_child(this.content);
        this._radius = radius;
        this._brightness = brightness;
        this._grain = grain;
        this._glass = false;
        this._storeFinalAlpha = false;
        this._slots = [];
        this.sample_reach = 0;
        this._theme = St.ThemeContext.get_for_stage(global.stage);
        this._themeSignal = this._theme.connect('notify::scale-factor', () => this._sync());
        this.actor.connect('notify::size', () => this._sync());
        this.actor.connect(scaleSignal, () => this._sync());
        this.actor.connect('destroy', () => this._dispose());
    }

    set_size(w, h) { this.actor.set_size(Math.max(0, w), Math.max(0, h)); }

    // Query before selecting clones or resizing the viewport. The dimensions
    // are the visible logical rectangle. Pass the target resource scale if
    // Clutter has not resolved it yet, for example before parenting the actor.
    get_sampling_margin(width, height, resourceScale) {
        return samplingMargin(width, height, this._radius, backingScale(this.actor, resourceScale),
            this._theme.scale_factor, this._explicit?.fallbackReach);
    }

    get radius() { return this._radius; }
    set radius(v) { if (v !== this._radius) { this._radius = v; this._sync(); } }
    get brightness() { return this._brightness; }
    set brightness(v) { if (v !== this._brightness) { this._brightness = v; this._sync(); } }
    get grain() { return this._grain; }
    set grain(v) { if (v !== this._grain) { this._grain = v; this._sync(); } }
    get glass_backdrop() { return this._glass; }
    set glass_backdrop(v) { if (v !== this._glass) { this._glass = v; this._sync(); } }
    get store_final_alpha() { return this._storeFinalAlpha; }
    set store_final_alpha(v) { if (v !== this._storeFinalAlpha) { this._storeFinalAlpha = v; this._sync(); } }

    _clear() {
        if (this._explicit) {
            this._explicit.clear();
            this.content.remove_effect(this._explicit);
            this._explicit = null;
        }
        for (const slot of this._slots) {
            if (slot) release(slot.effect);
        }
        if (this._composite) {
            release(this._composite);
            this._composite = null;
        }
        if (this._disposed) {
            this._slots = [];
            return; // Clutter destroys the children with their parent.
        }
        const parent = this.content.get_parent();
        if (parent !== this.actor) {
            parent?.remove_child(this.content);
            this.actor.add_child(this.content);
        }
        for (const slot of this._slots) {
            if (slot && slot.actor !== this.content && slot.actor.get_parent())
                slot.actor.destroy();
        }
        this._slots = [];
        this.content.set_scale(1, 1);
        this._shape = '';
    }

    _sync() {
        if (this._disposed || this._syncing) return;
        this._syncing = true;
        try {
            const {width, height} = this.actor;
            const scale = backingScale(this.actor);
            const layout = logicalPlan(width, height, this._radius, scale,
                this._theme.scale_factor, this._brightness !== 1 || this._grain > 0);
            this.sample_reach = layout.reach;
            this.content.set_size(width, height);
            if (!layout.steps.length) {
                // Keep an existing actor chain across transient 0×0 collapses
                // (e.g. animated popup menu open) to avoid actor teardown/rebuild churn.
                if (this._explicit || (this._shape && (this._radius <= 0 || (width > 0 && height > 0))))
                    this._clear();
            } else if (direct) {
                const effect = this._explicit || new Explicit();
                if (!this._explicit) {
                    this.content.add_effect(effect);
                    this._explicit = effect;
                }
                effect.configure(layout, width, height, this._radius, this._brightness, this._grain, this._glass);
                this.sample_reach = Math.max(layout.reach, effect.fallbackReach);
            } else {
                this._configureActors(layout, scale);
            }
        } catch (error) {
            this._clear();
            this.sample_reach = 0;
            throw error;
        } finally {
            this._syncing = false;
        }
    }

    _configureActors(layout, scale) {
        const needComposite = resolve && !this._storeFinalAlpha;
        const shape = layout.steps.map(s => s.down ? 'd' : 'u').join('');
        if (this._shape !== shape) {
            this._clear();
            this.actor.remove_child(this.content);
            let parent = this.actor;
            for (let i = layout.steps.length - 1; i >= 0; i--) {
                const actor = i === 0 ? this.content : new Level({clip_to_allocation: true});
                parent.add_child(actor);
                const effect = take(layout.steps[i].down ? Down : Up);
                effect.texWidth = effect.texHeight = 0;
                actor.add_effect(effect);
                this._slots[i] = {actor, effect};
                parent = actor;
            }
            this._shape = shape;
        }
        if (needComposite && !this._composite) {
            this._composite = take(Composite);
            this.actor.add_effect(this._composite);
        } else if (!needComposite && this._composite) {
            release(this._composite);
            this._composite = null;
        }
        layout.steps.forEach((step, i, steps) => {
            const {actor, effect} = this._slots[i];
            if (actor !== this.content) actor.set_size(...layout.sizes[step.from]);
            const [sw, sh] = layout.sizes[step.from], [dw, dh] = layout.sizes[step.to];
            const sx = dw / sw, sy = dh / sh;
            actor.set_scale(sx, sy);
            setFloat(effect, 'phase_x', sx / step.gridX);
            setFloat(effect, 'phase_y', sy / step.gridY);
            if (effect.backingScale !== scale) effect.texWidth = effect.texHeight = 0;
            effect.backingScale = scale;
            const vals = uniforms(step, i, steps.length, this._brightness, this._grain, this._glass);
            for (const [name, value] of Object.entries(vals)) {
                if (name === 'is_last_pass' || name === 'dither_pattern') effect.set_uniform_value(name, value);
                else setFloat(effect, name, value);
            }
            effect.queue_repaint();
        });
    }

    _dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._theme.disconnect(this._themeSignal);
        this._clear();
    }

    destroy() {
        if (this._disposed) return;
        this._dispose();
        this.actor.destroy();
    }
};

// Older Muffin needs explicit child actors to obtain smaller native targets.
// Its viewport already owns a clone of the complete scene, so that clone can
// become the pyramid input without reparenting or recapturing the source.
function supportsActor(actor) {
    return direct || !!actor?._blurCinnamonSceneClone;
}

// Cinnamon 6.2+ provides hardware linear filtering via Cinnamon.GLSLEffect
// (direct Cogl targets on 6.8+, Clutter actor pyramid on 6.2-6.6). Cinnamon 6.0
// requires 4-fetch manual bilinear in GLSL, so it remains on stable by default.
function isDefaultSupported() {
    return direct || resolve;
}

var PyramidEffect = GObject.registerClass({GTypeName: 'BlurCinnamonPyramidEffect' + tag},
    class PyramidEffect extends Explicit {
        constructor({radius = 0, brightness = 1, grain = 0} = {}) {
            super();
            this._radius = radius;
            this._brightness = brightness;
            this._grain = grain;
            this._glass = false;
        }

        get radius() { return this._radius; }
        set radius(value) { if (value !== this._radius) { this._radius = value; this._sync(); } }
        get brightness() { return this._brightness; }
        set brightness(value) { if (value !== this._brightness) { this._brightness = value; this._sync(); } }
        get grain() { return this._grain; }
        set grain(value) { if (value !== this._grain) { this._grain = value; this._sync(); } }
        get glass_backdrop() { return this._glass; }
        set glass_backdrop(value) { if (value !== this._glass) { this._glass = value; this._sync(); } }

        get sample_reach() { return this._pyramid?.sample_reach ?? Math.max(this._reach ?? 0, this.fallbackReach); }
        get_sampling_margin(width, height, resourceScale) {
            return samplingMargin(width, height, this._radius, backingScale(this._target, resourceScale),
                St.ThemeContext.get_for_stage(global.stage).scale_factor, this.fallbackReach);
        }

        _sync() {
            const actor = this._target;
            if (!actor) return;
            const {width, height} = actor;
            if (this._pyramid) {
                const pyramid = this._pyramid;
                pyramid.store_final_alpha = resolve && hasOuterOffscreen(actor, this);
                pyramid.radius = this._radius;
                pyramid.brightness = this._brightness;
                pyramid.grain = this._grain;
                pyramid.glass_backdrop = this._glass;
                pyramid.set_size(width, height);
            } else {
                const layout = logicalPlan(width, height, this._radius, backingScale(actor),
                    this._theme.scale_factor, this._brightness !== 1 || this._grain > 0);
                this._reach = layout.reach;
                if (layout.steps.length) {
                    this.configure(layout, width, height, this._radius, this._brightness, this._grain, this._glass);
                } else {
                    this.clear();
                    this.queue_repaint();
                }
            }
        }

        _detach(destroying) {
            const actor = this._target;
            if (!actor) return;
            attachedEffects.delete(this);
            this._target = null;
            if (!destroying) {
                actor.disconnect(this._sizeId);
                actor.disconnect(this._destroyId);
                if (this._scaleId) actor.disconnect(this._scaleId);
            }
            if (this._theme) {
                this._theme.disconnect(this._themeId);
                this._theme = null;
                this._scaleId = 0;
            }
            if (this._pyramid) {
                if (!destroying) {
                    const scene = actor._blurCinnamonSceneClone;
                    this._pyramid.content.remove_child(scene);
                    actor.add_child(scene);
                    this._pyramid.destroy();
                }
                this._pyramid = null;
            }
            this.clear(destroying);
            this._reach = 0;
        }

        vfunc_paint(context, flags) {
            if (this._pyramid && resolve) {
                const want = hasOuterOffscreen(this._target, this);
                if (want !== this._pyramid.store_final_alpha)
                    this._pyramid.store_final_alpha = want;
            }
            super.vfunc_paint(context, flags);
        }

        vfunc_set_actor(actor) {
            this._detach(!this.get_actor());
            super.vfunc_set_actor(actor);
            if (!actor) return;
            attachedEffects.add(this);
            this._target = actor;
            this._sizeId = actor.connect('notify::size', () => this._sync());
            this._destroyId = actor.connect('destroy', () => this._detach(true));
            if (direct) {
                this._theme = St.ThemeContext.get_for_stage(global.stage);
                this._themeId = this._theme.connect('notify::scale-factor', () => this._sync());
                this._scaleId = actor.connect(scaleSignal, () => this._sync());
            } else {
                const scene = actor._blurCinnamonSceneClone;
                this._pyramid = new KawasePyramid({radius: this._radius, brightness: this._brightness, grain: this._grain});
                actor.remove_child(scene);
                this._pyramid.content.add_child(scene);
                actor.add_child(this._pyramid.actor);
            }
            this._sync();
        }
    });
