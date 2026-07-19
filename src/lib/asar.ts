import fs from 'node:fs';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
  chmodSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { ConfigurationError, OperationalError } from './errors.ts';

const UINT32_MAX = 0xffffffff;
const COPY_CHUNK_SIZE = 1024 * 1024;
const PICKLE_HEADER_SIZE = 4;
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;

type FsPath = string | URL;

export interface AsarPackedFile {
  readonly size: number;
  readonly offset: string;
  readonly executable?: boolean;
  readonly integrity?: Record<string, unknown>;
}

export interface AsarUnpackedFile {
  readonly size: number;
  readonly unpacked: true;
  readonly executable?: boolean;
  readonly integrity?: Record<string, unknown>;
}

export interface AsarLink {
  readonly link: string;
}

export interface AsarDirectory {
  readonly files: Record<string, AsarNode>;
  readonly unpacked?: true;
}

export type AsarNode = AsarDirectory | AsarPackedFile | AsarUnpackedFile | AsarLink;

export interface AsarHeader {
  readonly files: Record<string, AsarNode>;
}

interface ParsedArchive {
  readonly fd: number;
  readonly header: AsarHeader;
  readonly dataStart: bigint;
  readonly size: bigint;
}

interface LeafEntry {
  readonly path: string;
  readonly node: AsarPackedFile | AsarUnpackedFile | AsarLink;
}

interface SourceFile {
  readonly kind: 'file';
  readonly path: string;
  readonly size: number;
  readonly executable: boolean;
}

interface SourceDirectory {
  readonly kind: 'directory';
  readonly path: string;
  readonly children: Map<string, SourceFile | SourceDirectory>;
}

class ShortReadError extends Error {}

function invalid(message: string): never {
  throw new ConfigurationError(`malformed ASAR archive: ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pathComponent(component: string, context: string): void {
  if (component.length === 0 || component === '.' || component === '..') {
    invalid(`${context} contains an invalid path component`);
  }
  if (component.includes('/') || component.includes('\\') || component.includes('\0')) {
    invalid(`${context} contains an invalid path component`);
  }
}

function archivePath(path: string): string[] {
  if (path.length === 0 || path.includes('\\') || path.startsWith('/')) {
    throw new ConfigurationError(`invalid ASAR path: ${path}`);
  }
  const components = path.split('/');
  for (const component of components) pathComponent(component, `path ${JSON.stringify(path)}`);
  return components;
}

function readExactly(fd: number, length: number, position: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) throw new ShortReadError('invalid read length');
  const result = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = readSync(fd, result, read, length - read, position + read);
    if (count <= 0) throw new ShortReadError(`unexpected end of file at offset ${position + read}`);
    read += count;
  }
  return result;
}

function aligned4(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid('size is not a safe integer');
  const result = value + ((4 - (value % 4)) % 4);
  if (!Number.isSafeInteger(result) || result > UINT32_MAX) invalid('header size is too large');
  return result;
}

function ownKeysExactly(node: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(node).sort();
  const expected = [...allowed].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function ownKeysWithOptional(
  node: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(node);
  return required.every((key) => Object.hasOwn(node, key)) && keys.every((key) => allowed.has(key));
}

function validateSize(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${context} size must be a nonnegative safe integer`);
  }
  return value;
}

function validateLinkTarget(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
    invalid(`${context} link target is invalid`);
  }
  for (const component of value.split('/')) pathComponent(component, `${context} link target`);
  return value;
}

