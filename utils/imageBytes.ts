import { Platform } from "react-native";
import { File } from "expo-file-system";

/**
 * [2026-09-11] 사용자가 고른 이미지의 바이트를 읽는다 — 플랫폼마다 방법이 다르다.
 *
 * 네이티브: expo-file-system의 `File.arrayBuffer()`.
 *   React Native에서 `fetch(localUri).then(r => r.blob())`는 로컬 파일을 온전히 읽지
 *   못해 업로드가 조용히 실패하는 경우가 있다(2026-09-09 채팅 이미지 전송 장애의
 *   근본 원인으로 확인됨).
 *
 * 웹: expo-file-system의 `File`은 네이티브 전용이라 아예 동작하지 않는다.
 *   ImagePicker가 웹에서 돌려주는 `blob:`/`data:` URL은 브라우저 fetch로 읽을 수 있다.
 *   (2026-09-11 QA: 웹 미리보기에서 "사진 업로드에 실패했습니다"가 뜬 원인.)
 *
 * 확장자: 웹의 `blob:` URL에는 확장자가 없어 `blob.type`에서 되짚는다.
 *
 * 매물 사진(services/properties.ts)과 채팅 이미지(services/chat.ts)가 같은 문제를
 * 겪으므로 여기 한 곳에 둔다 — 한쪽만 고쳐 두면 다른 쪽에서 같은 장애가 되풀이된다.
 */
export type ImageBytes = {
  bytes: ArrayBuffer;
  contentType: string;
  fileExt: string;
};

export async function readImageBytes(localUri: string): Promise<ImageBytes> {
  const extMatch = localUri.split("?")[0].match(/\.(\w+)$/);
  const uriExt = extMatch?.[1]?.toLowerCase() ?? "";

  if (Platform.OS === "web") {
    const response = await fetch(localUri);
    const blob = await response.blob();
    const contentType = blob.type || (uriExt === "png" ? "image/png" : "image/jpeg");
    const typeExt = contentType.split("/")[1]?.split("+")[0];
    return {
      bytes: await blob.arrayBuffer(),
      contentType,
      fileExt: uriExt || typeExt || "jpg",
    };
  }

  const fileExt = uriExt || "jpg";
  return {
    bytes: await new File(localUri).arrayBuffer(),
    contentType: fileExt === "png" ? "image/png" : "image/jpeg",
    fileExt,
  };
}
