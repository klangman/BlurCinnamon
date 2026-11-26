// This code is copied from Blur My Shell (https://github.com/aunetx/blur-my-shell) Aurélien Hamy
// Modified for Cinnamon by Kevin Langman

const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

// Cinnamon 6.8+ deprecates require() in favour of the xlet's own importer (which only exposes
// top-level var/function names). Older Cinnamon has no getCurrentExtension(), so fall back to
// require() there - and when loaded outside of Cinnamon (no global), as before.
const Me = (typeof global !== 'undefined' && imports.ui.extension.getCurrentExtension) ?
              imports.ui.extension.getCurrentExtension() : null;
function importLocal(name) {
   return Me ? Me.imports[name] : require("./" + name);
}

const Utils = importLocal("utils");
const DualKawaseBlur = importLocal("dual_kawase_blur");
const Kawase = importLocal("kawase_pyramid");
const EffectBase = importLocal("effect_base");

const SHADER_FILENAME = 'refraction.glsl';

const CLIP_STABILIZE_EPSILON = 1.0;
var MAX_BLUR_RADIUS = 48.0;

const DEFAULT_PARAMS = {
    strength: 1.0,
    blur_radius: 10,
    edge_size: 32,
    falloff: 1.50,
    refraction_style: 0.0,
    corner_radius: 0,
    corners_top: true,
    corners_bottom: true,
    rim_width: 4.8,
    reach: 0,
    rgb_fringing: 0.15,
    gloss: 1.0,
    fresnel_angle: 0.0,
    fresnel_width: 1.5,
    fresnel_two_sided: true,
    specular_strength: 0.10,
    edge_shadow: 0.70,
    edge_glow: 0.50,
    webcam_gloss: false,
    webcam_device: '',
    tint: 0.10,
    tint_color: [0.71373, 0.71373, 0.71373, 1.0],
    backdrop_zoom: 1.0,
    shadow: 0.30,
    texture_repeat: 0,
    blur_direction: 0,
    private_pass: 0,
    chained_effect: null,
    width: 0,
    height: 0,
    opacity_factor: 1.0,
    clip: [0, 0, -1, -1],
    grain: 0
};

const INTEGRAL_UNIFORMS = new Set([
    'corners_bottom',
    'corners_top',
    'divider',
    'dir',
    'downsampling_mode',
    'factor',
    'fresnel_two_sided',
    'iterations',
    'mode',
    'operation',
    'prefer_closer_pixels',
    'straight_corners',
    'texture_repeat',
    'use_base_pixel',
]);

// Position of an actor on the stage from its own and its ancestors' positions. Unlike
// get_transformed_position(), it is current as soon as a position is set, before the next allocation.
function stage_position(actor) {
    let x = 0, y = 0;
    for (let a = actor; a; a = a.get_parent()) {
        x += a.x;
        y += a.y;
    }
    return [x, y];
}

function get_shader_value(name, value) {
    // EffectBase takes plain numbers when built on Cinnamon.GLSLEffect (all uniforms are set as floats)
    if (typeof value !== 'number' || EffectBase.USE_GLSL_EFFECT)
        return value;

    if (INTEGRAL_UNIFORMS.has(name))
        return Math.trunc(value);

    const float_value = new GObject.Value();
    float_value.init(GObject.TYPE_FLOAT);
    float_value.set_float(value);
    return float_value;
}

