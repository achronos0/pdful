/**
 * Node.js extensions to io component
 *
 * Read/write to/from file
 *
 * @module
 */

import { io } from '../components/io.js'

type FileHandle = import('node:fs/promises').FileHandle

export namespace nodeIo {
	export const SequentialReader = io.SequentialReader
	export const SequentialMemoryReader = io.SequentialMemoryReader
	export const OffsetReader = io.OffsetReader
	export const OffsetMemoryReader = io.OffsetMemoryReader
	export const createReaderFromArray = io.createReaderFromArray
	export type ReaderPair = io.ReaderPair

	/**
	 * Sequential file data reader for {@link Tokenizer}
	 */
	export class SequentialFileReader extends io.SequentialReader {
		static get DEFAULT_CHUNK_SIZE () {
			return 134217728
		}

		readonly fileHandle: FileHandle
		readonly fileSize: number
		protected buffer: Buffer
		protected bytes: Uint8Array
		protected bufferOffset: number
		protected bufferLength: number

		/**
		 * Create data reader from file handle and size
		 *
		 * @param {number} fileSize file length in bytes
		 * @param {number} bufferLength read chunk size in bytes
		 */
		constructor (fileHandle: FileHandle, fileSize: number, bufferLength: number) {
			super(fileSize)
			this.fileHandle = fileHandle
			this.fileSize = fileSize
			this.buffer = Buffer.allocUnsafe(bufferLength)
			this.bytes = new Uint8Array(this.buffer.buffer)
			this.bufferOffset = -1
			this.bufferLength = bufferLength
		}

		/**
		 * Read next byte as int
		 *
		 * @param consume true to consume the byte, false to let it be read again
		 * @returns byte int value
		 */
		async readByte (consume: boolean): Promise<number> {
			if (this.eof) {
				return -1
			}
			await this._preread()
			const value = this.bytes.at(this.offset - this.bufferOffset)
			if (consume) {
				this.consume(1)
			}
			return value || 0
		}

		/**
		 * Read next bytes as int array
		 *
		 * @param length number of bytes to read
		 * @param consume true to consume the bytes, false to let them be read again
		 * @returns byte int array
		 */
		async readArray (length: number, consume: boolean): Promise<Uint8Array> {
			await this._preread()
			const start = this.offset - this.bufferOffset
			const end = start + length
			const data = Uint8Array.from(this.bytes.subarray(start, end))
			if (consume) {
				this.consume(length)
			}
			return data
		}

		protected async _preread () {
			if (this.bufferOffset < 0) {
				const res = await this.fileHandle.read({
					buffer: this.buffer,
					offset: 0,
					length: this.bufferLength,
					position: 0
				})
				this.bufferLength = res.bytesRead
				this.bufferOffset = 0
				return
			}
			const KEEP_BYTES = 1024
			if (
				this.offset + KEEP_BYTES < this.length &&
				this.offset + KEEP_BYTES > this.bufferOffset + this.bufferLength
			) {
				// copy the first kb from end of buffer to start of buffer, and reset buffer offset
				this.buffer.copyWithin(0, -KEEP_BYTES)
				this.bufferOffset = this.bufferOffset + this.bufferLength - KEEP_BYTES
				const res = await this.fileHandle.read({
					buffer: this.buffer,
					offset: KEEP_BYTES,
					length: this.bufferLength - KEEP_BYTES,
					position: this.offset + KEEP_BYTES
				})
				this.bufferLength = res.bytesRead
			}
		}
	}

	/**
	 * Random-access file data reader
	 */
	export class OffsetFileReader extends io.OffsetReader {
		readonly fileHandle: FileHandle
		readonly fileSize: number

		/**
		 * Create data reader from file handle and size
		 *
		 * @param {number} fileSize file length in bytes
		 */
		constructor (fileHandle: FileHandle, fileSize: number) {
			super(fileSize)
			this.fileHandle = fileHandle
			this.fileSize = fileSize
		}

		/**
		 * Read bytes as int array
		 *
		 * @param start byte offset to start reading at
		 * @param end byte offset to stop reading at; the byte following the last byte of data to read
		 * @returns byte int array
		 */
		async readArray (start: number, end: number) {
			const buffer = Buffer.alloc(end - start)
			const res = await this.fileHandle.read({
				buffer,
				position: start,
				length: end - start
			})
			return new Uint8Array(res.buffer.buffer, 0, res.bytesRead)
		}
	}

	/**
	 * Create data reader from file handle
	 *
	 * @param fileHandle file handle object
	 */
	export async function createReaderFromFileHandle (fileHandle: FileHandle, bufferLength: number | null = null): Promise<io.ReaderPair> {
		const stat = await fileHandle.stat()
		const fileSize = stat.size
		const offsetReader = new OffsetFileReader(fileHandle, fileSize)
		const sequentialReader = new SequentialFileReader(fileHandle, fileSize, bufferLength || SequentialFileReader.DEFAULT_CHUNK_SIZE)
		return { offsetReader, sequentialReader }
	}
}
