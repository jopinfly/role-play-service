type GenerateImageInput = {
  prompt: string;
};

const VALID_STABILITY_MODELS = new Set([
  "sd3.5-large",
  "sd3.5-large-turbo",
  "sd3.5-medium",
  "sd3.5-flash",
]);

function normalizeModelName(rawModel?: string) {
  if (!rawModel?.trim()) {
    return "sd3.5-large";
  }

  const lowered = rawModel.trim().toLowerCase();
  const compact = lowered.replace(/[\s_]+/g, "-");
  const normalized = compact
    .replace(/^sd-?3\.5-?/, "sd3.5-")
    .replace(/^sd3-5-/, "sd3.5-")
    .replace(/^sd-?3-?5-?/, "sd3.5-");

  const aliasMap: Record<string, string> = {
    "sd-3.5-large": "sd3.5-large",
    "sd-3.5-large-turbo": "sd3.5-large-turbo",
    "sd-3.5-medium": "sd3.5-medium",
    "sd-3.5-flash": "sd3.5-flash",
    "sd-3-5-large": "sd3.5-large",
    "sd-3-5-large-turbo": "sd3.5-large-turbo",
    "sd-3-5-medium": "sd3.5-medium",
    "sd-3-5-flash": "sd3.5-flash",
    "sd3.5-large": "sd3.5-large",
    "sd3.5-large-turbo": "sd3.5-large-turbo",
    "sd3.5-medium": "sd3.5-medium",
    "sd3.5-flash": "sd3.5-flash",
  };

  const mapped = aliasMap[normalized] ?? aliasMap[compact] ?? lowered;
  if (VALID_STABILITY_MODELS.has(mapped)) {
    return mapped;
  }

  return "sd3.5-large";
}

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

  const model = normalizeModelName(process.env.STABILITY_IMAGE_MODEL);
  const formData = new FormData();
  formData.set("prompt", input.prompt);
  formData.set("output_format", outputFormat);
  formData.set("aspect_ratio", aspectRatio);
  formData.set("model", model);

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
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  return {
    mimeType,
    extension,
    buffer: imageBuffer,
  };
}