var RefractionEffect = new GObject.registerClass({
        GTypeName: `RefractionEffect_${Math.floor(Math.random() * 100000) + 1}`,
        Properties: {
            'strength': GObject.ParamSpec.double(
                `strength`,
                `Strength`,
                `Refraction strength`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.strength,
            ),
            'edge_size': GObject.ParamSpec.double(
                `edge_size`,
                `Edge Size`,
                `Refraction edge size`,
                GObject.ParamFlags.READWRITE,
                1.0, 500.0,
                DEFAULT_PARAMS.edge_size,
            ),
            'blur_radius': GObject.ParamSpec.double(
                `blur_radius`,
                `Blur Radius`,
                `Internal glass blur radius`,
                GObject.ParamFlags.READWRITE,
                0.0, MAX_BLUR_RADIUS,
                DEFAULT_PARAMS.blur_radius,
            ),
            'falloff': GObject.ParamSpec.double(
                `falloff`,
                `Falloff`,
                `Refraction falloff`,
                GObject.ParamFlags.READWRITE,
                0.25, 20.0,
                DEFAULT_PARAMS.falloff,
            ),
            'refraction_style': GObject.ParamSpec.double(
                `refraction_style`,
                `Refraction Style`,
                `0 is quartz 0.1.1b profile; higher blends toward the legacy Snell S-curve`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.refraction_style,
            ),
            'corner_radius': GObject.ParamSpec.double(
                `corner_radius`,
                `Corner Radius`,
                `Refraction corner radius`,
                GObject.ParamFlags.READWRITE,
                0.0, 200.0,
                DEFAULT_PARAMS.corner_radius,
            ),
            'corners_top': GObject.ParamSpec.boolean(
                `corners_top`,
                `Corners Top`,
                `Round top corners`,
                GObject.ParamFlags.READWRITE,
                DEFAULT_PARAMS.corners_top,
            ),
            'corners_bottom': GObject.ParamSpec.boolean(
                `corners_bottom`,
                `Corners Bottom`,
                `Round bottom corners`,
                GObject.ParamFlags.READWRITE,
                DEFAULT_PARAMS.corners_bottom,
            ),
            'rim_width': GObject.ParamSpec.double(
                `rim_width`,
                `Rim Width`,
                `Refraction rim width`,
                GObject.ParamFlags.READWRITE,
                1.0, 6.5,
                DEFAULT_PARAMS.rim_width,
            ),
            'reach': GObject.ParamSpec.double(
                `reach`,
                `Reach`,
                `How far the refraction reaches inward past the corner radius`,
                GObject.ParamFlags.READWRITE,
                0.0, 500.0,
                DEFAULT_PARAMS.reach,
            ),
            'rgb_fringing': GObject.ParamSpec.double(
                `rgb_fringing`,
                `RGB Fringing`,
                `Chromatic offset strength`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.rgb_fringing,
            ),
            'gloss': GObject.ParamSpec.double(
                `gloss`,
                `Gloss`,
                `Fresnel glare strength`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.gloss,
            ),
            'fresnel_angle': GObject.ParamSpec.double(
                `fresnel_angle`,
                `Fresnel Angle`,
                `Direction or axis of the fresnel glare, in degrees`,
                GObject.ParamFlags.READWRITE,
                -180.0, 180.0,
                DEFAULT_PARAMS.fresnel_angle,
            ),
            'fresnel_width': GObject.ParamSpec.double(
                `fresnel_width`,
                `Fresnel Width`,
                `Thickness multiplier of the fresnel glare ring`,
                GObject.ParamFlags.READWRITE,
                0.5, 6.0,
                DEFAULT_PARAMS.fresnel_width,
            ),
            'fresnel_two_sided': GObject.ParamSpec.boolean(
                `fresnel_two_sided`,
                `Two-sided Fresnel Glare`,
                `Light opposite edge pairs symmetrically`,
                GObject.ParamFlags.READWRITE,
                DEFAULT_PARAMS.fresnel_two_sided,
            ),
            'specular_strength': GObject.ParamSpec.double(
                `specular_strength`,
                `Specular Glare Strength`,
                `Strength of the white specular glare on the glass edge`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.specular_strength,
            ),
            'edge_shadow': GObject.ParamSpec.double(
                `edge_shadow`,
                `Edge Border`,
                `Strength of the thin dark line along the glass side edges`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.edge_shadow,
            ),
            'edge_glow': GObject.ParamSpec.double(
                `edge_glow`,
                `Edge Glow`,
                `Strength of the colored light picked up by the glass edge`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.edge_glow,
            ),
            'webcam_gloss': GObject.ParamSpec.boolean(
                `webcam_gloss`,
                `Deprecated Webcam Gloss`,
                `Deprecated compatibility property`,
                GObject.ParamFlags.READWRITE,
                false,
            ),
            'webcam_device': GObject.ParamSpec.string(
                `webcam_device`,
                `Deprecated Webcam Device`,
                `Deprecated compatibility property`,
                GObject.ParamFlags.READWRITE,
                '',
            ),
            'tint': GObject.ParamSpec.double(
                `tint`,
                `Tint`,
                `Glass tint strength`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.tint,
            ),
            'tint_red': GObject.ParamSpec.double(
                `tint_red`,
                `Tint Red`,
                `Glass tint color red`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.tint_color[0],
            ),
            'tint_green': GObject.ParamSpec.double(
                `tint_green`,
                `Tint Green`,
                `Glass tint color green`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.tint_color[1],
            ),
            'tint_blue': GObject.ParamSpec.double(
                `tint_blue`,
                `Tint Blue`,
                `Glass tint color blue`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.tint_color[2],
            ),
            'tint_alpha': GObject.ParamSpec.double(
                `tint_alpha`,
                `Tint Alpha`,
                `Glass tint color alpha`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.tint_color[3],
            ),
            'backdrop_zoom': GObject.ParamSpec.double(
                `backdrop_zoom`,
                `Backdrop Zoom`,
                `Zoom level of the refracted backdrop`,
                GObject.ParamFlags.READWRITE,
                0.1, 4.0,
                DEFAULT_PARAMS.backdrop_zoom,
            ),
            'shadow': GObject.ParamSpec.double(
                `shadow`,
                `Shadow`,
                `Inner shadow strength`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                DEFAULT_PARAMS.shadow,
            ),
            'texture_repeat': GObject.ParamSpec.int(
                `texture_repeat`,
                `Texture Repeat`,
                `Texture repeat behavior`,
                GObject.ParamFlags.READWRITE,
                0, 1,
                DEFAULT_PARAMS.texture_repeat,
            ),
            'blur_direction': GObject.ParamSpec.int(
                `blur_direction`,
                `Blur Direction`,
                `Deprecated compatibility property`,
                GObject.ParamFlags.READWRITE,
                0, 1,
                0,
            ),
            'private_pass': GObject.ParamSpec.int(
                `private_pass`,
                `Private Pass`,
                `Deprecated compatibility property`,
                GObject.ParamFlags.READWRITE,
                0, 1,
                0,
            ),
            'chained_effect': GObject.ParamSpec.object(
                `chained_effect`,
                `Chained Effect`,
                `Private chained blur effect`,
                GObject.ParamFlags.READWRITE,
                GObject.Object,
            ),
            'width': GObject.ParamSpec.double(
                `width`,
                `Width`,
                `Width`,
                GObject.ParamFlags.READWRITE,
                0.0, Number.MAX_SAFE_INTEGER,
                0.0,
            ),
            'height': GObject.ParamSpec.double(
                `height`,
                `Height`,
                `Height`,
                GObject.ParamFlags.READWRITE,
                0.0, Number.MAX_SAFE_INTEGER,
                0.0,
            ),
            // See corner.js: this is backed by an array setter, but represented
            // as a dummy property so pipeline parameter assignment can reach it.
            'clip': GObject.ParamSpec.double(
                `clip`,
                `Clip`,
                `Clip`,
                GObject.ParamFlags.READWRITE,
                0.0, Number.MAX_SAFE_INTEGER,
                0.0,
            ),
            'opacity_factor': GObject.ParamSpec.double(
                `opacity_factor`,
                `Opacity factor`,
                `Opacity factor`,
                GObject.ParamFlags.READWRITE,
                0.0, 1.0,
                1.0,
            ),
            'grain': GObject.ParamSpec.double(
                `grain`,
                `Grain`,
                `Blur grain`,
                GObject.ParamFlags.READWRITE,
                0.0, 100.0,
                0.0,
            ),
        }
    }, class RefractionEffect extends EffectBase.EffectBase {

        constructor(params) {
            const {
                webcam_gloss: _webcam_gloss,
                webcam_device: _webcam_device,
                tint_color: _tint_color,
                use_kawase_pyramid = false,
                ...parent_params
            } = params;
            super({ ...parent_params });

            this._clip_x0 = null;
            this._clip_y0 = null;
            this._clip_width = null;
            this._clip_height = null;
            this._stable_clip_x0 = null;
            this._stable_clip_y0 = null;
            this._stable_clip_width = null;
            this._stable_clip_height = null;
            this._stabilize_clip_x = false;
            this._stabilize_clip_y = false;
            this._clip_settle_timeout_id = null;
            this._clip_on_screen = false;
            this._clip_origin = null;
            this._glass_rect = null;

            Utils.setup_params(this, params);

            // Keep the public 0..48 blur-radius API used by extension.js, but
            // let Dual Kawase consume the original 0..100 intensity.
            this._use_kawase_pyramid = use_kawase_pyramid;
            if (this.private_pass === 0 && !use_kawase_pyramid)
                this._ensure_blur_effect();

            this._theme_context = St.ThemeContext.get_for_stage(global.stage);
            this._theme_connection_id = null;
        }

        get_effect_source() {
            return Utils.get_shader_source(SHADER_FILENAME);
        }

        static get default_params() {
            return DEFAULT_PARAMS;
        }

        // For dithering: the glass pass runs after its Dual Kawase blur and writes the result (see
        // effect_base.js). It doesn't average, so about one level of that blur's noise shows through.
        get passes_after() {
            return 0;
        }

        _set_uniform(name, value) {
            this.set_uniform_value(name, get_shader_value(name, value));
        }

        get grain() {
            return this._grain;
        }

        set grain(value) {
            if (this._grain !== value) {
                this._grain = value;

                EffectBase.updateDither(this);

                if (this.chained_effect)
                    this.chained_effect.grain = value;
            }
        }

        get strength() {
            return this._strength;
        }

        set strength(value) {
            const strength = Math.max(0.0, Math.min(1.0, value));
            if (this._strength !== strength) {
                this._strength = strength;
                this._set_uniform('strength', this._strength);
            }
        }

        get edge_size() {
            return this._edge_size;
        }

        set edge_size(value) {
            const edge_size = Math.max(1.0, Math.min(500.0, value));
            if (this._edge_size !== edge_size) {
                this._edge_size = edge_size;
                this.update_scaled_uniforms();
            }
        }

        get sample_reach() {
            return this._samplingReach();
        }

        get_sampling_margin(width, height, resourceScale) {
            return this._samplingReach(
                this.chained_effect?.get_sampling_margin?.(width, height, resourceScale),
                width,
                height
            );
        }

        _samplingReach(blur_reach = this.chained_effect?.sample_reach ?? 0, rect_width = 0, rect_height = 0) {
            const scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

            const actor = this.get_actor();
            const visible = actor?._blurCinnamonSamplingRect ?? actor?._blurCinnamonVisibleRect;
            const visible_w = rect_width > 0 ? rect_width : (visible?.[2] ?? 0);
            const visible_h = rect_height > 0 ? rect_height : (visible?.[3] ?? 0);
            const has_visible_rect = visible_w > 0 && visible_h > 0;
            const has_clip = this._clip_width >= 0 && this._clip_height >= 0;

            // Match refraction.glsl: bezel, rim band and lens band are all capped to half the
            // shortest visible side, so small surfaces (OSDs, panels, tooltips) do not reserve
            // a sampling margin larger than the surface itself.
            const eff_w = has_visible_rect ? visible_w : (has_clip ? this._clip_width : 0);
            const eff_h = has_visible_rect ? visible_h : (has_clip ? this._clip_height : 0);
            const shortest = (eff_w > 0 && eff_h > 0) ? Math.min(eff_w, eff_h) : 0;
            const half_short = shortest * 0.5;

            const raw_edge = Math.max(1, (this.edge_size ?? DEFAULT_PARAMS.edge_size) * scale_factor);
            const bezel = shortest > 0 ? Math.max(1, Math.min(raw_edge, half_short)) : raw_edge;
            let rim_band = Math.max(1, bezel * 0.35 * Math.max(1, this.rim_width));
            if (shortest > 0)
                rim_band = Math.min(rim_band, half_short);
            const raw_reach = Math.max(0, this.reach ?? 0) * scale_factor;
            const lens_band = Math.max(rim_band, shortest > 0 ? Math.min(raw_reach, half_short) : raw_reach);

            const strength = Math.max(0, Math.min(1, this.strength));
            const dispersion = Math.max(0, Math.min(1, this.rgb_fringing)) * 0.9;

            // Matches BEND_SCALE (1.4), DISPERSION_RATIO (0.9) and edgeGlowColor's inward samples
            // (up to max(1.5, 0.6 * band) + 1.8 * band from the edge) in refraction.glsl.
            const lens_disp = lens_band * strength * 1.4 * (1 + dispersion);
            const glow_reach = (this.edge_glow > 0.001)
                ? Math.max(1.5, rim_band * 0.6) + rim_band * 1.8
                : 0;
            const zoom = Math.max(0.01, this.backdrop_zoom - 1e-6);

            const shape_span = Math.max(
                0,
                visible_w,
                visible_h,
                this._clip_width ?? 0,
                this._clip_height ?? 0,
                this._stable_clip_width ?? 0,
                this._stable_clip_height ?? 0
            );

            const inverse_zoom_delta = 1 / zoom - 1;
            // The viewport asks for its margin before updating glass_rect. Detect a
            // pending on-screen resize as well as a clip that is already being stabilized
            const resize_pending = has_clip && has_visible_rect && this._clip_on_screen && !!actor?.is_mapped() && (
                Math.abs(visible_w - this._clip_width) > CLIP_STABILIZE_EPSILON ||
                Math.abs(visible_h - this._clip_height) > CLIP_STABILIZE_EPSILON
            );
            const needs_conservative_reach = this._stabilize_clip_x || this._stabilize_clip_y || resize_pending || (!has_clip && !has_visible_rect);

            // Both refraction (-lensDir) and edge glow (-dir) sample inward from the glass edge,
            // so on a settled rect they can only leave the visible bounds by overshooting the
            // opposite side (distance > shortest). Keep the full reach during resize stabilization
            // or when the visible size is unknown.
            const lens_reach = (!needs_conservative_reach && shortest > 0)
                ? Math.max(0, lens_disp - shortest, glow_reach - shortest)
                : Math.max(lens_disp, glow_reach);

            // A stabilized clip can have its centre outside the current visible
            // rect. Preserve the existing bound until that resize settles
            const zoom_reach = needs_conservative_reach
                ? (Math.max(global.stage.width, global.stage.height) + shape_span + 3) *
                    Math.abs(inverse_zoom_delta)
                : (shape_span / 2) * Math.max(0, inverse_zoom_delta) +
                    1.5 * Math.abs(inverse_zoom_delta);

            return blur_reach + lens_reach / zoom + zoom_reach;
        }

        get dual_kawase_radius() {
            return Math.max(0, Math.min(100, this.blur_radius * 100 / MAX_BLUR_RADIUS));
        }

        get use_kawase_pyramid() {
            return this._use_kawase_pyramid;
        }

        set use_kawase_pyramid(value) {
            value = !!value;
            if (this._use_kawase_pyramid === value)
                return;
            this._use_kawase_pyramid = value;
            if (this.private_pass !== 0)
                return;
            const actor = this.get_actor();
            if (actor) {
                if (this.chained_effect)
                    this.chained_effect.get_actor()?.remove_effect(this.chained_effect);
                this._ensure_blur_effect(actor);
                actor.add_effect(this.chained_effect);
            } else {
                this.chained_effect = null;
            }
        }

        _ensure_blur_effect(actor) {
            const Type = this._use_kawase_pyramid && actor && Kawase.supportsActor(actor) ?
                Kawase.PyramidEffect : DualKawaseBlur.DualFilteringBlurEffect;
            // Replace a blur whose old actor was destroyed under it: reattaching it would log
            // criticals (see effect_base.js)
            if (!(this.chained_effect instanceof Type) || EffectBase.shouldDiscard(this.chained_effect)) {
                this.chained_effect = new Type({
                    radius: this.dual_kawase_radius,
                    brightness: 1,
                    width: this.width,
                    height: this.height,
                    grain: this.grain
                });
                this.chained_effect.glass_backdrop = true;
            } else {
                this.chained_effect.radius = this.dual_kawase_radius;
            }
        }

        get blur_radius() {
            return this._blur_radius;
        }

        set blur_radius(value) {
            const blur_radius = Math.max(0, Math.min(value, MAX_BLUR_RADIUS));
            if (this._blur_radius !== blur_radius) {
                this._blur_radius = blur_radius;

                if (this.chained_effect)
                    this.chained_effect.radius = this.dual_kawase_radius;
            }
        }

        get falloff() {
            return this._falloff;
        }

        set falloff(value) {
            const falloff = Math.max(0.25, Math.min(20.0, value));
            if (this._falloff !== falloff) {
                this._falloff = falloff;
                this._set_uniform('falloff', this._falloff);
            }
        }

        get refraction_style() {
            return this._refraction_style;
        }

        set refraction_style(value) {
            const style = Math.max(0.0, Math.min(1.0, value));
            if (this._refraction_style !== style) {
                this._refraction_style = style;
                this._set_uniform('refraction_style', this._refraction_style);
            }
        }

        get corner_radius() {
            return this._corner_radius;
        }

        set corner_radius(value) {
            const corner_radius = Math.max(0.0, Math.min(200.0, value));
            if (this._corner_radius !== corner_radius) {
                this._corner_radius = corner_radius;
                this.update_scaled_uniforms();
            }
        }

        get corners_top() {
            return this._corners_top;
        }

        set corners_top(value) {
            const top = Boolean(value);
            if (this._corners_top !== top) {
                this._corners_top = top;
                this._set_uniform('corners_top', this._corners_top ? 1 : 0);
            }
        }

        get corners_bottom() {
            return this._corners_bottom;
        }

        set corners_bottom(value) {
            const bottom = Boolean(value);
            if (this._corners_bottom !== bottom) {
                this._corners_bottom = bottom;
                this._set_uniform('corners_bottom', this._corners_bottom ? 1 : 0);
            }
        }

        get rim_width() {
            return this._rim_width;
        }

        set rim_width(value) {
            const rim_width = Math.max(1.0, Math.min(value, 6.5));
            if (this._rim_width !== rim_width) {
                this._rim_width = rim_width;
                this._set_uniform('rim_width', this._rim_width);
            }
        }

        get reach() {
            return this._reach;
        }

        set reach(value) {
            const reach = Math.max(0.0, Math.min(500.0, value));
            if (this._reach !== reach) {
                this._reach = reach;
                this.update_scaled_uniforms();
            }
        }

        get rgb_fringing() {
            return this._rgb_fringing;
        }

        set rgb_fringing(value) {
            const rgb_fringing = Math.max(0.0, Math.min(1.0, value));
            if (this._rgb_fringing !== rgb_fringing) {
                this._rgb_fringing = rgb_fringing;
                this._set_uniform('rgb_fringing', this._rgb_fringing);
            }
        }

        get gloss() {
            return this._gloss;
        }

        set gloss(value) {
            const gloss = Math.max(0.0, Math.min(1.0, value));
            if (this._gloss !== gloss) {
                this._gloss = gloss;
                this._set_uniform('gloss', this._gloss);
            }
        }

        get fresnel_angle() {
            return this._fresnel_angle;
        }

        set fresnel_angle(value) {
            const angle = Math.max(-180.0, Math.min(180.0, value));
            if (this._fresnel_angle !== angle) {
                this._fresnel_angle = angle;
                this._set_uniform('fresnel_angle', (this._fresnel_angle + 90.0) * Math.PI / 180.0);
            }
        }

        get fresnel_width() {
            return this._fresnel_width;
        }

        set fresnel_width(value) {
            const fresnel_width = Math.max(0.5, Math.min(6.0, value));
            if (this._fresnel_width !== fresnel_width) {
                this._fresnel_width = fresnel_width;
                this._set_uniform('fresnel_width', this._fresnel_width);
            }
        }

        get fresnel_two_sided() {
            return this._fresnel_two_sided;
        }

        set fresnel_two_sided(value) {
            const two_sided = Boolean(value);
            if (this._fresnel_two_sided !== two_sided) {
                this._fresnel_two_sided = two_sided;
                this._set_uniform('fresnel_two_sided', this._fresnel_two_sided ? 1 : 0);
            }
        }

        get specular_strength() {
            return this._specular_strength;
        }

        set specular_strength(value) {
            const specular_strength = Math.max(0.0, Math.min(1.0, value));
            if (this._specular_strength !== specular_strength) {
                this._specular_strength = specular_strength;
                this._set_uniform('specular_strength', this._specular_strength);
            }
        }

        get edge_shadow() {
            return this._edge_shadow;
        }

        set edge_shadow(value) {
            const edge_shadow = Math.max(0.0, Math.min(1.0, value));
            if (this._edge_shadow !== edge_shadow) {
                this._edge_shadow = edge_shadow;
                this._set_uniform('edge_shadow', this._edge_shadow);
            }
        }

        get edge_glow() {
            return this._edge_glow;
        }

        set edge_glow(value) {
            const edge_glow = Math.max(0.0, Math.min(1.0, value));
            if (this._edge_glow !== edge_glow) {
                this._edge_glow = edge_glow;
                this._set_uniform('edge_glow', this._edge_glow);
            }
        }

        // Deprecated no-op compatibility properties for old saved pipelines.
        get webcam_gloss() {
            return this._webcam_gloss;
        }

        set webcam_gloss(value) {
            this._webcam_gloss = value;
        }

        get webcam_device() {
            return this._webcam_device;
        }

        set webcam_device(value) {
            this._webcam_device = value ?? '';
        }

        get tint() {
            return this._tint;
        }

        set tint(value) {
            const tint = Math.max(0.0, Math.min(1.0, value));
            if (this._tint !== tint) {
                this._tint = tint;
                this._set_uniform('tint', this._tint);
            }
        }

        get tint_red() {
            return this._tint_red;
        }

        set tint_red(value) {
            const red = Math.max(0.0, Math.min(1.0, value));
            if (this._tint_red !== red) {
                this._tint_red = red;
                this._set_uniform('tint_r', this._tint_red);
            }
        }

        get tint_green() {
            return this._tint_green;
        }

        set tint_green(value) {
            const green = Math.max(0.0, Math.min(1.0, value));
            if (this._tint_green !== green) {
                this._tint_green = green;
                this._set_uniform('tint_g', this._tint_green);
            }
        }

        get tint_blue() {
            return this._tint_blue;
        }

        set tint_blue(value) {
            const blue = Math.max(0.0, Math.min(1.0, value));
            if (this._tint_blue !== blue) {
                this._tint_blue = blue;
                this._set_uniform('tint_b', this._tint_blue);
            }
        }

        get tint_alpha() {
            return this._tint_alpha;
        }

        set tint_alpha(value) {
            const alpha = Math.max(0.0, Math.min(1.0, value));
            if (this._tint_alpha !== alpha) {
                this._tint_alpha = alpha;
                this._set_uniform('tint_a', this._tint_alpha);
            }
        }

        get tint_color() {
            return [this.tint_red, this.tint_green, this.tint_blue, this.tint_alpha];
        }

        set tint_color(rgba) {
            const [r, g, b, a] = Array.isArray(rgba) ? rgba : DEFAULT_PARAMS.tint_color;
            this.tint_red = r;
            this.tint_green = g;
            this.tint_blue = b;
            this.tint_alpha = a ?? 1.0;
        }

        get backdrop_zoom() {
            return this._backdrop_zoom;
        }

        set backdrop_zoom(value) {
            const zoom = Math.max(0.1, Math.min(4.0, value));
            if (this._backdrop_zoom !== zoom) {
                this._backdrop_zoom = zoom;
                this._set_uniform('backdrop_zoom', this._backdrop_zoom);
            }
        }

        get shadow() {
            return this._shadow;
        }

        set shadow(value) {
            const shadow = Math.max(0.0, Math.min(1.0, value));
            if (this._shadow !== shadow) {
                this._shadow = shadow;
                this._set_uniform('shadow', this._shadow);
            }
        }

        get texture_repeat() {
            return this._texture_repeat;
        }

        set texture_repeat(value) {
            const repeat = value ? 1 : 0;
            if (this._texture_repeat !== repeat) {
                this._texture_repeat = repeat;
                this._set_uniform('texture_repeat', this._texture_repeat);
            }
        }

        get blur_direction() {
            return this._blur_direction;
        }

        set blur_direction(value) {
            this._blur_direction = value ? 1 : 0;
        }

        get private_pass() {
            return this._private_pass;
        }

        set private_pass(value) {
            this._private_pass = value ? 1 : 0;
        }

        get chained_effect() {
            return this._chained_effect;
        }

        set chained_effect(value) {
            this._chained_effect = value;
        }

        set(params) {
            // Update supplied values without resetting the owned blur or actor geometry
            for (const name in this.constructor.default_params) {
                if (Object.prototype.hasOwnProperty.call(params, name))
                    this[name] = params[name];
            }
        }

        get width() {
            return this._width;
        }

        set width(value) {
            if (this._width !== value) {
                this._width = value;

                this._set_uniform('width', this._width + 3.0);
                this.update_scaled_uniforms();

                if (this.chained_effect)
                    this.chained_effect.width = value;
            }
        }

        get height() {
            return this._height;
        }

        set height(value) {
            if (this._height !== value) {
                this._height = value;

                this._set_uniform('height', this._height + 3.0);
                this.update_scaled_uniforms();

                if (this.chained_effect)
                    this.chained_effect.height = value;
            }
        }

        get clip() {
            return [this._clip_x0, this._clip_y0, this._clip_width, this._clip_height];
        }

        set clip(value) {
            let previous_clip = this.clip;
            const previous_on_screen = this._clip_on_screen;
            const previous_origin = this._clip_origin;
            [this._clip_x0, this._clip_y0, this._clip_width, this._clip_height] = value;

            // Only smooth a resize of glass that is on screen. A rect set while the actor is hidden (an
            // empty one while a menu opens, or a new surface on a reused background) is not a resize of
            // the rect before it, and stabilizing from it moves the zoom centre and edges once it settles.
            const actor = this.get_actor();
            this._clip_on_screen = !!actor && actor.is_mapped() && this._clip_width > 0 && this._clip_height > 0;
            // The rect is in the actor's own coordinates, and a viewport actor moves when its sampling margin
            // changes (it grows to the whole stage when a resize starts). Compare in the current coordinates,
            // using the actor's position on the stage: a window's viewport is a child of the window actor, so
            // its own x/y also change when only the window moves.
            this._clip_origin = actor ? stage_position(actor) : null;
            if (previous_origin && this._clip_origin) {
                const dx = previous_origin[0] - this._clip_origin[0];
                const dy = previous_origin[1] - this._clip_origin[1];
                previous_clip = [previous_clip[0] + dx, previous_clip[1] + dy, previous_clip[2], previous_clip[3]];
                if (this._stable_clip_x0 !== null) this._stable_clip_x0 += dx;
                if (this._stable_clip_y0 !== null) this._stable_clip_y0 += dy;
            }
            let shader_clip = this._stabilized_clip(previous_on_screen && this._clip_on_screen ? previous_clip : null);

            // Match corner.js's set_viewport_clip(): Muffin pads the offscreen FBO by 2 px before
            // the actor origin and 1 px after the far edge (width + 3, height + 3), so an actor-local
            // visible rect [x0, y0, w, h] lies at [x0 + 2, y0 + 2, w, h] in FBO pixel coordinates.
            if (shader_clip[2] >= 0 && shader_clip[3] >= 0) {
                this._set_uniform('clip_x0', shader_clip[0] + 2.0);
                this._set_uniform('clip_y0', shader_clip[1] + 2.0);
                this._set_uniform('clip_width', shader_clip[2]);
                this._set_uniform('clip_height', shader_clip[3]);
            } else {
                this._set_uniform('clip_x0', shader_clip[0]);
                this._set_uniform('clip_y0', shader_clip[1]);
                this._set_uniform('clip_width', shader_clip[2]);
                this._set_uniform('clip_height', shader_clip[3]);
            }
            this.update_scaled_uniforms();
        }

        // Optional bounds for the glass shape (edges, rim, corners), in actor-local pixels, used instead
        // of the actor's clip. BlurCinnamon's viewport actors have no clip and are larger than the visible
        // area (they include the blur's sampling margin), so without this the glass edge would be drawn out
        // in that margin and then cut away by the corner effect. null goes back to following the actor's clip.
        get glass_rect() {
            return this._glass_rect;
        }

        set glass_rect(rect) {
            const new_rect = rect ? [...rect] : null;
            const old_rect = this._glass_rect;
            if (new_rect === old_rect ||
                (new_rect && old_rect && new_rect.every((v, i) => v === old_rect[i]))) {
                // Unchanged in the actor's coordinates, but the actor may have moved with its window, and
                // the glass with it. Keep its origin current, so the next rect is compared from there.
                const actor = this.get_actor();
                this._clip_origin = actor ? stage_position(actor) : null;
                return;
            }

            this._glass_rect = new_rect;
            const actor = this.get_actor();
            if (new_rect || actor)
                this.clip = this._bounds_for_actor(actor);
        }

        _bounds_for_actor(actor) {
            if (this._glass_rect)
                return this._glass_rect;
            return (actor && actor.has_clip) ? actor.get_clip() : [0, 0, -10, -10];
        }

        get opacity_factor() {
            return this._opacity_factor;
        }

        set opacity_factor(value) {
            const opacity_factor = Math.max(0.0, Math.min(1.0, value));
            if (this._opacity_factor !== opacity_factor) {
                this._opacity_factor = opacity_factor;
                this._set_uniform('opacity_factor', this._opacity_factor);
            }
        }

        _stabilized_clip(previous_clip) {
            if (!previous_clip || this._clip_width < 0 || this._clip_height < 0) {
                this._stable_clip_x0 = null;
                this._stable_clip_y0 = null;
                this._stable_clip_width = null;
                this._stable_clip_height = null;
                this._stabilize_clip_x = false;
                this._stabilize_clip_y = false;
                if (this._clip_settle_timeout_id) {
                    GLib.Source.remove(this._clip_settle_timeout_id);
                    this._clip_settle_timeout_id = null;
                }
                return [
                    this._clip_x0,
                    this._clip_y0,
                    this._clip_width,
                    this._clip_height
                ];
            }

            const [previous_x0, previous_y0, previous_width, previous_height] = previous_clip;

            [this._stable_clip_x0, this._stable_clip_width, this._stabilize_clip_x] =
                this._stabilized_clip_axis(
                    this._clip_x0,
                    this._clip_width,
                    previous_x0,
                    previous_width,
                    this._stable_clip_x0,
                    this._stable_clip_width,
                    this._stabilize_clip_x
                );
            [this._stable_clip_y0, this._stable_clip_height, this._stabilize_clip_y] =
                this._stabilized_clip_axis(
                    this._clip_y0,
                    this._clip_height,
                    previous_y0,
                    previous_height,
                    this._stable_clip_y0,
                    this._stable_clip_height,
                    this._stabilize_clip_y
                );

            if (this._clip_settle_timeout_id)
                GLib.Source.remove(this._clip_settle_timeout_id);

            if (!this._stabilize_clip_x && !this._stabilize_clip_y) {
                this._clip_settle_timeout_id = null;
                return [
                    this._stable_clip_x0,
                    this._stable_clip_y0,
                    this._stable_clip_width,
                    this._stable_clip_height
                ];
            }

            this._clip_settle_timeout_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 220, () => {
                this._stable_clip_x0 = this._clip_x0;
                this._stable_clip_y0 = this._clip_y0;
                this._stable_clip_width = this._clip_width;
                this._stable_clip_height = this._clip_height;
                this._stabilize_clip_x = false;
                this._stabilize_clip_y = false;
                this._clip_settle_timeout_id = null;
                this.clip = [this._clip_x0, this._clip_y0, this._clip_width, this._clip_height];
                this.queue_repaint();
                return GLib.SOURCE_REMOVE;
            });

            return [
                this._stable_clip_x0,
                this._stable_clip_y0,
                this._stable_clip_width,
                this._stable_clip_height
            ];
        }

        _stabilized_clip_axis(
            start,
            size,
            previous_start,
            previous_size,
            stable_start,
            stable_size,
            stabilizing
        ) {
            const size_changed =
                previous_size !== null &&
                previous_size >= 0 &&
                Math.abs(size - previous_size) > CLIP_STABILIZE_EPSILON;

            if (!stabilizing && !size_changed)
                return [start, size, false];

            const end = start + size;
            const resolved_stable_start = stable_start ?? previous_start ?? start;
            const resolved_stable_size = stable_size ?? previous_size ?? size;
            const stable_end = resolved_stable_start + resolved_stable_size;
            const resolved_start = Math.min(resolved_stable_start, start);
            const resolved_end = Math.max(stable_end, end);

            return [resolved_start, resolved_end - resolved_start, true];
        }

        update_scaled_uniforms() {
            const scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const rect_width =
                this._stable_clip_width ?? (this._clip_width >= 0 ? this._clip_width : this.width);
            const rect_height =
                this._stable_clip_height ?? (this._clip_height >= 0 ? this._clip_height : this.height);
            const max_edge = Math.max(1, Math.min(rect_width, rect_height) / 2);
            const edge_size = Math.min((this.edge_size ?? DEFAULT_PARAMS.edge_size) * scale_factor, max_edge);
            const corner_radius = Math.min((this.corner_radius ?? DEFAULT_PARAMS.corner_radius) * scale_factor, max_edge);
            const reach = Math.min((this.reach ?? DEFAULT_PARAMS.reach) * scale_factor, max_edge);

            this._set_uniform('edge_size', edge_size);
            this._set_uniform('corner_radius', corner_radius);
            this._set_uniform('reach', reach);
            this._set_uniform('scale_factor', scale_factor);
        }

        _disconnect_theme_signal() {
            if (this._theme_connection_id) {
                this._theme_context.disconnect(this._theme_connection_id);
                this._theme_connection_id = null;
            }
        }

        vfunc_pre_paint(paintContext) {
            if (!super.vfunc_pre_paint(paintContext))
                return false;
            Utils.extendOffscreenViewport(paintContext, this.get_actor());
            return true;
        }

        vfunc_set_actor(actor) {
            this._disconnect_theme_signal();

            if (this.chained_effect)
                this.chained_effect.get_actor()?.remove_effect(this.chained_effect);

            if (this._actor_connection_size_id) {
                let old_actor = this.get_actor();
                old_actor?.disconnect(this._actor_connection_size_id);
            }
            if (this._actor_connection_clip_rect_id) {
                let old_actor = this.get_actor();
                old_actor?.disconnect(this._actor_connection_clip_rect_id);
            }
            if (this._clip_settle_timeout_id) {
                GLib.Source.remove(this._clip_settle_timeout_id);
                this._clip_settle_timeout_id = null;
            }
            if (actor) {
                this.width = actor.width;
                this.height = actor.height;
                this._actor_connection_size_id = actor.connect('notify::size', _ => {
                    this.width = actor.width;
                    this.height = actor.height;
                });

                this.clip = this._bounds_for_actor(actor);
                this._actor_connection_clip_rect_id = actor.connect('notify::clip-rect', _ => {
                    this.clip = this._bounds_for_actor(actor);
                });
            }
            else {
                this._actor_connection_size_id = null;
                this._actor_connection_clip_rect_id = null;
                this._stable_clip_x0 = null;
                this._stable_clip_y0 = null;
                this._stable_clip_width = null;
                this._stable_clip_height = null;
                this._stabilize_clip_x = false;
                this._stabilize_clip_y = false;
            }

            super.vfunc_set_actor(actor);

            if (actor) {
                this.update_scaled_uniforms();
                this._theme_context = St.ThemeContext.get_for_stage(global.stage);
                this._theme_connection_id = this._theme_context.connect('notify::scale-factor', () => this.update_scaled_uniforms());
            }

            if (actor && this.private_pass === 0) {
                this._ensure_blur_effect(actor);
                // Offscreen effects wrap subsequent effects: add the blur
                // after RefractionEffect so glass samples the blurred backdrop.
                actor.add_effect(this.chained_effect);
            }
        }
    });
