const GLib = imports.gi.GLib;
const Cogl = imports.gi.Cogl;

const UUID = "BlurCinnamon@klangman";

// In use for the effects, to prevent boilerplate code
function setup_params(outer_this, params) {
    // setup each parameter, either with the given or the default value
    for (const params_name in outer_this.constructor.default_params) {
        outer_this["_" + params_name] = null;
        outer_this[params_name] = params_name in params ?
            params[params_name] :
            outer_this.constructor.default_params[params_name];
    }
}

function get_shader_source(shader_filename) {
    let file_name = GLib.get_user_data_dir() + '/cinnamon/extensions/' + UUID + "/6.0/" + shader_filename;
    let [ok, content] = GLib.file_get_contents(file_name);
    return (new TextDecoder().decode(content));
}

// Muffin's ClutterOffscreenEffect sizes its texture from the actor's paint volume, but always
// sets the offscreen framebuffer's viewport to the size of the *stage*
// (clutter_offscreen_effect_pre_paint()). GL clips everything outside the viewport, so when
// the actor is about as wide (or tall) as the screen, e.g. a screen-wide window whose surface
// also holds a client-side shadow, the part of the texture past the stage size is never drawn
// and the right (or bottom) side of the effect disappears.
// Call this right after the parent pre_paint(): it widens the viewport around its centre by a
// whole number of pixels on each side and scales the projection's x and y down to match, so
// every actor pixel still lands on the same texture pixel, but the whole texture is covered.
let viewportErrorLogged = false;
function viewportExtension(start, size, fbSize) {
    // Pixels to add on each side so that [start - e, start + size + e] covers [0, fbSize]
    return Math.max(0, Math.ceil(start), Math.ceil(fbSize - (start + size)));
}
function extendOffscreenViewport(paintContext) {
    try {
        let fb = paintContext.get_framebuffer();
        let [vx, vy, vw, vh] = fb.get_viewport4fv();
        if (!(vw > 0 && vh > 0))
            return;
        let ex = viewportExtension(vx, vw, fb.get_width());
        let ey = viewportExtension(vy, vh, fb.get_height());
        if (ex === 0 && ey === 0)
            return;
        let newWidth = vw + 2 * ex, newHeight = vh + 2 * ey;
        // projection' = scale(vw / newWidth, vh / newHeight) * projection (scales NDC x/y)
        let projection = fb.get_projection_matrix();
        let scale = projection.copy();
        scale.init_identity();
        scale.scale(vw / newWidth, vh / newHeight, 1);
        let result = projection.copy();
        result.multiply(scale, projection);
        fb.set_projection_matrix(result);
        fb.set_viewport(vx - ex, vy - ey, newWidth, newHeight);
    } catch (e) {
        if (!viewportErrorLogged) {
            viewportErrorLogged = true;
            logError(e, "BlurCinnamon: couldn't extend the offscreen viewport");
        }
    }
}
