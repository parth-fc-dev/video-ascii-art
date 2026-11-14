(() => {
  const vertexSource = `#version 300 es
    in vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `#version 300 es
    precision highp float;
    uniform sampler2D u_video;
    uniform sampler2D u_glyphs;
    uniform vec2 u_outputSize;
    uniform vec2 u_grid;
    uniform float u_charCount;
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_blackLevel;
    uniform float u_whiteLevel;
    uniform float u_sharpness;
    uniform float u_definition;
    uniform float u_glowThreshold;
    uniform float u_glowAmount;
    uniform float u_glowSize;
    uniform float u_invert;
    uniform float u_colored;
    uniform float u_scatter;
    uniform float u_time;
    uniform vec3 u_textColor;
    uniform vec3 u_backgroundColor;

    out vec4 outColor;

    vec3 adjustedColor(vec3 color) {
      float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 saturated = vec3(gray) + (color - vec3(gray)) * u_saturation;
      vec3 contrasted = clamp(saturated * u_contrast + vec3(0.5 * (1.0 - u_contrast)), 0.0, 1.0);
      return clamp((contrasted - vec3(u_blackLevel)) / max(u_whiteLevel - u_blackLevel, 0.01), 0.0, 1.0);
    }

    float luminanceAt(vec2 uv) {
      return dot(adjustedColor(texture(u_video, clamp(uv, 0.0, 1.0)).rgb), vec3(0.2126, 0.7152, 0.0722));
    }

    float glyphCoverageAt(float glyphIndex, vec2 local) {
      vec2 glyphUv = vec2(
        (glyphIndex + clamp(local.x, 0.0, 1.0)) / u_charCount,
        clamp(local.y, 0.0, 1.0)
      );
      return texture(u_glyphs, glyphUv).a;
    }

    void main() {
      vec2 cellSize = u_outputSize / u_grid;
      vec2 cell = floor(gl_FragCoord.xy / cellSize);
      vec2 local = fract(gl_FragCoord.xy / cellSize);
      float rowFromTop = u_grid.y - cell.y - 1.0;
      vec2 videoUv = vec2((cell.x + 0.5) / u_grid.x, 1.0 - (rowFromTop + 0.5) / u_grid.y);
      vec2 texel = 1.0 / u_grid;
      float center = luminanceAt(videoUv);
      float left = luminanceAt(videoUv + vec2(-texel.x, 0.0));
      float right = luminanceAt(videoUv + vec2(texel.x, 0.0));
      float above = luminanceAt(videoUv + vec2(0.0, -texel.y));
      float below = luminanceAt(videoUv + vec2(0.0, texel.y));
      float neighbors = (left + right + above + below) * 0.25;
      float localMinimum = min(center, min(min(left, right), min(above, below)));
      float localMaximum = max(center, max(max(left, right), max(above, below)));
      float localRange = localMaximum - localMinimum;
      float localDetail = localRange > 0.025 ? (center - localMinimum) / localRange : center;
      float edge = center - neighbors;
      float brightness = clamp(
        center + edge * u_sharpness * 2.5 + (localDetail - center) * u_definition * 0.65,
        0.0,
        1.0
      );
      brightness = mix(brightness, 1.0 - brightness, u_invert);
      float glyphIndex = min(u_charCount - 1.0, floor(brightness * u_charCount));
      float glow = smoothstep(u_glowThreshold, 1.0, center);
      glyphIndex = min(glyphIndex, floor((1.0 - glow * 0.7) * (u_charCount - 1.0)));

      if (u_scatter > 0.0) {
        float seed = sin(dot(cell + vec2(u_time), vec2(12.9898, 78.233))) * 43758.5453;
        vec2 jitter = (fract(vec2(seed, seed * 1.371)) - 0.5) * vec2(0.22, 0.16) * u_scatter;
        local = fract(local - jitter);
      }

      vec2 glyphUv = vec2((glyphIndex + local.x) / u_charCount, local.y);
      float coverage = texture(u_glyphs, glyphUv).a;
      float blurredCoverage = 0.0;
      float blurWeight = 0.0;
      float blurRadius = u_glowSize * 0.14;
      float blurSigma = max(blurRadius * 0.65, 0.001);
      for (int blurY = -1; blurY <= 1; blurY++) {
        for (int blurX = -1; blurX <= 1; blurX++) {
          vec2 offset = vec2(float(blurX), float(blurY)) * blurRadius;
          float weight = exp(-dot(offset, offset) / (2.0 * blurSigma * blurSigma));
          blurredCoverage += glyphCoverageAt(glyphIndex, local + offset) * weight;
          blurWeight += weight;
        }
      }
      blurredCoverage /= blurWeight;
      vec3 sampledColor = adjustedColor(texture(u_video, videoUv).rgb);
      vec3 foreground = mix(u_textColor, sampledColor, u_colored);
      foreground = mix(foreground, vec3(1.0), glow * 0.7);
      float glowCoverage = clamp(blurredCoverage - coverage, 0.0, 1.0) * glow * u_glowAmount * 2.4;
      vec3 glowColor = mix(foreground, vec3(1.0), 0.45);
      vec3 pixelColor = mix(u_backgroundColor, glowColor, glowCoverage);
      pixelColor = mix(pixelColor, foreground, coverage);
      outColor = vec4(pixelColor, 1.0);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || "Could not compile WebGL shader.");
    }
    return shader;
  }

  function colorVector(value, fallback) {
    const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value || "");
    if (!match) return fallback;
    return match.slice(1).map((part) => parseInt(part, 16) / 255);
  }

  function create(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentSource,
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        gl.getProgramInfoLog(program) || "Could not link WebGL program.",
      );
    }

    const positions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const videoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const glyphTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glyphTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const uniformNames = [
      "u_video",
      "u_glyphs",
      "u_outputSize",
      "u_grid",
      "u_charCount",
      "u_contrast",
      "u_saturation",
      "u_blackLevel",
      "u_whiteLevel",
      "u_sharpness",
      "u_definition",
      "u_glowThreshold",
      "u_glowAmount",
      "u_glowSize",
      "u_invert",
      "u_colored",
      "u_scatter",
      "u_time",
      "u_textColor",
      "u_backgroundColor",
    ];
    const uniforms = Object.fromEntries(
      uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
    );
    let atlasCharacters = "";
    let uploadedVideoWidth = 0;
    let uploadedVideoHeight = 0;

    function uploadGlyphAtlas(characters) {
      if (characters === atlasCharacters) return;
      const ramp = [...(characters || " ")].slice(0, 256).join("") || " ";
      const tileWidth = 18;
      const tileHeight = 32;
      const atlas = document.createElement("canvas");
      atlas.width = tileWidth * ramp.length;
      atlas.height = tileHeight;
      const context = atlas.getContext("2d");
      context.clearRect(0, 0, atlas.width, atlas.height);
      context.fillStyle = "#fff";
      context.font = "24px monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (let index = 0; index < ramp.length; index += 1) {
        context.fillText(
          ramp[index],
          index * tileWidth + tileWidth / 2,
          tileHeight / 2,
        );
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glyphTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        atlas,
      );
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      atlasCharacters = ramp;
    }

    function render(video, options) {
      const {
        width,
        height,
        columns,
        rows,
        characters,
        settings,
        glowThreshold,
        glowAmount,
        glowSize,
        scattering,
        scatterStrength,
        now,
      } = options;
      const ramp = [...(characters || " ")].slice(0, 256).join("") || " ";
      uploadGlyphAtlas(ramp);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positions);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (
        uploadedVideoWidth !== video.videoWidth ||
        uploadedVideoHeight !== video.videoHeight
      ) {
        uploadedVideoWidth = video.videoWidth;
        uploadedVideoHeight = video.videoHeight;
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGB,
          uploadedVideoWidth,
          uploadedVideoHeight,
          0,
          gl.RGB,
          gl.UNSIGNED_BYTE,
          null,
        );
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glyphTexture);

      gl.uniform1i(uniforms.u_video, 0);
      gl.uniform1i(uniforms.u_glyphs, 1);
      gl.uniform2f(uniforms.u_outputSize, canvas.width, canvas.height);
      gl.uniform2f(uniforms.u_grid, columns, rows);
      gl.uniform1f(uniforms.u_charCount, ramp.length);
      gl.uniform1f(
        uniforms.u_contrast,
        Math.max(0, Math.min(200, Number(settings.contrast) || 100)) / 100,
      );
      gl.uniform1f(
        uniforms.u_saturation,
        Math.max(0, Math.min(200, Number(settings.saturation) || 100)) / 100,
      );
      gl.uniform1f(
        uniforms.u_blackLevel,
        Math.max(0, Math.min(40, Number(settings.blackLevel) || 0)) / 100,
      );
      gl.uniform1f(
        uniforms.u_whiteLevel,
        Math.max(60, Math.min(100, Number(settings.whiteLevel) || 100)) / 100,
      );
      gl.uniform1f(
        uniforms.u_sharpness,
        Math.max(0, Math.min(100, Number(settings.sharpness) || 0)) / 100,
      );
      gl.uniform1f(
        uniforms.u_definition,
        Math.max(0, Math.min(100, Number(settings.definition) || 0)) / 100,
      );
      gl.uniform1f(uniforms.u_glowThreshold, glowThreshold);
      gl.uniform1f(uniforms.u_glowAmount, glowAmount);
      gl.uniform1f(uniforms.u_glowSize, glowSize);
      gl.uniform1f(uniforms.u_invert, settings.invert ? 1 : 0);
      gl.uniform1f(uniforms.u_colored, settings.preset === "colored" ? 1 : 0);
      gl.uniform1f(uniforms.u_scatter, scattering ? scatterStrength : 0);
      gl.uniform1f(uniforms.u_time, now * 0.001);
      gl.uniform3fv(
        uniforms.u_textColor,
        colorVector(settings.textColor, [0.96, 0.96, 0.94]),
      );
      gl.uniform3fv(
        uniforms.u_backgroundColor,
        colorVector(settings.backgroundColor, [0.07, 0.07, 0.07]),
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function dispose() {
      gl.deleteTexture(videoTexture);
      gl.deleteTexture(glyphTexture);
      gl.deleteBuffer(positions);
      gl.deleteProgram(program);
    }

    return { render, dispose };
  }

  globalThis.YouTubeAsciiGpu = { create };
})();
