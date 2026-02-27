type GenerateImageInput = {
  prompt: string;
};

function getStabilityApiKey() {
  const key = process.env.STABILITY_API_KEY;
  if (!key) {
    throw new Error("缺少 STABILITY_API_KEY，请在 .env.local 中配置。");
  }
  return key;
}

export async function generateImageByStability(input: GenerateImageInput) {
  const endpoint =
    process.env.STABILITY_IMAGE_ENDPOINT ??
    "https://api.stability.ai/v2beta/stable-image/generate/sd3";
  const outputFormat = (process.env.STABILITY_IMAGE_FORMAT ?? "png").toLowerCase();
  const aspectRatio = process.env.STABILITY_IMAGE_ASPECT_RATIO ?? "1:1";

  const formData = new FormData();
  formData.set("prompt", input.prompt);
  formData.set("output_format", outputFormat);
  formData.set("aspect_ratio", aspectRatio);
  const model = process.env.STABILITY_IMAGE_MODEL?.trim();
  if (model) {
    formData.set("model", model);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getStabilityApiKey()}`,
      Accept: "image/*",
    },
    body: formData,
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Stability 图片生成失败（${response.status}）：${raw.slice(0, 300)}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type") || "image/png";
  return {
    mimeType,
    base64: imageBuffer.toString("base64"),
  };
}
