// Prepended only to the real-resolution passes. The existing kernels supply tex,
// offset, width and height. Bounds are texel centres of the captured content.
#define BLURCINNAMON_PYRAMID
uniform float first_x;
uniform float first_y;
uniform float last_x;
uniform float last_y;
uniform float grid_x;
uniform float grid_y;

uniform float phase_x;
uniform float phase_y;

// Fill the rounded target completely. Keep the sample phase anchored at its
// origin when a 2:1 reduction rounds up to the next whole output texel.
vec2 pyramid_uv(vec2 uv, vec2 size) {
    vec2 first = vec2(first_x, first_y);
    return ((uv * size - first) * vec2(phase_x, phase_y) + first) / size;
}

vec4 pyramid_sample(sampler2D image, vec2 uv, vec2 size) {
    vec2 pixel = clamp(uv * size - 0.5, vec2(first_x, first_y), vec2(last_x, last_y));
#ifdef KAWASE_MANUAL_LINEAR
    vec2 f = fract(pixel);
    vec2 p = (floor(pixel) + 0.5) / size;
    vec2 d = 1.0 / size;
    return mix(mix(texture2D(image, p), texture2D(image, p + vec2(d.x, 0.0)), f.x),
               mix(texture2D(image, p + vec2(0.0, d.y)), texture2D(image, p + d), f.x), f.y);
#else
    return texture2D(image, (pixel + 0.5) / size);
#endif
}

vec4 pyramid_output(vec4 color, vec2 uv, vec2 size) {
    vec2 pixel = (uv * size - vec2(first_x, first_y)) * vec2(phase_x, phase_y) * vec2(grid_x, grid_y);
    // At fractional scales some fragment centres map to integer texels.
    // Keep those centres on the same side of floor() after an odd resize.
    color = blurcinnamon_dither_at(color * cogl_color_in, pixel + 0.0005);
#ifdef KAWASE_STORE_ALPHA
    // EffectBase converts RGB to straight colour. Over clear black (an enclosing
    // offscreen FBO) the private Cinnamon blend stores a*a; sqrt(a) restores a.
    color.a = sqrt(color.a);
#endif
    return color;
}

#define texture2D(image, uv) pyramid_sample(image, (uv), vec2(width, height))
#define sampleBoundary(uv, delta, stepSize) texture2D(tex, (uv) + (delta) * (stepSize))
