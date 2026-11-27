// GLSL port of liquidass 0.1.1b (Tweak.mm kShaderSrc) from Liquid (Gl)ass by
// winaviation (https://github.com/winaviation-tweaks/liquid-ass), adapted from
// Blur my Shell (https://github.com/aunetx/blur-my-shell) for BlurCinnamon's
// Clutter/Cogl pipeline.
//
// The copyright holder explicitly granted, in email and in pull request #987
// (2026-09-10), that this ported shader file may be re-licensed and
// redistributed under the GNU GPL v3 for Blur my Shell, with the same rights
// extending to anyone who reuses it from this repository. The original
// upstream project remains licensed under CC BY-NC 4.0
// (https://creativecommons.org/licenses/by-nc/4.0/).
//
// Specular glare, fresnel glare with symmetric tapering edge pair, dark edge
// border and colored edge glow are from Blur my Shell's refraction shader.
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float strength;
uniform float edge_size;
uniform float falloff;
uniform float refraction_style;
uniform float corner_radius;
uniform int corners_top;
uniform int corners_bottom;
uniform float rim_width;
uniform float reach;
uniform float rgb_fringing;
uniform float gloss;
uniform float fresnel_cos;
uniform float fresnel_sin;
uniform float fresnel_width;
uniform int fresnel_two_sided;
uniform float specular_strength;
uniform float edge_shadow;
uniform float edge_glow;
uniform float tint;
uniform float tint_r;
uniform float tint_g;
uniform float tint_b;
uniform float tint_a;
uniform float backdrop_zoom;
uniform float shadow;
uniform float opacity_factor;
uniform int texture_repeat;
uniform float clip_x0;
uniform float clip_y0;
uniform float clip_width;
uniform float clip_height;
uniform float mask_x0;
uniform float mask_y0;
uniform float mask_width;
uniform float mask_height;
uniform float scale_factor;

// Overall bend multiplier and edge-profile curve (< 1 reaches further inward).
const float BEND_SCALE = 1.4;
const float BEND_CURVE = 0.7;
// Max share of the bend used to split red and blue apart at the glass edge.
const float DISPERSION_RATIO = 0.9;
// Glare taper along the rim, in multiples of the corner radius: how early it
// starts thinning before the corner curve and how far its thin tail reaches
// down the side edge past the curve.
const float GLARE_TAPER_LEAD = 0.6;
const float GLARE_TAPER_TAIL = 1.0;
// Strength of the specular glare on the edge away from the light.
const float SPECULAR_FAR_SIDE = 0.6;
// Edge border fade-in around the end of the glare tail, in logical pixels
// (multiplied by the monitor scale): how far before the tail end it starts
// and how far past it it reaches full strength.
const float BORDER_FADE_LEAD = 45.0;
const float BORDER_FADE_TAIL = 8.0;

float quartzGlassEdgeProfile(float distanceFromEdge,
                             float refractionHeight) {
    float t = clamp(distanceFromEdge / max(refractionHeight, 0.001), 0.0, 1.0);
    return 1.0 - sqrt(t * (2.0 - t));
}

// 0.1.0b Snell-style displacement profile
float surfaceConvexSquircle(float x) {
    return pow(1.0 - pow(1.0 - x, 4.0), 0.25);
}

vec2 snellRefractRay(vec2 normal, float eta) {
    float cosI = -normal.y;
    float k = 1.0 - eta * eta * (1.0 - cosI * cosI);
    if (k < 0.0)
        return vec2(0.0);
    float sq = sqrt(k);
    return vec2(-(eta * cosI + sq) * normal.x,
                eta - (eta * cosI + sq) * normal.y);
}

float snellRawRefraction(float br, float gt, float bw, float eta) {
    float x = clamp(br, 0.05, 0.95);
    float y = surfaceConvexSquircle(x);
    float y2 = surfaceConvexSquircle(x + 0.001);
    float d = (y2 - y) / 0.001;
    float m = sqrt(d * d + 1.0);
    vec2 n = vec2(-d / m, -1.0 / m);
    vec2 r = snellRefractRay(n, eta);
    if (length(r) < 0.0001 || abs(r.y) < 0.0001)
        return 0.0;
    return r.x * (y * bw + gt) / r.y;
}

