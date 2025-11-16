#version 450

#define PI acos(-1)

#pragma input(int, name = hue, default = 0, min = -180, max = +180)
#pragma input(int, name = shift_px, default = 15, min = 0, max = 1920)
#pragma input(color, name = colors0, default = [0.1, 0.0, 0.0, 0.0])
#pragma input(color, name = colors1, default = [0.0, 0.1, 0.0, 0.0])
#pragma input(color, name = colors2, default = [0.0, 0.0, 0.1, 0.0])
#pragma input(color, name = colors3, default = [0.0, 0.0, 0.0, 0.1])
layout(set = 1, binding = 1) uniform CustomInput {
    int hue;
    int shift_px;
    vec4 colors0;
    vec4 colors1;
    vec4 colors2;
    vec4 colors3;
};

#pragma utility_block(ShaderInputs)
layout(set = 0, binding = 3) uniform ShaderInputs {
    float time; // shader playback time (in seconds)
    float time_delta; // elapsed time since last frame in secs
    float frame_rate; // number of frames per second estimates
    uint frame_index; // frame count
    vec4 mouse; // xy is last mouse down position,  abs(zw) is current mouse, sign(z) > 0.0 is mouse_down, sign(w) > 0.0 is click_down event
    vec4 date; // [year, month, day, seconds]
    vec3 resolution; // viewport resolution in pixels, [w, h, w/h]
    uint pass_index; // updated to reflect render pass
};

layout(location = 0) out vec4 out_color;

#pragma sampler(name="default_sampler", linear)
layout(set = 0, binding = 1) uniform sampler default_sampler;

#pragma input(image, name="input_image")
layout(set = 0, binding = 2) uniform texture2D input_image;

// Y ∈ [0, 1], U ∈ [−0.5, 0.5], V ∈ [−0.5, 0.5]
// RGB -> YUV matrix (rows converted to column-major for GLSL)
const mat4 r2y = mat4(
    0.213, -0.115,  0.500, 0.0,   // column 0 (r0,r1,r2,r3)
    0.715, -0.385, -0.454, 0.0,   // column 1
    0.072,  0.500, -0.046, 0.0,   // column 2
    0.0,    0.0,    0.0,   0.0    // column 3
);
// YUV -> RGB matrix (rows -> columns)
const mat4 y2r = mat4(
    1.000,  1.000,  1.000, 0.0,   // column 0
    0.000, -0.187,  1.856, 0.0,   // column 1
    1.575, -0.468,  0.000, 0.0,   // column 2
    0.0,    0.0,    0.0,   0.0
);

// HueRad: -PI to +PI (default 0.0), radius: 0 to 1 (default: 1)
vec4 change_hue(vec4 c0, float HueRad, float radius)
{
	mat2 HueMatrix = mat2(
        +cos(HueRad) * radius, sin(HueRad) * radius,
        -sin(HueRad) * radius, cos(HueRad) * radius
	);
	c0 = r2y * c0;
	c0.gb = HueMatrix * c0.gb;
	c0 = y2r * c0;
	return c0;
}

vec4 get_texel(vec2 uv) {
	return texture(sampler2D(input_image, default_sampler), uv);
}

float rgb2gray(vec4 rgba) {
	return dot(rgba.rgb, vec3(0.213,  0.715,  0.072));
}

uint packVec4ToUint(vec4 rgba) {
    uvec4 u = uvec4(round(rgba * 255.0));
    return (u.a << 24) | (u.b << 16) | (u.g << 8) | u.r;
}

vec4 unpackUintToVec4(uint packed) {
    uvec4 u;
    u.a = (packed >> 24) & 0xFFu;
    u.b = (packed >> 16) & 0xFFu;
    u.g = (packed >>  8) & 0xFFu;
    u.r =  packed        & 0xFFu;
    return vec4(u) / 255.0;
}

uint get_nibble(uint nibble_index_global) {
    uint dword_index = nibble_index_global / 8; // 0..3
    vec4 colors;
    if (dword_index == 0) colors = colors0;
    if (dword_index == 1) colors = colors1;
    if (dword_index == 2) colors = colors2;
    if (dword_index == 3) colors = colors3;
    uint dword = packVec4ToUint(colors);
    uint nibble_index = nibble_index_global % 8; // 0..7
    uint nibble = (dword >> (nibble_index * 4)) & 0xFu;
    return nibble; // 0..15
}

float catmullRom(float p0, float p1, float p2, float p3, float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return 0.5 * (
        (2.0 * p1) +
        (-p0 + p2) * t +
        (2.0*p0 - 5.0*p1 + 4.0*p2 - p3) * t2 +
        (-p0 + 3.0*p1 - 3.0*p2 + p3) * t3
    );
}

float get_stripe() {
    // gl_FragCoord.y приходит в диапазоне [0.5, resolution.y - 0.5]
    float y = gl_FragCoord.y / resolution.y; // диапазон (0, 1)
  
    uint nibble_index_global = uint(floor(y * 32)); // диапазон [0, 31]
    // uint nibble = get_nibble(nibble_index_global); // 0..15

    uint i = nibble_index_global;
    uint n = 32;
    float t = fract(y * 32);
    float p0 = (i == 0) ? get_nibble(0) : get_nibble(i-1);
    float p1 = get_nibble(i);
    float p2 = get_nibble(i+1);
    float p3 = (i+2 >= n) ? get_nibble(n-1) : get_nibble(i+2);
    float nibble = catmullRom(p0, p1, p2, p3, t);  
  
    float normalized = nibble / 15.0; // 0..1
    return normalized;
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 original = get_texel(uv);

    float stripe = get_stripe(); // 0..1
    float one_pixel = 1 / resolution.x;
    uv.x += shift_px * one_pixel * stripe;

    vec4 shifted = get_texel(uv);
    vec4 original_YUV = r2y * original;
    vec4 shifted_YUV = r2y * shifted;
    vec4 combined_YUV = vec4(
      shifted_YUV.r,
    //   original_YUV.g,
    //   original_YUV.b,
      shifted_YUV.g,
      shifted_YUV.b,
      0
    );
    vec4 combined = y2r * combined_YUV;
  
    float HueRad = hue * PI / 180; // -PI to +PI
    vec3 rgb = change_hue(combined, HueRad, 1).rgb;
    out_color = vec4(rgb, original.a);
}
