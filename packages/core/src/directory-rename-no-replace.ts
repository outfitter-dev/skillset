import { dlopen, read } from "bun:ffi";
import type { Pointer } from "bun:ffi";
import nodePath from "node:path";

/** The result of asking the host to rename a directory without replacement. */
export type DirectoryRenameNoReplaceResult =
  | { readonly kind: "installed" }
  | { readonly kind: "occupied" }
  | { readonly kind: "unsupported"; readonly reason: string };

const AT_FDCWD = -100n;
const DARWIN_RENAME_EXCL = 4;
const LINUX_RENAME_NOREPLACE = 1;
const WINDOWS_ERROR_ALREADY_EXISTS = 183;
const WINDOWS_ERROR_FILE_EXISTS = 80;

const loadDarwinLibrary = () =>
  dlopen("/usr/lib/libSystem.B.dylib", {
    __error: { args: [], returns: "ptr" },
    renamex_np: {
      args: ["ptr", "ptr", "u32"],
      returns: "i32",
    },
  });

const loadLinuxLibrary = () =>
  dlopen("libc.so.6", {
    __errno_location: { args: [], returns: "ptr" },
    syscall: {
      // `syscall` is variadic in libc. This fixed signature covers exactly the
      // renameat2 call shape used below while avoiding the glibc 2.28 wrapper.
      args: ["i64", "i64", "ptr", "i64", "ptr", "u32"],
      returns: "i64",
    },
  });

const loadWindowsLibrary = () =>
  dlopen("kernel32.dll", {
    GetLastError: { args: [], returns: "u32" },
    MoveFileExW: {
      args: ["ptr", "ptr", "u32"],
      returns: "u32",
    },
  });

const unsupportedLibrary = (
  platform: string,
  error: unknown
): DirectoryRenameNoReplaceResult => {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    kind: "unsupported",
    reason: `${platform} native rename library could not be loaded: ${detail}`,
  };
};

type LibraryState<T> =
  | { readonly library: T }
  | { readonly failure: DirectoryRenameNoReplaceResult };

// Both outcomes are memoized: a host that cannot load its native library
// reports the same `unsupported` verdict on every call instead of paying for
// a fresh dlopen attempt each time.
const lazyLibrary = <T>(
  platform: string,
  load: () => T
): (() => LibraryState<T>) => {
  let state: LibraryState<T> | undefined;
  return () => {
    if (state === undefined) {
      try {
        state = { library: load() };
      } catch (error) {
        state = { failure: unsupportedLibrary(platform, error) };
      }
    }
    return state;
  };
};

const getDarwinLibrary = lazyLibrary("macOS", loadDarwinLibrary);
const getLinuxLibrary = lazyLibrary("Linux", loadLinuxLibrary);
const getWindowsLibrary = lazyLibrary("Windows", loadWindowsLibrary);

// FFI string arguments are passed as NUL-terminated buffers so the call shape
// is identical on every Bun version; passing JS strings to `cstring` arguments
// relies on auto-encoding that only newer runtimes provide.
const cString = (value: string): Buffer => Buffer.from(`${value}\0`, "utf8");

const unsupportedNative = (
  platform: string,
  nativeCode: number
): DirectoryRenameNoReplaceResult => ({
  kind: "unsupported",
  reason: `${platform} returned unsupported native code ${nativeCode}`,
});

const nativeFailure = (
  platform: string,
  nativeCode: number,
  sourcePath: string,
  destinationPath: string
): Error =>
  new Error(
    `skillset: ${platform} atomic directory rename failed with native code ${nativeCode}: ${sourcePath} -> ${destinationPath}`
  );

const readErrno = (
  platform: string,
  pointer: bigint | Pointer | null
): number => {
  if (pointer === null) {
    throw new Error(`skillset: ${platform} returned a null errno pointer`);
  }
  return read.i32(pointer, 0);
};

const renameDirectoryNoReplaceDarwin = (
  sourcePath: string,
  destinationPath: string
): DirectoryRenameNoReplaceResult => {
  const state = getDarwinLibrary();
  if ("failure" in state) {
    return state.failure;
  }
  const { library } = state;
  const result = library.symbols.renamex_np(
    cString(sourcePath),
    cString(destinationPath),
    DARWIN_RENAME_EXCL
  );
  if (result === 0) {
    return { kind: "installed" };
  }
  const errno = readErrno("macOS", library.symbols.__error());
  if (errno === 17) {
    return { kind: "occupied" };
  }
  // ENOTSUP, ENOSYS, and EINVAL report a host/filesystem that cannot honor
  // RENAME_EXCL. Every other errno is an operational failure.
  if (errno === 45 || errno === 78 || errno === 22) {
    return unsupportedNative("macOS", errno);
  }
  throw nativeFailure("macOS", errno, sourcePath, destinationPath);
};

