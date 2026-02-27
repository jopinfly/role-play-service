type SynthesizeSpeechInput = {
  text: string;
};

type T2AResponse = {
  data?: {
    audio?: string;
    status?: number;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

function getMiniMaxApiKey() {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    throw new Error("缺少 MINIMAX_API_KEY，请在 .env.local 中配置。");
  }
  return key;
}

function getAudioMime(format: string) {
  if (format === "wav") {
    return "audio/wav";
  }
  if (format === "flac") {
    return "audio/flac";
  }
  if (format === "pcm") {
    return "audio/wav";
  }
  return "audio/mpeg";
}

export async function synthesizeSpeechByMiniMax(input: SynthesizeSpeechInput) {
  const model = process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd";
  const voiceId = process.env.MINIMAX_TTS_VOICE_ID ?? "male-qn-qingse";
  const audioFormat = (process.env.MINIMAX_TTS_FORMAT ?? "mp3").toLowerCase();
  const endpoint = process.env.MINIMAX_TTS_ENDPOINT ?? "https://api.minimaxi.com/v1/t2a_v2";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getMiniMaxApiKey()}`,
    },
    body: JSON.stringify({
      model,
      text: input.text,
      stream: false,
      output_format: "hex",
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: audioFormat,
        channel: 1,
      },
      subtitle_enable: false,
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`MiniMax TTS 请求失败（${response.status}）：${raw.slice(0, 300)}`);
  }

  const payload = (await response.json()) as T2AResponse;
  const statusCode = payload.base_resp?.status_code ?? 0;
  if (statusCode !== 0) {
    const statusMessage = payload.base_resp?.status_msg ?? "未知错误";
    throw new Error(`MiniMax TTS 失败：${statusCode} ${statusMessage}`);
  }

  const audioHex = payload.data?.audio?.trim();
  if (!audioHex) {
    throw new Error("MiniMax TTS 未返回音频数据。");
  }

  return {
    mimeType: getAudioMime(audioFormat),
    base64: Buffer.from(audioHex, "hex").toString("base64"),
  };
}
