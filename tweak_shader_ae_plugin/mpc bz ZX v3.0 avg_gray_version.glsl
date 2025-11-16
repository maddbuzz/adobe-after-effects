// переделал свои "mpc bz ZX v3.0pass1.hlsl" + "mpc bz ZX v3.0pass2.hlsl" под tweak_shader_ae_plugin

#version 450

// Размерность знакоместа cell_size*cell_size (на СПЕКТРУМЕ было 8*8):
#pragma input(int, name = "cell_size", default = 8, min = 1, max = 64)
layout(set = 1, binding = 1) uniform CustomInput {
    int cell_size;
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

vec4 get_texel(vec2 uv) {
	return texture(sampler2D(input_image, default_sampler), uv);
}

vec4 get_texel_from_cell(int y_in_cell, int x_in_cell, vec2 cell_uv) {
	vec2 texel_uv = vec2(x_in_cell / resolution.x, y_in_cell / resolution.y);
	return get_texel(cell_uv + texel_uv);
}

float rgb2gray(vec4 rgba) {
	return dot(rgba.rgb, vec3(0.213,  0.715,  0.072));
}

void main() {
    vec2 tex = gl_FragCoord.xy / resolution.xy;
    // vec4 original = tex2D(s0, tex);
    // vec4 original = get_texel(tex);

    ivec2 itex = ivec2(tex.x * resolution.x, tex.y * resolution.y);
	ivec2 itex0 = ivec2(itex.x % cell_size, itex.y % cell_size);
	itex /= cell_size;
	itex *= cell_size;
	vec2 ztex = vec2((0.5 + itex.x) / resolution.x, (0.5 + itex.y) / resolution.y);

	// float fmin = 1, fmax = 0;
  float m = 0;
	for (int y = 0; y < cell_size; y++) {
		for (int x = 0; x < cell_size; x++) {
			float gray = rgb2gray(get_texel_from_cell(y, x, ztex));
			// if (gray < fmin) fmin = gray;
			// if (gray > fmax) fmax = gray;
      m += gray;
		}
	}
	// float m = mix(fmin, fmax, .5);
  m = m / (cell_size * cell_size);

	int this_texel_group = int(rgb2gray(get_texel_from_cell(itex0.y, itex0.x, ztex)) > m);

	vec4 colors = vec4(0);
	float cn = 0;
	for (int y = 0; y < cell_size; y++) {
		for (int x = 0; x < cell_size; x++) {
			vec4 texel = get_texel_from_cell(y, x, ztex);
			int texel_group = int(rgb2gray(texel) > m);
			if (this_texel_group == texel_group) {
				colors += texel;			
				cn++; 
			}
		}
	}
	colors /= cn; 
    
	// out_color = original;
	out_color = colors;
  // return colors;
}
