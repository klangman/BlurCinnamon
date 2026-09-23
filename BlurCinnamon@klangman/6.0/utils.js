const GLib = imports.gi.GLib;

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