function validateNode(value: unknown, context: string, dataStart: bigint, archiveSize: bigint): AsarNode {
  if (!isPlainRecord(value)) invalid(`${context} must be an object`);

  if (Object.hasOwn(value, 'files')) {
    if (!ownKeysWithOptional(value, ['files'], ['unpacked']) || !isPlainRecord(value.files)) {
      invalid(`${context} directory node has an invalid shape`);
    }
    if (Object.hasOwn(value, 'unpacked') && value.unpacked !== true) {
      invalid(`${context} directory unpacked flag must be true`);
    }
    const files = value.files;
    for (const name of Object.keys(files)) {
      pathComponent(name, `${context} child name`);
      validateNode(files[name], `${context}/${name}`, dataStart, archiveSize);
    }
    return {
      files: files as Record<string, AsarNode>,
      ...(Object.hasOwn(value, 'unpacked') ? { unpacked: true as const } : {}),
    };
  }

  if (Object.hasOwn(value, 'link')) {
    if (!ownKeysExactly(value, ['link'])) invalid(`${context} link node has an invalid shape`);
    return { link: validateLinkTarget(value.link, context) };
  }

  if (!Object.hasOwn(value, 'size')) invalid(`${context} is not a recognized node`);
  const size = validateSize(value.size, context);
  const unpacked = Object.hasOwn(value, 'unpacked');
  if (unpacked) {
    if (value.unpacked !== true || !ownKeysWithOptional(value, ['size', 'unpacked'], ['executable', 'integrity'])) {
      invalid(`${context} unpacked node has an invalid shape`);
    }
    if (Object.hasOwn(value, 'executable') && typeof value.executable !== 'boolean') {
      invalid(`${context} executable must be boolean`);
    }
    if (Object.hasOwn(value, 'integrity') && !isPlainRecord(value.integrity)) {
      invalid(`${context} integrity must be an object`);
    }
    return {
      size,
      unpacked: true,
      ...(Object.hasOwn(value, 'executable') ? { executable: value.executable as boolean } : {}),
      ...(Object.hasOwn(value, 'integrity') ? { integrity: value.integrity as Record<string, unknown> } : {}),
    };
  }

  if (!ownKeysWithOptional(value, ['size', 'offset'], ['executable', 'integrity'])) {
    invalid(`${context} packed node has an invalid shape`);
  }
  if (typeof value.offset !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value.offset)) {
    invalid(`${context} offset must be a canonical decimal string`);
  }
  if (Object.hasOwn(value, 'executable') && typeof value.executable !== 'boolean') {
    invalid(`${context} executable must be boolean`);
  }
  if (Object.hasOwn(value, 'integrity') && !isPlainRecord(value.integrity)) {
    invalid(`${context} integrity must be an object`);
  }

  const offset = BigInt(value.offset);
  const end = dataStart + offset + BigInt(size);
  if (dataStart + offset > archiveSize || end > archiveSize) {
    invalid(`${context} data range is outside the archive`);
  }
  return {
    size,
    offset: value.offset,
    ...(Object.hasOwn(value, 'executable') ? { executable: value.executable as boolean } : {}),
    ...(Object.hasOwn(value, 'integrity') ? { integrity: value.integrity as Record<string, unknown> } : {}),
  };
}