float snellDisplacementAtRatio(float br, float gt, float bw, float eta) {
    float peak = snellRawRefraction(0.05, gt, bw, eta);
    if (abs(peak) < 0.0001)
        return 0.0;
    float raw = snellRawRefraction(br, gt, bw, eta);
    return (raw / peak) * (1.0 - smoothstep(0.0, 1.0, br));
}

// Anti-aliased line hugging the glass edge; widthScale thins it (0 hides it).
float quartzGlassRing(float distanceFromEdge,
                      float bezelWidth,
                      float widthScale) {
    float ringWidth = clamp(bezelWidth * 0.24 * fresnel_width, 1.0,
                            2.5 * fresnel_width) * widthScale;
    if (ringWidth <= 0.001)
        return 0.0;
    float aa = 1.0;

    float outerCoverage = clamp(distanceFromEdge / aa + 0.5, 0.0, 1.0);
    float innerCoverage = clamp((ringWidth - distanceFromEdge) / aa + 0.5, 0.0, 1.0);
    float radial = clamp(distanceFromEdge / ringWidth, 0.0, 1.0);
    return outerCoverage * innerCoverage * (1.0 - radial);
}

float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

// Muffin pads offscreen FBOs by 2 px before the actor origin and 1 px after
// the far edge (width = actor_w + 3, height = actor_h + 3). Clamp inside the
// valid texel centres so refraction never samples the transparent FBO gutter.
vec2 resolveUV(vec2 uv, vec2 minUV, vec2 maxUV) {
    if (texture_repeat == 1) {
        vec2 mirrored = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
        return clamp(mirrored, minUV, maxUV);
    }

    return clamp(uv, minUV, maxUV);
}

// The glass is blurred by its chained Dual Kawase effect; un-premultiply so
// blending, highlights and final premultiplication stay exact on partial alpha.
vec4 sampleGlassBackdrop(vec2 uv, vec2 minUV, vec2 maxUV) {
    vec4 sampleColor = texture2D(tex, resolveUV(uv, minUV, maxUV));
    return vec4(sampleColor.a > 0.0001 ? sampleColor.rgb / sampleColor.a : vec3(0.0), sampleColor.a);
}

