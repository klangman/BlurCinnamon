// Base class for the extension's shader effects.
//
// On Cinnamon 6.2+ the effects are built on Cinnamon.GLSLEffect, which runs each .glsl file as a Cogl
// snippet. Clutter.ShaderEffect with set_shader_source() leaks: Muffin builds it on Cogl's deprecated
// CoglShader/CoglProgram code, where the shader keeps a reference to the pipeline it was compiled for
// (cogl/cogl/deprecated/cogl-shader.c), and that pipeline owns the program that owns the shader. So no
// such effect, nor its full-size offscreen texture, is ever freed. Upstream Mutter made the same move
// (ClutterShaderEffect was ported to CoglSnippet in Mutter 51).
//
// On Cinnamon 6.0, which has no GLSLEffect, the effects fall back to Clutter.ShaderEffect as before.
//
// An effect class extends EffectBase and implements get_effect_source(), returning its GLSL source.
// It must not depend on instance state: with GLSLEffect it is called once per class, from inside the
// first constructor. Everything else (set_uniform_value(), vfunc_paint_target()) works as with
// Clutter.ShaderEffect.

const GObject  = imports.gi.GObject;
const Cinnamon = imports.gi.Cinnamon;
const Clutter  = imports.gi.Clutter;

var USE_GLSL_EFFECT = (Cinnamon.GLSLEffect !== undefined);

// Turns a complete fragment shader into snippet declarations. GLSLEffect only sets float uniforms,
// so int and bool uniforms are declared as floats and #defined back to their original type.
// Handles the plain one-per-line `uniform int name;` / `uniform bool name;` declarations the
// extension's shaders use (no precision qualifiers or comma-separated lists).
function toSnippet(source) {
    let renamed = new Set();
    let declarations = source.replace(/\buniform\s+(int|bool)\s+(\w+)\s*;/g, (_m, type, name) => {
        renamed.add(name);
        let value = (type === 'int') ? `int(floor(_u_${name} + 0.5))` : `(_u_${name} > 0.5)`;
        return `uniform float _u_${name};\n#define ${name} ${value}\n`;
    }).replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void effect_base_main()');

    return { declarations, renamed };
}

// The shaders write premultiplied colour like any Clutter paint, but GLSLEffect blends with
// RGBA = SRC_COLOR * SRC_A + DST_COLOR * (1 - SRC_A), so un-premultiply on the way out.
// That is exact for the colour channels. The blend also gives a stored alpha of a*a instead of a,
// which only shows where an inner pass of an effect chain outputs partial alpha (antialiased edges).
const SNIPPET_CODE = 'effect_base_main();\n' +
                     'cogl_color_out.rgb /= max(cogl_color_out.a, 0.0001);\n';

const GlslEffectBase = USE_GLSL_EFFECT ? GObject.registerClass({
    GTypeName: `BlurCinnamonGlslEffectBase_${Math.floor(Math.random() * 100000) + 1}`,
}, class GlslEffectBase extends Cinnamon.GLSLEffect {
    // Called once per class (GLSLEffect keeps one base pipeline per class and copies it per instance)
    vfunc_build_pipeline() {
        let source = this.get_effect_source();
        if (!source) {
            // Like ShaderEffect without a source: the effect just paints its input unchanged
            this.constructor._effect_base_renamed = new Set();
            return;
        }
        let snippet = toSnippet(source);
        this.constructor._effect_base_renamed = snippet.renamed;
        this.add_glsl_snippet(Cinnamon.SnippetHook.FRAGMENT, snippet.declarations, SNIPPET_CODE, true);
    }

    // Uniforms are kept here and applied at paint time, like ShaderEffect does, because property setters
    // run during construction, before GLSLEffect has created this instance's pipeline.
    set_uniform_value(name, value) {
        if (!this._effect_base_uniforms)
            this._effect_base_uniforms = new Map();
        this._effect_base_uniforms.set(name, Number(value));
    }

    vfunc_paint_target(...params) {
        let renamed = this.constructor._effect_base_renamed;
        if (this._effect_base_uniforms && renamed) {
            for (let [name, value] of this._effect_base_uniforms) {
                let location = this.get_uniform_location(renamed.has(name) ? `_u_${name}` : name);
                this.set_uniform_float(location, 1, [value]);
            }
        }
        super.vfunc_paint_target(...params);
    }
}) : null;

const ShaderEffectBase = USE_GLSL_EFFECT ? null : GObject.registerClass({
    GTypeName: `BlurCinnamonShaderEffectBase_${Math.floor(Math.random() * 100000) + 1}`,
}, class ShaderEffectBase extends Clutter.ShaderEffect {
    constructor(params) {
        super(params);
        let source = this.get_effect_source();
        if (source)
            this.set_shader_source(source);
    }
});

var EffectBase = USE_GLSL_EFFECT ? GlslEffectBase : ShaderEffectBase;