const linuxRenameat2SyscallNumber = (): bigint | undefined => {
  if (process.arch === "x64") {
    return 316n;
  }
  if (process.arch === "arm64") {
    return 276n;
  }
  return undefined;
};

const renameDirectoryNoReplaceLinux = (
  sourcePath: string,
  destinationPath: string
): DirectoryRenameNoReplaceResult => {
  const syscallNumber = linuxRenameat2SyscallNumber();
  if (syscallNumber === undefined) {
    return {
      kind: "unsupported",
      reason: `renameat2 syscall number is not defined for Linux ${process.arch}`,
    };
  }
  const state = getLinuxLibrary();
  if ("failure" in state) {
    return state.failure;
  }
  const { library } = state;
  const result = library.symbols.syscall(
    syscallNumber,
    AT_FDCWD,
    cString(sourcePath),
    AT_FDCWD,
    cString(destinationPath),
    LINUX_RENAME_NOREPLACE
  );
  if (result === 0n) {
    return { kind: "installed" };
  }
  const errno = readErrno("Linux", library.symbols.__errno_location());
  if (errno === 17) {
    return { kind: "occupied" };
  }
  // ENOSYS, EINVAL, and EOPNOTSUPP mean the kernel or backing filesystem does
  // not provide the requested renameat2 guarantee.
  if (errno === 38 || errno === 22 || errno === 95) {
    return unsupportedNative("Linux", errno);
  }
  throw nativeFailure("Linux", errno, sourcePath, destinationPath);
};

// MoveFileExW still enforces MAX_PATH unless the path uses the extended \\?\
// prefix. Node's rename applied that automatically; keep the same form here.
export const toWindowsExtendedPath = (filePath: string): string =>
  nodePath.win32.toNamespacedPath(filePath);

const renameDirectoryNoReplaceWindows = (
  sourcePath: string,
  destinationPath: string
): DirectoryRenameNoReplaceResult => {
  const state = getWindowsLibrary();
  if ("failure" in state) {
    return state.failure;
  }
  const { library } = state;
  const source = Buffer.from(
    `${toWindowsExtendedPath(sourcePath)}\0`,
    "utf16le"
  );
  const destination = Buffer.from(
    `${toWindowsExtendedPath(destinationPath)}\0`,
    "utf16le"
  );
  const result = library.symbols.MoveFileExW(source, destination, 0);
  if (result !== 0) {
    return { kind: "installed" };
  }
  const nativeCode = library.symbols.GetLastError();
  if (
    nativeCode === WINDOWS_ERROR_FILE_EXISTS ||
    nativeCode === WINDOWS_ERROR_ALREADY_EXISTS
  ) {
    return { kind: "occupied" };
  }
  if (nativeCode === 1 || nativeCode === 50 || nativeCode === 120) {
    return unsupportedNative("Windows", nativeCode);
  }
  throw nativeFailure("Windows", nativeCode, sourcePath, destinationPath);
};

/**
 * Renames one staged directory to an absent destination in a single host
 * operation. The source and destination must be on the same filesystem.
 *
 * The function never emulates no-replace behavior with a check-then-rename
 * sequence. A host without the required primitive reports `unsupported` so
 * callers can fail closed without risking replacement.
 */
export const renameDirectoryNoReplace = (
  sourcePath: string,
  destinationPath: string
): DirectoryRenameNoReplaceResult => {
  if (process.platform === "darwin") {
    return renameDirectoryNoReplaceDarwin(sourcePath, destinationPath);
  }
  if (process.platform === "linux") {
    return renameDirectoryNoReplaceLinux(sourcePath, destinationPath);
  }
  if (process.platform === "win32") {
    return renameDirectoryNoReplaceWindows(sourcePath, destinationPath);
  }
  return {
    kind: "unsupported",
    reason: `atomic no-replace directory rename is not implemented for ${process.platform}`,
  };
};