function parseArchive(archive: FsPath): ParsedArchive {
  let fd: number;
  try {
    fd = fs.openSync(archive, 'r');
  } catch (error) {
    throw new OperationalError(`cannot open ASAR archive: ${String(archive)}`, { cause: error });
  }

  try {
    const archiveSizeNumber = Number(fstatSync(fd).size);
    if (!Number.isSafeInteger(archiveSizeNumber) || archiveSizeNumber < 8) invalid('archive is truncated');
    const size = BigInt(archiveSizeNumber);
    const outer = readExactly(fd, 8, 0);
    if (outer.readUInt32LE(0) !== PICKLE_HEADER_SIZE) invalid('outer pickle header size must be 4');
    const headerBufferLength = outer.readUInt32LE(4);
    if (headerBufferLength % 4 !== 0 || headerBufferLength < 12) invalid('header buffer length is invalid');
    const dataStart = 8n + BigInt(headerBufferLength);
    if (dataStart > size) invalid('header extends past end of archive');

    const headerBuffer = readExactly(fd, headerBufferLength, 8);
    const alignedPayloadSize = headerBuffer.readUInt32LE(0);
    const jsonLength = headerBuffer.readUInt32LE(4);
    if (alignedPayloadSize % 4 !== 0 || alignedPayloadSize < 8) invalid('aligned payload size is invalid');
    if (headerBufferLength !== alignedPayloadSize + 4) invalid('pickle payload size does not match header buffer length');
    if (jsonLength > alignedPayloadSize - 4) invalid('JSON length exceeds payload size');
    if (aligned4(jsonLength) !== alignedPayloadSize - 4) invalid('JSON payload is not correctly aligned');

    const jsonBytes = headerBuffer.subarray(8, 8 + jsonLength);
    for (let index = 8 + jsonLength; index < headerBuffer.length; index += 1) {
      if (headerBuffer[index] !== 0) invalid('header padding is not zero');
    }

    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
    } catch (error) {
      throw new ConfigurationError('malformed ASAR archive: header JSON is not valid UTF-8', { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded) as unknown;
    } catch (error) {
      throw new ConfigurationError('malformed ASAR archive: header JSON is invalid', { cause: error });
    }
    if (!isPlainRecord(parsed) || !ownKeysExactly(parsed, ['files']) || !isPlainRecord(parsed.files)) {
      invalid('header root must contain only a files object');
    }
    const files = parsed.files;
    for (const name of Object.keys(files)) {
      pathComponent(name, 'root child name');
      validateNode(files[name], name, dataStart, size);
    }
    return { fd, header: { files: files as Record<string, AsarNode> }, dataStart, size };
  } catch (error) {
    closeSync(fd);
    if (error instanceof ConfigurationError || error instanceof OperationalError) throw error;
    throw new OperationalError(`cannot read ASAR archive: ${String(archive)}`, { cause: error });
  }
}

function walkLeaves(files: Record<string, AsarNode>, prefix: string, output: LeafEntry[]): void {
  for (const name of Object.keys(files).sort()) {
    const node = files[name];
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    if (Object.hasOwn(node, 'files')) {
      walkLeaves((node as AsarDirectory).files, path, output);
    } else {
      output.push({ path, node: node as LeafEntry['node'] });
    }
  }
}

function findNode(header: AsarHeader, path: string): AsarNode {
  const components = archivePath(path);
  let node: AsarNode | undefined;
  let files = header.files;
  for (let index = 0; index < components.length; index += 1) {
    node = files[components[index] as string];
    if (node === undefined) throw new ConfigurationError(`ASAR path does not exist: ${path}`);
    if (index < components.length - 1) {
      if (!Object.hasOwn(node, 'files')) throw new ConfigurationError(`ASAR path is not a directory: ${path}`);
      files = (node as AsarDirectory).files;
    }
  }
  return node as AsarNode;
}

function absoluteDataPosition(dataStart: bigint, offset: string, size: number, archiveSize: bigint): number {
  const position = dataStart + BigInt(offset);
  const end = position + BigInt(size);
  if (end > archiveSize || position > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OperationalError('ASAR file data cannot be addressed by this runtime');
  }
  return Number(position);
}

function readRange(fd: number, position: number, size: number): Buffer {
  const output = Buffer.alloc(size);
  let done = 0;
  while (done < size) {
    const count = readSync(fd, output, done, size - done, position + done);
    if (count <= 0) throw new OperationalError('unexpected end of ASAR file data');
    done += count;
  }
  return output;
}

function writeAll(fd: number, buffer: Uint8Array): void {
  let done = 0;
  while (done < buffer.byteLength) {
    const count = writeSync(fd, buffer, done, buffer.byteLength - done);
    if (count <= 0) throw new OperationalError('failed to write ASAR archive');
    done += count;
  }
}

