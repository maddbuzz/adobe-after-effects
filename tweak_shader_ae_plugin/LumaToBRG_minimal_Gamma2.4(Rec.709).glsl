#version 450

#define PI acos(-1)

#pragma input(float, name = diff_y, default = 0.5, min = 0.0, max = 1.0)
layout(set = 1, binding = 1) uniform CustomInput {
    float diff_y;
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

// // Y ∈ [0, 1], U ∈ [−0.5, 0.5], V ∈ [−0.5, 0.5]
// // RGB -> YUV matrix (rows converted to column-major for GLSL)
// const mat4 r2y = mat4(
//     0.213, -0.115,  0.500, 0.0,   // column 0 (r0,r1,r2,r3)
//     0.715, -0.385, -0.454, 0.0,   // column 1
//     0.072,  0.500, -0.046, 0.0,   // column 2
//     0.0,    0.0,    0.0,   0.0    // column 3
// );
// // YUV -> RGB matrix (rows -> columns)
// const mat4 y2r = mat4(
//     1.000,  1.000,  1.000, 0.0,   // column 0
//     0.000, -0.187,  1.856, 0.0,   // column 1
//     1.575, -0.468,  0.000, 0.0,   // column 2
//     0.0,    0.0,    0.0,   0.0
// );

// // HueRad: -PI to +PI (default 0.0), radius: 0 to 1 (default: 1)
// vec4 change_hue(vec4 c0, float HueRad, float radius)
// {
// 	mat2 HueMatrix = mat2(
//         +cos(HueRad) * radius, sin(HueRad) * radius,
//         -sin(HueRad) * radius, cos(HueRad) * radius
// 	);
// 	c0 = r2y * c0;
// 	c0.gb = HueMatrix * c0.gb;
// 	c0 = y2r * c0;
// 	return c0;
// }

vec4 get_texel(vec2 uv) {
	return texture(sampler2D(input_image, default_sampler), uv);
}

float rgb2gray(vec3 rgb) {
	// return dot(rgb, vec3(0.213,  0.715,  0.072));
	return dot(rgb, vec3(0.2126,  0.7152,  0.0722)); // веса при Rec. 709 (гамма 2.4)
}

vec3 get_bits(int c7) {
	int bit0 = c7 % 2;
	c7 /= 2;
	int bit1 = c7 % 2;
	c7 /= 2;
	int bit2 = c7 % 2;
	return vec3(bit1, bit2, bit0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 original = get_texel(uv);
    // original = uv.xxxx;

    if (1 - uv.y > diff_y) {
        out_color = original;
    } else {
    	vec3 newcol = vec3(original.rgb);
    	float L = rgb2gray(newcol);
        for (int numb = 7; numb > 0; numb--) { //7..1
            vec3 lo_bits = get_bits(numb - 1);	//6..0
            float lo_L = rgb2gray(lo_bits);
            if (L >= lo_L) {
                vec3 hi_bits = get_bits(numb); 	//7..1
                float hi_L = rgb2gray(hi_bits);
                newcol = mix(lo_bits, hi_bits, (L - lo_L) / (hi_L - lo_L));
                break;
            }
        }
        out_color = vec4(newcol, original.a);
    }
}
