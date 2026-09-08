import { realpath, rm, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface LocalStorageRoots {
  evidence: string;
  video: string;
}

export function resolveLocalStorageRoots(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): LocalStorageRoots {
  return {
    evidence: resolve(env.EVIDENCE_STORAGE_ROOT ?? join(cwd, "apps", "bot", "storage", "evidence")),
    video: resolve(env.VIDEO_STORAGE_ROOT ?? join(cwd, "storage", "video")),
  };
}

function isFileInsideRoot(filePath: string, root: string): boolean {
  const pathFromRoot = relative(root, filePath);
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

async function realPathIfExists(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function deleteLocalStorageFiles(
  paths: readonly string[],
  roots: LocalStorageRoots = resolveLocalStorageRoots()
): Promise<void> {
  await deleteLocalStorageEntries({ files: paths, directories: [] }, roots);
}

export async function deleteLocalStorageEntries(
  entries: { files: readonly string[]; directories: readonly string[] },
  roots: LocalStorageRoots = resolveLocalStorageRoots()
): Promise<void> {
  const resolvedRoots = [resolve(roots.evidence), resolve(roots.video)];
  const resolvedFiles = [...new Set(entries.files.filter(Boolean).map((path) => resolve(path)))];
  const resolvedDirectories = [
    ...new Set(entries.directories.filter(Boolean).map((path) => resolve(path))),
  ];
  const resolvedPaths = [...resolvedFiles, ...resolvedDirectories];
  const realRoots = await Promise.all(
    resolvedRoots.map(async (root) => (await realPathIfExists(root)) ?? root)
  );

  for (const filePath of resolvedPaths) {
    const realFilePath = await realPathIfExists(filePath);
    const isLexicallyAllowed = resolvedRoots.some((root) => isFileInsideRoot(filePath, root));
    const isReallyAllowed =
      realFilePath === null || realRoots.some((root) => isFileInsideRoot(realFilePath, root));
    if (!isLexicallyAllowed || !isReallyAllowed) {
      throw new Error(`Refusing to delete path outside configured storage roots: ${filePath}`);
    }
  }

  for (const filePath of resolvedFiles) {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  for (const directoryPath of resolvedDirectories) {
    await rm(directoryPath, { recursive: true, force: true });
  }
}
