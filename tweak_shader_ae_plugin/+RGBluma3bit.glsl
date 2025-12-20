#version 450

#define PI acos(-1)

#pragma input(int, name = hue_shift, default = 0, min = -180, max = +180)
#pragma input(int, name = bit_order, default = 0, min = 0, max = 5)
#pragma input(float, name = diff_x, default = 0.0, min = 0.0, max = 1.0)
layout(set = 1, binding = 1) uniform CustomInput {
    int hue_shift;
    int bit_order; // 0=BRG, 1=BGR, 2=RBG, 3=RGB, 4=GBR, 5=GRB
    float diff_x; // граница для грейскейла [0,1]
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

vec4 get_bits(int c7, int order) {
	// Извлекаем три бита
	int bit0 = c7 % 2;
	c7 /= 2;
	int bit1 = c7 % 2;
	c7 /= 2;
	int bit2 = c7 % 2;
	
	vec4 bits = vec4(0);
	
	// Присваиваем биты в зависимости от порядка
	// order: 0=BRG, 1=BGR, 2=RBG, 3=RGB, 4=GBR, 5=GRB
	if (order == 0) { // BRG
		bits.b = bit0;
		bits.r = bit1;
		bits.g = bit2;
	} else if (order == 1) { // BGR
		bits.b = bit0;
		bits.g = bit1;
		bits.r = bit2;
	} else if (order == 2) { // RBG
		bits.r = bit0;
		bits.b = bit1;
		bits.g = bit2;
	} else if (order == 3) { // RGB
		bits.r = bit0;
		bits.g = bit1;
		bits.b = bit2;
	} else if (order == 4) { // GBR
		bits.g = bit0;
		bits.b = bit1;
		bits.r = bit2;
	} else { // GRB (order == 5)
		bits.g = bit0;
		bits.r = bit1;
		bits.b = bit2;
	}
	
	return bits;
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 original = get_texel(uv);

    // vec4 original_YUV = r2y * original;
    // vec4 converted_RGB = y2r * original_YUV;
    // out_color = vec4(converted_RGB.rgb, original.a);
  
	float L = rgb2gray(original); 

	vec4 newcol = vec4(0);
	for (int numb = 7; numb > 0; numb--) { //7..1
		vec4 lo_bits = get_bits(numb - 1, bit_order);	//6..0
		float lo_L = rgb2gray(lo_bits);
		if (L >= lo_L) {
			vec4 hi_bits = get_bits(numb, bit_order); 	//7..1
			float hi_L = rgb2gray(hi_bits);
			newcol = mix(lo_bits, hi_bits, (L - lo_L) / (hi_L - lo_L));
			break;
		}
	}

	// Если пиксель левее границы diff_x, выдаем грейскейл из newcol
	if (gl_FragCoord.x < diff_x * resolution.x) {
		float gray = rgb2gray(newcol);
		out_color = vec4(gray, gray, gray, original.a);
	} else {
		out_color = vec4(newcol.rgb, original.a);
	}
}
