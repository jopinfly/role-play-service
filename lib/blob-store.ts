import { put } from "@vercel/blob";

type UploadMediaInput = {
  folder: "audio" | "image";
  sessionId: string;
  messageId: string;
  data: Buffer;
  extension: string;
  contentType: string;
};

export async function uploadMediaToBlob(input: UploadMediaInput) {
  const pathname = `chat/${input.folder}/${input.sessionId}/${input.messageId}.${input.extension}`;
  const result = await put(pathname, input.data, {
    access: "public",
    contentType: input.contentType,
    addRandomSuffix: false,
  });
  return result.url;
}