function copyRange(fdIn: number, fdOut: number, position: number, size: number): void {
  const buffer = Buffer.allocUnsafe(Math.min(COPY_CHUNK_SIZE, Math.max(1, size)));
  let done = 0;
  while (done < size) {
    const requested = Math.min(buffer.length, size - done);
    const count = readSync(fdIn, buffer, 0, requested, position + done);
    if (count <= 0) throw new OperationalError('source file ended while packing ASAR archive');
    writeAll(fdOut, buffer.subarray(0, count));
    done += count;
  }
}

function ensureSafeDirectory(directory: string, extractionRoot = directory): void {
  const absolute = resolve(directory);
  const root = resolve(extractionRoot);
  const rest = relative(root, absolute);
  if (rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest)) {
    throw new ConfigurationError(`extraction path escapes destination root: ${absolute}`);
  }

  let current = root;
  const components = rest.length === 0 ? [] : rest.split(sep);
  for (const component of ['', ...components]) {
    if (component.length > 0) {
      pathComponent(component, 'destination path');
      current = join(current, component);
    }
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new OperationalError(`cannot inspect extraction directory: ${current}`, { cause: error });
      }
      try {
        mkdirSync(current, { recursive: true });
      } catch (mkdirError) {
        throw new OperationalError(`cannot create extraction directory: ${current}`, { cause: mkdirError });
      }
      stats = lstatSync(current);
    }
    if (stats.isSymbolicLink()) throw new ConfigurationError(`refusing symlink in extraction path: ${current}`);
    if (!stats.isDirectory()) throw new OperationalError(`extraction path is not a directory: ${current}`);
  }
}

function checkOutputFile(path: string): void {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new ConfigurationError(`refusing symlink in extraction path: ${path}`);
    if (!stats.isFile()) throw new OperationalError(`extraction target is not a regular file: ${path}`);
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof OperationalError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new OperationalError(`cannot inspect extraction target: ${path}`, { cause: error });
    }
  }
}

function sourceError(path: string, error: unknown): OperationalError {
  return new OperationalError(`cannot read source path: ${path}`, { cause: error });
}

function scanSourceDirectory(path: string): SourceDirectory {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw sourceError(path, error);
  }
  if (stats.isSymbolicLink()) throw new ConfigurationError(`refusing symlink in source tree: ${path}`);
  if (!stats.isDirectory()) throw new ConfigurationError(`source path is not a directory: ${path}`);

  const children = new Map<string, SourceFile | SourceDirectory>();
  let names: string[];
  try {
    names = readdirSync(path);
  } catch (error) {
    throw sourceError(path, error);
  }
  names.sort();
  for (const name of names) {
    pathComponent(name, `source path ${path}`);
    const childPath = join(path, name);
    let childStats;
    try {
      childStats = lstatSync(childPath);
    } catch (error) {
      throw sourceError(childPath, error);
    }
    if (childStats.isSymbolicLink()) throw new ConfigurationError(`refusing symlink in source tree: ${childPath}`);
    if (childStats.isDirectory()) {
      children.set(name, scanSourceDirectory(childPath));
      continue;
    }
    if (!childStats.isFile()) throw new ConfigurationError(`unsupported source file type: ${childPath}`);
    const size = Number(childStats.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > UINT32_MAX) {
      throw new ConfigurationError(`source file size is outside ASAR limits: ${childPath}`);
    }
    children.set(name, {
      kind: 'file',
      path: childPath,
      size,
      executable: process.platform !== 'win32' && (childStats.mode & 0o111) !== 0,
    });
  }
  return { kind: 'directory', path, children };
}

interface BuildContext {
  offset: bigint;
  files: SourceFile[];
}

function buildDirectoryNode(directory: SourceDirectory, context: BuildContext): AsarDirectory {
  const files = Object.create(null) as Record<string, AsarNode>;
  for (const [name, child] of directory.children) {
    if (child.kind === 'directory') {
      files[name] = buildDirectoryNode(child, context);
    } else {
      const node: AsarPackedFile = {
        size: child.size,
        offset: context.offset.toString(),
        ...(child.executable ? { executable: true } : {}),
      };
      files[name] = node;
      context.files.push(child);
      context.offset += BigInt(child.size);
    }
  }
  return { files };
}

