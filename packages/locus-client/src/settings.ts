// Generated from Rust provider schemas and complete defaults. Do not edit.
export interface MediaToolPaths {
  ffmpeg: string;
  ffprobe: string;
}
export const MediaToolPathsGroupId = "25c3fd2a-4148-4cb3-aca4-47c3ce3402e5";
export function createMediaToolPathsDefaults(): MediaToolPaths { return JSON.parse("{\"ffmpeg\":\"ffmpeg\",\"ffprobe\":\"ffprobe\"}"); }
export interface ExternalAddress {
  address: string;
}
export const ExternalAddressGroupId = "8bf9fb31-5633-44ca-956d-ef2b373c61af";
export function createExternalAddressDefaults(): ExternalAddress { return JSON.parse("{\"address\":\"127.0.0.1:46321\"}"); }
