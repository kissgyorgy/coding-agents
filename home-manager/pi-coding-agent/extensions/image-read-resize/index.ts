import {
  formatSize,
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { open, mkdtemp, rmdir, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A 3 MiB source stays around 4 MiB after base64 encoding, leaving headroom
// below providers with a 5 MB inline-image limit.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 60_000;

const RESIZE_ATTEMPTS = [
  { maxDimension: 2000, quality: 82 },
  { maxDimension: 1600, quality: 78 },
  { maxDimension: 1280, quality: 74 },
  { maxDimension: 1024, quality: 68 },
  { maxDimension: 800, quality: 62 },
  { maxDimension: 640, quality: 55 },
] as const;

interface TemporaryImage {
  directory: string;
  path: string;
}

function resolveToolPath(rawPath: string, cwd: string): string | undefined {
  const withoutPrefix = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  const trimmed = withoutPrefix.trim();
  if (!trimmed) return undefined;

  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }

  return resolve(cwd, trimmed);
}

function hasSupportedImageSignature(header: Buffer): boolean {
  const isJpeg =
    header.length >= 3 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff;
  const isPng =
    header.length >= 8 &&
    header
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const signature = header.subarray(0, 12).toString("ascii");
  const isGif =
    signature.startsWith("GIF87a") || signature.startsWith("GIF89a");
  const isWebp =
    signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP";
  const isBmp = signature.startsWith("BM");

  return isJpeg || isPng || isGif || isWebp || isBmp;
}

async function isSupportedImage(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return hasSupportedImageSignature(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function cleanupTemporaryImage(image: TemporaryImage): Promise<void> {
  await unlink(image.path).catch(() => undefined);
  await rmdir(image.directory).catch(() => undefined);
}

export default function (pi: ExtensionAPI) {
  const temporaryImages = new Map<string, TemporaryImage>();

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("read", event)) return;

    const sourcePath = resolveToolPath(event.input.path, ctx.cwd);
    if (!sourcePath) return;

    let sourceSize: number;
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile() || sourceStat.size <= MAX_IMAGE_BYTES) return;
      sourceSize = sourceStat.size;
      if (!(await isSupportedImage(sourcePath))) return;
    } catch {
      // Let the built-in read tool report inaccessible or missing files itself.
      return;
    }

    let temporaryImage: TemporaryImage | undefined;

    try {
      const directory = await mkdtemp(join(tmpdir(), "pi-image-read-"));
      const resizedPath = join(directory, "resized.jpg");
      temporaryImage = { directory, path: resizedPath };
      let resizedSize: number | undefined;

      for (const attempt of RESIZE_ATTEMPTS) {
        const result = await pi.exec(
          "magick",
          [
            `${sourcePath}[0]`,
            "-auto-orient",
            "-resize",
            `${attempt.maxDimension}x${attempt.maxDimension}>`,
            "-background",
            "white",
            "-alpha",
            "remove",
            "-alpha",
            "off",
            "-strip",
            "-quality",
            String(attempt.quality),
            resizedPath,
          ],
          { signal: ctx.signal, timeout: CONVERSION_TIMEOUT_MS },
        );

        if (result.code !== 0) {
          throw new Error(
            result.stderr.trim() || "ImageMagick conversion failed",
          );
        }

        resizedSize = (await stat(resizedPath)).size;
        if (resizedSize <= MAX_IMAGE_BYTES) break;
      }

      if (resizedSize === undefined || resizedSize > MAX_IMAGE_BYTES) {
        throw new Error(
          `could not reduce the image below ${formatSize(MAX_IMAGE_BYTES)}`,
        );
      }

      temporaryImages.set(event.toolCallId, temporaryImage);
      event.input.path = resizedPath;

      if (ctx.hasUI) {
        ctx.ui.notify(
          `image-read-resize: ${formatSize(sourceSize)} → ${formatSize(resizedSize)}`,
          "info",
        );
      }
    } catch (error: unknown) {
      if (temporaryImage) await cleanupTemporaryImage(temporaryImage);
      if (ctx.hasUI && !ctx.signal?.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `image-read-resize: resize failed; reading the original (${message})`,
          "warning",
        );
      }
      // Do not block or mutate the call when conversion fails.
    }
  });

  pi.on("tool_result", async (event) => {
    const temporaryImage = temporaryImages.get(event.toolCallId);
    if (!temporaryImage) return;

    temporaryImages.delete(event.toolCallId);
    await cleanupTemporaryImage(temporaryImage);
  });

  pi.on("session_shutdown", async () => {
    const pendingImages = [...temporaryImages.values()];
    temporaryImages.clear();
    await Promise.all(pendingImages.map(cleanupTemporaryImage));
  });
}