function writeHeader(fd: number, header: AsarHeader): void {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const paddedJsonLength = aligned4(json.length);
  const alignedPayloadSize = PICKLE_HEADER_SIZE + paddedJsonLength;
  const headerBufferLength = PICKLE_HEADER_SIZE + alignedPayloadSize;
  if (headerBufferLength > UINT32_MAX) invalid('header size is too large');

  const outer = Buffer.alloc(8);
  outer.writeUInt32LE(PICKLE_HEADER_SIZE, 0);
  outer.writeUInt32LE(headerBufferLength, 4);
  writeAll(fd, outer);

  const payloadHeader = Buffer.alloc(8);
  payloadHeader.writeUInt32LE(alignedPayloadSize, 0);
  payloadHeader.writeUInt32LE(json.length, 4);
  writeAll(fd, payloadHeader);
  writeAll(fd, json);
  if (paddedJsonLength > json.length) writeAll(fd, Buffer.alloc(paddedJsonLength - json.length));
}

function openSourceFile(path: string): number {
  try {
    return openSync(path, NO_FOLLOW === 0 ? 'r' : fsConstants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    throw sourceError(path, error);
  }
}

function replaceArchive(temp: string, destination: string): void {
  try {
    if (process.platform === 'win32') {
      try {
        renameSync(temp, destination);
      } catch (error) {
        if (!existsSync(destination)) throw error;
        unlinkSync(destination);
        renameSync(temp, destination);
      }
    } else {
      renameSync(temp, destination);
    }
    syncDirectory(dirname(resolve(destination)));
  } catch (error) {
    throw new OperationalError(`cannot install ASAR archive: ${destination}`, { cause: error });
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return;
  let fd: number;
  try {
    fd = openSync(directory, 'r');
  } catch (error) {
    throw new OperationalError(`cannot open parent directory for sync: ${directory}`, { cause: error });
  }
  try {
    fsyncSync(fd);
  } catch (error) {
    throw new OperationalError(`cannot sync parent directory: ${directory}`, { cause: error });
  } finally {
    closeSync(fd);
  }
}

/** Parse and validate an ASAR header, including every packed-file data range. */
export function readHeader(archive: FsPath): AsarHeader {
  const parsed = parseArchive(archive);
  try {
    return parsed.header;
  } finally {
    closeSync(parsed.fd);
  }
}

/** Return packed, unpacked, and link leaf paths in deterministic lexical order. */
export function listFiles(archive: FsPath): string[] {
  const parsed = parseArchive(archive);
  try {
    const leaves: LeafEntry[] = [];
    walkLeaves(parsed.header.files, '', leaves);
    return leaves.map((entry) => entry.path);
  } finally {
    closeSync(parsed.fd);
  }
}

/** Extract one packed file as a Buffer. Directories, links, and unpacked files are rejected. */
export function extractFile(archive: FsPath, innerPath: string): Buffer {
  const parsed = parseArchive(archive);
  try {
    const node = findNode(parsed.header, innerPath);
    if (Object.hasOwn(node, 'files')) throw new ConfigurationError(`ASAR path is a directory: ${innerPath}`);
    if (Object.hasOwn(node, 'link')) throw new ConfigurationError(`cannot extract ASAR link: ${innerPath}`);
    if (Object.hasOwn(node, 'unpacked')) throw new ConfigurationError(`ASAR file is unpacked: ${innerPath}`);
    const packed = node as AsarPackedFile;
    const position = absoluteDataPosition(parsed.dataStart, packed.offset, packed.size, parsed.size);
    return readRange(parsed.fd, position, packed.size);
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof OperationalError) throw error;
    throw new OperationalError(`cannot extract ASAR file: ${innerPath}`, { cause: error });
  } finally {
    closeSync(parsed.fd);
  }
}

/** Extract all packed files, reporting unpacked entries and refusing links or symlink paths. */
export function extractAll(
  archive: FsPath,
  destination: FsPath,
  onSkippedUnpacked?: (path: string) => void,
): string[] {
  const parsed = parseArchive(archive);
  try {
    const leaves: LeafEntry[] = [];
    walkLeaves(parsed.header.files, '', leaves);
    if (leaves.some((entry) => Object.hasOwn(entry.node, 'link'))) {
      throw new ConfigurationError('cannot extract ASAR links');
    }
    const skipped: string[] = [];
    const destinationPath = typeof destination === 'string' ? resolve(destination) : fileURLToPath(destination);
    ensureSafeDirectory(destinationPath);

    for (const entry of leaves) {
      if (Object.hasOwn(entry.node, 'unpacked')) {
        skipped.push(entry.path);
        onSkippedUnpacked?.(entry.path);
        continue;
      }
      const packed = entry.node as AsarPackedFile;
      const outputPath = join(destinationPath, ...archivePath(entry.path));
      ensureSafeDirectory(dirname(outputPath), destinationPath);
      checkOutputFile(outputPath);
      let outputFd: number;
      try {
        const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | NO_FOLLOW;
        outputFd = openSync(outputPath, flags, 0o644);
      } catch (error) {
        throw new OperationalError(`cannot create extracted file: ${outputPath}`, { cause: error });
      }
      try {
        const position = absoluteDataPosition(parsed.dataStart, packed.offset, packed.size, parsed.size);
        copyRange(parsed.fd, outputFd, position, packed.size);
        if (packed.executable) chmodSync(outputPath, 0o755);
      } finally {
        closeSync(outputFd);
      }
    }
    return skipped;
  } finally {
    closeSync(parsed.fd);
  }
}

/** Pack a directory into an inline ASAR archive using a transactional same-directory replace. */
export function packDirInline(sourceDirectory: string, destination: string): void {
  const source = resolve(sourceDirectory);
  const target = resolve(destination);
  const tree = scanSourceDirectory(source);
  const context: BuildContext = { offset: 0n, files: [] };
  const header = buildDirectoryNode(tree, context);
  const archiveHeader: AsarHeader = { files: header.files };
  const parent = dirname(target);
  const temp = join(parent, `.${parse(target).base}.tmp-${process.pid}-${randomUUID()}`);
  let tempFd: number | undefined;
  let createdFd: number;
  let committed = false;
  try {
    try {
      createdFd = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o644);
      tempFd = createdFd;
      writeHeader(createdFd, archiveHeader);
    } catch (error) {
      throw new OperationalError(`cannot create temporary ASAR archive: ${temp}`, { cause: error });
    }
    for (const file of context.files) {
      let sourceFd: number | undefined;
      try {
        sourceFd = openSourceFile(file.path);
        const current = fstatSync(sourceFd);
        if (!current.isFile() || Number(current.size) !== file.size) {
          throw new OperationalError(`source file changed while packing: ${file.path}`);
        }
        copyRange(sourceFd, createdFd, 0, file.size);
        const after = fstatSync(sourceFd);
        if (!after.isFile() || Number(after.size) !== file.size) {
          throw new OperationalError(`source file changed while packing: ${file.path}`);
        }
      } catch (error) {
        if (error instanceof OperationalError || error instanceof ConfigurationError) throw error;
        throw sourceError(file.path, error);
      } finally {
        if (sourceFd !== undefined) closeSync(sourceFd);
      }
    }
    fsyncSync(createdFd);
    closeSync(createdFd);
    tempFd = undefined;
    replaceArchive(temp, target);
    committed = true;
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    if (!committed) {
      try {
        unlinkSync(temp);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // The original failure is more useful than best-effort temporary cleanup.
        }
      }
    }
  }
}
