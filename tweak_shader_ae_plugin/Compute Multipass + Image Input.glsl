#version 450

#pragma tweak_shader(version=1.0)
#pragma stage(compute)

#pragma utility_block(ShaderInputs)
layout(set = 0, binding = 0) uniform ShaderInputs {
    float time;
    float time_delta;
    float frame_rate;
    uint frame_index;
    vec4 mouse;
    vec4 date;
    vec3 resolution;
    uint pass_index;
};

#pragma target(name="output_image", screen)
layout(rgba8, set = 0, binding = 1) uniform writeonly image2D output_image;

#pragma pass(0)
#pragma relay(name="relay", target="relay_target")
layout(rgba8, set = 0, binding = 2) uniform writeonly image2D relay;
layout(set = 0, binding = 3) uniform texture2D relay_target;

#pragma input(image, name="input_image")
layout(set = 0, binding = 4) uniform texture2D input_image;

layout(local_size_x = 16, local_size_y = 16) in;
void main() {
    ivec2 pixel_coords = ivec2(gl_GlobalInvocationID.xy);
    ivec2 image_size = imageSize(output_image);

    vec2 normalized_coords = vec2(pixel_coords) / vec2(image_size);

    float center_circle = step(length(normalized_coords - vec2(0.5)), 0.2);

    if (pass_index == 0) {
        imageStore(relay, pixel_coords, vec4(center_circle));
    } else {
        // Читаем маску из relay_target через texelFetch (как в оригинале)
        vec4 mask = texelFetch(relay_target, pixel_coords, 0);
        // Используем красный канал маски (все каналы должны быть одинаковыми)
        float mask_value = mask.r;
        
        // Читаем цвет из input_image через texelFetch с масштабированием координат
        ivec2 input_size = textureSize(input_image, 0);
        ivec2 input_coords = ivec2(normalized_coords * vec2(input_size));
        vec4 color = texelFetch(input_image, input_coords, 0);
        
        // Внутри маски (mask_value = 1.0) - обычный цвет
        // Вне маски (mask_value = 0.0) - инвертированный цвет
        // Инвертируем только RGB, альфа оставляем как есть
        vec4 inverted_color = vec4(vec3(1.0) - color.rgb, color.a);
        vec4 result = mix(inverted_color, color, mask_value);
        imageStore(output_image, pixel_coords, result);
    }
}