float roundedBoxDistance(vec2 p, vec2 halfSize, float radius) {
    radius = min(radius, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + vec2(radius);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float edgeCoverage(float signedDistance) {
#if defined(GL_ES) && __VERSION__ < 300
    float antialiasWidth = 1.0;
#else
    float antialiasWidth = max(fwidth(signedDistance), 0.0001);
#endif
    return 1.0 - smoothstep(
        -antialiasWidth * 0.5,
        antialiasWidth * 0.5,
        signedDistance
    );
}

struct EdgeInfo {
    float distance;
    float alpha;
    vec2 dir;
};

EdgeInfo estimateAnalyticEdge(vec2 px, vec2 halfSize, float radius) {
    vec2 p = px - halfSize;
    vec2 core = max(halfSize - vec2(radius), vec2(0.0));
    float signedDistance = roundedBoxDistance(p, halfSize, radius);

    EdgeInfo info;
    info.distance = max(0.0, -signedDistance);

    vec2 nearestCore = clamp(p, -core, core);
    vec2 normalDelta = p - nearestCore;

    float normalLength = length(normalDelta);

    if (normalLength > 0.001) {
        info.dir = normalDelta / normalLength;
    } else {
        vec2 lensPx = px;
        float dL = lensPx.x;
        float dR = halfSize.x * 2.0 - lensPx.x;
        float dT = lensPx.y;
        float dB = halfSize.y * 2.0 - lensPx.y;
        float dm = min(min(dL, dR), min(dT, dB));

        info.dir = vec2(
            (dL < dR && dL == dm) ? -1.0 : (dR <= dL && dR == dm) ? 1.0 : 0.0,
            (dT < dB && dT == dm) ? -1.0 : (dB <= dT && dB == dm) ? 1.0 : 0.0
        );
    }

    info.alpha = edgeCoverage(signedDistance);
    return info;
}

// Outward direction near sharp corners, blended between the two closest sides
// over band so it turns smoothly where they meet.
vec2 sharpCornerDir(vec2 glassPx, vec2 glassSize, float band) {
    vec2 sideDistances = min(glassPx, glassSize - glassPx);
    vec2 sideWeights = vec2(1.0) - smoothstep(vec2(0.0), vec2(band), sideDistances);
    vec2 sideNormal = sign(glassPx - glassSize * 0.5) * sideWeights;
    return sideNormal / max(length(sideNormal), 0.0001);
}

// Inward distance (x) and outward direction (yz) of a band reaching past the
// corner radius. Both follow rays from the corners of the box shrunk by band
// out to its rounded edge, so they turn smoothly around the corners where the
// plain edge distance creases along the diagonals. Deep inside the shrunk box
// they fall back to the plain edge distance and direction.
vec3 bandEdge(vec2 glassPx, vec2 halfSize, float radius, float band,
              float fallbackDistance, vec2 fallbackDir) {
    vec2 p = glassPx - halfSize;
    vec2 core = max(halfSize - vec2(band), vec2(0.0));
    vec2 delta = max(abs(p) - core, vec2(0.0));
    float r = length(delta);
    if (r < 0.001)
        return vec3(fallbackDistance, fallbackDir);

    vec2 ray = delta / r;
    vec2 sideHits = (halfSize - core) / max(ray, vec2(0.0001));
    float edgeHit = min(sideHits.x, sideHits.y);
    vec2 arcCenter = halfSize - vec2(radius);
    vec2 hit = core + ray * edgeHit;
    if (hit.x > arcCenter.x && hit.y > arcCenter.y) {
        vec2 fromArc = core - arcCenter;
        float b = dot(fromArc, ray);
        edgeHit = -b + sqrt(max(b * b - dot(fromArc, fromArc) + radius * radius, 0.0));
    }
    return vec3(max(edgeHit - r, 0.0), sign(p) * ray);
}

vec2 backdropSampleUV(vec2 sampleUV, vec2 displacementPx, vec2 invActorSize,
                      vec2 zoomCentre, float invZoom, bool hasZoom) {
    vec2 displaced = sampleUV + displacementPx * invActorSize;
    if (hasZoom)
        displaced = zoomCentre + (displaced - zoomCentre) * invZoom;
    return displaced;
}

vec4 sampleDispersed(vec2 sampleUV, vec2 dispPx, vec2 aberrationPx,
                     float dispersion, vec2 invActorSize, vec2 zoomCentre,
                     float invZoom, bool hasZoom, vec2 minUV, vec2 maxUV) {
    vec2 greenUV = backdropSampleUV(sampleUV, dispPx, invActorSize, zoomCentre,
                                    invZoom, hasZoom);
    vec4 greenSample = sampleGlassBackdrop(greenUV, minUV, maxUV);

    vec4 fallback = greenSample;
    if (greenSample.a < 0.01) {
        fallback = sampleGlassBackdrop(sampleUV, minUV, maxUV);
        if (fallback.a < 0.01)
            return vec4(0.0);
        greenSample = fallback;
    }

    vec4 bg = greenSample;
    // Skip the 6 extra chromatic taps when dispersion is negligible (< 0.1 px).
    if (dispersion > 0.001 && dot(aberrationPx, aberrationPx) > 0.01) {
        // Reuse greenSample for the i=0 (weight=0) tap of the second loop.
        vec3 accumulated = vec3(0.0, greenSample.g, 0.0);
        float accumulatedAlpha = greenSample.a;

        for (int i = 0; i < 3; i++) {
            float weight = 1.0 - float(i) / 3.0;
            vec2 uv = backdropSampleUV(sampleUV, dispPx + aberrationPx * weight,
                                       invActorSize, zoomCentre, invZoom, hasZoom);
            vec4 sample = sampleGlassBackdrop(uv, minUV, maxUV);
            if (sample.a < 0.01)
                sample = fallback;
            accumulated.r += sample.r * weight;
            accumulated.g += sample.g * (1.0 - weight);
            accumulatedAlpha += sample.a;
        }

        for (int i = 1; i < 4; i++) {
            float weight = float(i) / 3.0;
            vec2 uv = backdropSampleUV(sampleUV, dispPx - aberrationPx * weight,
                                       invActorSize, zoomCentre, invZoom, hasZoom);
            vec4 sample = sampleGlassBackdrop(uv, minUV, maxUV);
            if (sample.a < 0.01)
                sample = fallback;
            accumulated.g += sample.g * (1.0 - weight);
            accumulated.b += sample.b * weight;
            accumulatedAlpha += sample.a;
        }

        bg.rgb = accumulated * vec3(0.5, 1.0 / 3.0, 0.5);
        bg.a = accumulatedAlpha / 7.0;
    }
    return bg;
}

// Light from colorful content under the glass, gathered a few steps inward
// from the edge. Returns a saturated color and, in alpha, how colorful it is,
// so neutral (white/gray/black) content does not light the rim.
vec4 edgeGlowColor(vec2 sampleUV, vec2 dir, float band, vec2 invActorSize,
                   vec2 zoomCentre, float invZoom, bool hasZoom,
                   vec2 minUV, vec2 maxUV) {
    vec3 gathered = vec3(0.0);
    for (int i = 1; i <= 3; i++) {
        vec2 inwardPx = -dir * band * float(i) * 0.6;
        vec2 uv = backdropSampleUV(sampleUV, inwardPx, invActorSize, zoomCentre,
                                   invZoom, hasZoom);
        gathered += sampleGlassBackdrop(uv, minUV, maxUV).rgb;
    }
    gathered /= 3.0;

    float maxC = max(gathered.r, max(gathered.g, gathered.b));
    float minC = min(gathered.r, min(gathered.g, gathered.b));
    float chroma = maxC - minC;
    vec3 vivid = chroma > 0.001
        ? (gathered - vec3(minC)) / chroma * maxC
        : gathered;
    return vec4(vivid, smoothstep(0.06, 0.4, chroma));
}

vec3 applyTintAndShadow(vec3 sample, vec2 localUV) {
    vec3 tintColor = vec3(tint_r, tint_g, tint_b);
    vec3 outRGB = mix(sample, tintColor, tint * tint_a);

    outRGB *= 1.0 - smoothstep(0.25, 1.0, localUV.y) * shadow * 0.20;

    return clamp(outRGB, 0.0, 1.0);
}

void blurcinnamon_main() {
    if (clip_width == 0.0 || clip_height == 0.0 || mask_width == 0.0 || mask_height == 0.0) {
        cogl_color_out = vec4(0.0);
        return;
    }

    vec2 actorSize = vec2(width, height);
    vec2 actorUV = cogl_tex_coord_in[0].xy;

    vec2 actorPx = actorUV * actorSize;
    vec4 bounds = clip_width < 0.0 || clip_height < 0.0
        ? vec4(2.0, 2.0, max(3.0, width - 1.0), max(3.0, height - 1.0))
        : vec4(clip_x0, clip_y0, clip_x0 + clip_width, clip_y0 + clip_height);

    // During resize stabilization, bounds holds the union of old/new rects while
    // mask_* holds the instantaneous visible rect so shrinking surfaces clip cleanly
    // without an extra outer CornerEffect offscreen pass. Defer the early return until
    // after all fwidth()-based edgeCoverage() calls so 2x2 quad derivatives remain in
    // uniform control flow on all GPUs.
    float maskOpacity = 1.0;
    if (mask_width > 0.0 && mask_height > 0.0) {
        vec2 maskSize = vec2(mask_width, mask_height);
        vec2 maskPx = actorPx - vec2(mask_x0, mask_y0);
        vec2 maskHalf = maskSize * 0.5;
        float maskR = clamp(corner_radius, 0.0, min(maskSize.x, maskSize.y) * 0.5);
        if ((maskPx.y < maskHalf.y && corners_top == 0)
            || (maskPx.y >= maskHalf.y && corners_bottom == 0))
            maskR = 0.0;
        maskOpacity = edgeCoverage(roundedBoxDistance(maskPx - maskHalf, maskHalf, maskR));
    }

    vec2 glassSize = max(bounds.zw - bounds.xy, vec2(1.0));
    vec2 glassPx = actorPx - bounds.xy;
    vec2 halfSize = glassSize * 0.5;
    vec2 localUV = glassPx / glassSize;

    float W = glassSize.x;
    float H = glassSize.y;
    float shortestSide = min(W, H);
    float R = clamp(corner_radius, 0.0, shortestSide * 0.5);
    float roundingRadius = R;
    if ((glassPx.y < H * 0.5 && corners_top == 0)
        || (glassPx.y >= H * 0.5 && corners_bottom == 0))
        roundingRadius = 0.0;
    float bezel = max(1.0, min(edge_size, shortestSide * 0.5));
    float glassThickness = max(0.5, edge_size * 0.55 * falloff);

    bool nearlySquare = abs(W - H) < max(4.0, shortestSide * 0.035);
    bool useCircularSurface = corners_top != 0 && corners_bottom != 0
        && nearlySquare && R >= shortestSide * 0.5 - 0.5;

    float distFromSide;
    float edgeOpacity;
    float refractionBand = bezel;
    vec2 dir;

    if (useCircularSurface) {
        float circleRadius = shortestSide * 0.5;
        vec2 fromCenter = glassPx - halfSize;
        float circleDistance = length(fromCenter);
        edgeOpacity = edgeCoverage(circleDistance - circleRadius) * maskOpacity;
        if (edgeOpacity <= 0.0) {
            cogl_color_out = vec4(0.0);
            return;
        }

        distFromSide = max(0.0, circleRadius - circleDistance);
        dir = circleDistance > 0.001 ? normalize(fromCenter) : vec2(0.0, -1.0);
        refractionBand = max(1.0, bezel * 0.35);
    } else {
        EdgeInfo edge = estimateAnalyticEdge(glassPx, halfSize, roundingRadius);
        edgeOpacity = edge.alpha * maskOpacity;
        if (edgeOpacity <= 0.0) {
            cogl_color_out = vec4(0.0);
            return;
        }

        distFromSide = edge.distance;
        dir = edge.dir;

        float rimRadius = max(1.0, bezel * 0.35 * max(1.0, rim_width));
        rimRadius = min(rimRadius, shortestSide * 0.5);
        if (R > 0.0 && (corners_top != 0 || corners_bottom != 0))
            rimRadius = min(rimRadius, max(1.0, R));
        refractionBand = rimRadius;
        if (roundingRadius == 0.0 && distFromSide < refractionBand)
            dir = sharpCornerDir(glassPx, glassSize, refractionBand);
    }

    // Precompute UV clamp and zoom parameters once per fragment for all backdrop taps.
    vec2 invActorSize = 1.0 / actorSize;
    vec2 minUV = vec2(2.5) * invActorSize;
    vec2 maxUV = max(minUV, vec2(1.0) - vec2(1.5) * invActorSize);
    float invZoom = 1.0 / max(backdrop_zoom, 0.01);
    bool hasZoom = abs(backdrop_zoom - 1.0) > 0.001;
    vec2 zoomCentre = (bounds.xy + bounds.zw) * 0.5 * invActorSize;

    // The reach widens the bend past the rim band, which the corner radius
    // caps on rounded glass. The bend keeps its shape and deepens with its
    // width, like a wider bezel, while the rim lighting stays on the rim band.
    float lensBand = max(refractionBand, min(reach, shortestSide * 0.5));
    float lensThickness = glassThickness * lensBand / refractionBand;
    float lensDist = distFromSide;
    vec2 lensDir = dir;
    if (!useCircularSurface && lensBand > refractionBand && distFromSide < lensBand) {
        if (roundingRadius == 0.0) {
            lensDir = sharpCornerDir(glassPx, glassSize, lensBand);
        } else {
            vec3 lensEdge = bandEdge(glassPx, halfSize, roundingRadius,
                                     max(roundingRadius, lensBand),
                                     distFromSide, dir);
            lensDist = lensEdge.x;
            lensDir = lensEdge.yz;
        }
    }
    float edgeBand = clamp(1.0 - (lensDist / lensBand), 0.0, 1.0);

    float scale = max(scale_factor, 1.0);
    float ringWidthBase = clamp(refractionBand * 0.24 * fresnel_width, 1.0,
                                2.5 * fresnel_width);
    float bloomWidth = max(1.5, refractionBand * 0.25);
    // Cover specular bloom until it falls below ~0.4/255 (4*bloomWidth <= refractionBand
    // for normal radii >= 6, while protecting small radii where bloomWidth is clamped to 1.5).
    float specBloomReach = specular_strength > 0.21
        ? bloomWidth * 5.5
        : (specular_strength > 0.001 ? bloomWidth * 4.0 : 0.0);
    float rimActiveSpan = max(max(lensBand, max(ringWidthBase + 0.5, specBloomReach)),
                              3.0 * scale);
    if (distFromSide >= rimActiveSpan) {
        vec2 flatUV = hasZoom
            ? zoomCentre + (actorUV - zoomCentre) * invZoom
            : actorUV;
        vec4 flatSample = sampleGlassBackdrop(flatUV, minUV, maxUV);
        vec3 effectRGB = applyTintAndShadow(flatSample.rgb, localUV);
        vec3 outRGB;
        float finalOpacity;
        if (opacity_factor < 0.999) {
            vec4 sourceSample = hasZoom
                ? sampleGlassBackdrop(actorUV, minUV, maxUV)
                : flatSample;
            finalOpacity = edgeOpacity * mix(sourceSample.a, flatSample.a,
                                             opacity_factor);
            outRGB = mix(sourceSample.rgb, effectRGB, opacity_factor);
        } else {
            finalOpacity = edgeOpacity * flatSample.a;
            outRGB = effectRGB;
        }

        cogl_color_out = vec4(outRGB * finalOpacity, finalOpacity);
        return;
    }

    float normDisp = lensDist < lensBand
        ? pow(max(quartzGlassEdgeProfile(lensDist,
                                         max(lensThickness, 1.0)), 0.0),
              BEND_CURVE)
        : 0.0;
    if (refraction_style > 0.001) {
        float bezelRatio = clamp(lensDist / max(lensBand, 0.001), 0.0, 1.0);
        float eta = 1.0 / 1.5;
        float snellDisp = (lensDist < lensBand)
            ? snellDisplacementAtRatio(bezelRatio, max(1.0, lensThickness),
                                       max(1.0, lensBand), eta)
            : 0.0;
        normDisp = mix(normDisp, snellDisp, clamp(refraction_style, 0.0, 1.0));
    }
    float dispStrength = edgeBand;
    vec2 dispPx = -lensDir * normDisp * lensBand * strength * dispStrength *
                  BEND_SCALE;

    // Dispersion follows the bend and is weighted toward the rim, so colors
    // spread out along the glass edge while the center stays clean.
    float dispersion = clamp(rgb_fringing, 0.0, 1.0) * DISPERSION_RATIO;
    vec2 aberrationPx = dispPx * clamp(normDisp, 0.0, 1.0) * dispersion;
    vec4 bgColor = sampleDispersed(actorUV, dispPx, aberrationPx, dispersion,
                                   invActorSize, zoomCentre, invZoom, hasZoom,
                                   minUV, maxUV);

    vec3 outRGB = mix(bgColor.rgb, vec3(tint_r, tint_g, tint_b),
                      tint * tint_a);

    float edgeShadowReach = edge_shadow > 0.001
        ? clamp(refractionBand * 0.02, 0.5 * scale, 1.0 * scale) + 0.5
        : 0.0;
    float specActiveReach = specular_strength > 0.001
        ? max(ringWidthBase + 0.5, specBloomReach)
        : 0.0;
    float glareMaxReach = max(edgeShadowReach,
                              max(gloss > 0.001 ? ringWidthBase + 0.5 : 0.0,
                                  specActiveReach));

    bool needGlare = distFromSide < glareMaxReach;
    float glareAxisDot = 0.0;
    float glareTaper = 0.0;
    if (needGlare) {
        // Facing of the edge relative to the fresnel glare axis: 1 on the lit
        // edge pair, 0 on the perpendicular (side) edges.
        vec2 glareAxis = vec2(fresnel_cos, fresnel_sin);
        glareAxisDot = dot(glareAxis, dir);
        float glareFacing = abs(glareAxisDot);

        // Rim position measured from where the corner curve starts on the glare
        // edge (axis snapped to vertical/horizontal): < 0 on the straight glare
        // edge, 0..R*PI/2 along the curve, beyond that down the side edge.
        bool glareVertical = abs(glareAxis.y) >= abs(glareAxis.x);
        vec2 rimP = abs(glassPx - halfSize);
        vec2 straightHalf = max(halfSize - vec2(roundingRadius), vec2(0.0));
        vec2 litP = glareVertical ? rimP : rimP.yx;
        vec2 litStraight = glareVertical ? straightHalf : straightHalf.yx;
        vec2 litDir = glareVertical ? abs(dir) : abs(dir).yx;
        float rimPos = roundingRadius * atan(litDir.x, max(litDir.y, 0.0001)) +
                       min(litP.x - litStraight.x, 0.0) +
                       max(litStraight.y - litP.y, 0.0);

        float taperR = max(roundingRadius, 4.0);
        float glareLead = min(GLARE_TAPER_LEAD * taperR, litStraight.x);
        float glareTail = min(GLARE_TAPER_TAIL * taperR, litStraight.y);
        glareTaper = 1.0 - smoothstep(-glareLead,
                                      roundingRadius * 1.5707963 + glareTail +
                                      0.001,
                                      rimPos);
        // Diagonal glare angles fall back to the plain facing taper.
        float offAxis = clamp((1.0 - max(abs(glareAxis.x), abs(glareAxis.y))) /
                              0.2928932, 0.0, 1.0);
        glareTaper = mix(glareTaper, glareFacing, offAxis);

        if (fresnel_two_sided == 0) {
            float oneSidedMask = 1.0 - smoothstep(-0.2, 0.1, glareAxisDot);
            glareTaper *= oneSidedMask;
        }

        // Thin dark border on the straight side edges (the pair perpendicular to
        // the glare axis). It starts after the glare tail ends and thins in
        // gradually, so the glare keeps its tapering through the corners.
        if (distFromSide < edgeShadowReach) {
            float borderTaper = step(0.5, litDir.x) *
                                smoothstep(glareTail - BORDER_FADE_LEAD * scale,
                                           glareTail + BORDER_FADE_TAIL * scale,
                                           litStraight.y - litP.y);
            float lineWidth = clamp(refractionBand * 0.02, 0.5 * scale,
                                    1.0 * scale) * borderTaper;
            float line = 1.0 - smoothstep(lineWidth - 0.5, lineWidth + 0.5,
                                          distFromSide);

            float darken = edge_shadow * line * borderTaper *
                           mix(0.5, 1.0, luminance(outRGB));
            outRGB *= 1.0 - darken;
        }
    }

    // Colorful content under the glass lights up the rim. Pixels past the
    // glow width get no glow, so they skip the extra backdrop samples.
    float glowWidth = max(1.5, refractionBand * 0.6);
    if (edge_glow > 0.001 && distFromSide < glowWidth) {
        float glowBand = 1.0 - smoothstep(0.0, glowWidth, distFromSide);
        vec4 glow = edgeGlowColor(actorUV, dir, refractionBand, invActorSize,
                                  zoomCentre, invZoom, hasZoom, minUV, maxUV);
        float glowAmount = glowBand * glowBand * glow.a * edge_glow * 0.85;
        outRGB = mix(outRGB, clamp(glow.rgb * 1.15, 0.0, 1.0), glowAmount);
    }

    // Compute the anti-aliased glare ring once and share it between the
    // backdrop-modulated Fresnel highlight and the white specular reflection.
    float ringCore = 0.0;
    if (needGlare && (gloss > 0.001 || specular_strength > 0.001)
        && distFromSide < ringWidthBase + 0.5 && glareTaper > 0.0) {
        ringCore = quartzGlassRing(distFromSide, refractionBand, glareTaper) *
                   sqrt(glareTaper);
    }

    if (gloss > 0.001 && ringCore > 0.0) {
        float highlight = ringCore / max(1.0 + (1.0 - ringCore) * 1.35, 0.0001) *
                          gloss * edgeOpacity;
        float bgLuminance = luminance(outRGB);
        highlight *= mix(0.32, 1.0, bgLuminance);
        highlight = min(highlight, 0.35);
        outRGB = 1.0 - (1.0 - outRGB) * (1.0 - highlight);
    }

    outRGB *= 1.0 - smoothstep(0.25, 1.0, localUV.y) * shadow * 0.20;

    // Specular glare: reflection of the light source on the same edge pair as
    // the fresnel glare. The edge facing the light is full strength, the far
    // edge (internal reflection) is dimmer. It shares the fresnel taper; the
    // soft bloom fades sooner so the tail is a crisp thin line. Reflected
    // light is white and does not depend on the backdrop brightness, so it is
    // added after the inner shadow.
    if (needGlare && specular_strength > 0.001) {
        float side = glareAxisDot < 0.0 ? 1.0 : SPECULAR_FAR_SIDE;
        float bloom = exp(-distFromSide / bloomWidth) * 0.35 *
                      glareTaper * glareTaper;
        float specular = (ringCore + bloom) * side * edgeOpacity *
                         specular_strength;
        specular = clamp(specular, 0.0, 0.85);
        outRGB = 1.0 - (1.0 - clamp(outRGB, 0.0, 1.0)) * (1.0 - specular);
    }

    float finalOpacity;
    if (opacity_factor < 0.999) {
        vec4 sourceColor = sampleGlassBackdrop(actorUV, minUV, maxUV);
        outRGB = mix(sourceColor.rgb, outRGB, opacity_factor);
        finalOpacity = edgeOpacity * mix(sourceColor.a, bgColor.a,
                                         opacity_factor);
    } else {
        finalOpacity = edgeOpacity * bgColor.a;
    }
    cogl_color_out = vec4(clamp(outRGB, 0.0, 1.0) * finalOpacity, finalOpacity);
}

// Apply the actor's paint opacity. ClutterOffscreenEffect passes the actor's paint opacity to the final
// on-screen pass only as the (premultiplied) pipeline colour, cogl_color_in. Inner passes in an effect chain
// are rendered with the opacity forced to 255 (cogl_color_in == 1), so multiplying in every shader applies
// the opacity exactly once. Without this, actor.opacity has no effect on any actor using these effects.
void main() {
    blurcinnamon_main();
    cogl_color_out *= cogl_color_in;
    // Break up the banding of 8-bit output, see effect_base.js
    cogl_color_out = blurcinnamon_dither(cogl_color_out);
}
