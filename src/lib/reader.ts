/**
 * Read raw document data from file or a variable
 *
 * @module
 */

type FileHandle = import('node:fs/promises').FileHandle

/**
 * Base class for data readers used by {@link Tokenizer}
 */
export class SequentialReader {
	/**
	 * Total byte length of document data
	 */
	readonly length: number
	protected _offset: number
	protected readonly decoder = new TextDecoder('latin1')
	/**
	 * Base constructor for SequentialReader classes
	 *
	 * @param length data length in bytes
	 */
	constructor (length: number) {
		this.length = length
		this._offset = 0
	}

	/**
	 * Current byte offset into document data
	 */
	get offset () {
		return this._offset
	}

	/**
	 * Is the reader at the end of the document data
	 */
	get eof () {
		return this.offset >= this.length
	}

	/**
	 * Advance the current byte offset
	 *
	 * @param length number of bytes to advance
	 * @returns {boolean} is at end of file
	 */
	consume (length: number): boolean {
		if (!this.eof) {
			this._offset += length
			if (this.offset >= this.length) {
				this._offset = this.length
			}
		}
		return this.eof
	}

	/**
	 * Read next byte as int
	 *
	 * @abstract
	 * @param consume true to consume the byte, false to let it be read again
	 * @returns byte int value
	 */
	async readByte (consume: boolean): Promise<number> {
		throw new Error('abstract')
	}

	/**
	 * Read next bytes as int array
	 *
	 * @abstract
	 * @param length number of bytes to read
	 * @param consume true to consume the bytes, false to let them be read again
	 * @returns byte int array
	 */
	async readArray (length: number, consume: boolean): Promise<Uint8Array> {
		throw new Error('abstract')
	}

	/**
	 * Read next bytes as int array, while byte int value matches test value
	 *
	 * Consumes the read bytes.
	 *
	 * @param testByte values to match
	 * @returns byte int array
	 */
	async readArrayWhile (testByte: number[]): Promise<Uint8Array> {
		const data = []
		while (!this.eof) {
			const value = await this.readByte(false)
			if (testByte.includes(value)) {
				this.consume(1)
				data.push(value)
			}
			else {
				break
			}
		}
		return Uint8Array.from(data)
	}

	/**
	 * Read next bytes as int array, until byte int value matches test value
	 *
	 * Consumes the read bytes.
	 *
	 * @param testByte values to match
	 * @param consumeTerminator true to consume the byte that matches, false to let it be read again
	 * @returns byte int array
	 */
	async readArrayUntil (testByte: number[], consumeTerminator: boolean): Promise<Uint8Array> {
		const data = []
		while (!this.eof) {
			const value = await this.readByte(false)
			if (testByte.includes(value)) {
				if (consumeTerminator) {
					this.consume(1)
					data.push(value)
				}
				break
			}
			else {
				this.consume(1)
				data.push(value)
			}
		}
		return Uint8Array.from(data)
	}

	/**
	 * Read next byte as ascii single character
	 *
	 * @param consume true to consume the byte, false to let it be read again
	 * @returns ascii single character
	 */
	async readChar (consume: boolean): Promise<string> {
		const value = await this.readByte(consume)
		return this.byteToString(value)
	}

	/**
	 * Read next bytes as ascii string
	 *
	 * @param length number of bytes to read
	 * @param consume true to consume the bytes, false to let them be read again
	 * @returns ascii string
	 */
	async readString (length: number, consume: boolean): Promise<string> {
		const data = await this.readArray(length, consume)
		return this.arrayToString(data)
	}

	/**
	 * Read next bytes as ascii string, while byte int value matches test value
	 *
	 * Consumes the read bytes.
	 *
	 * @param testByte values to match
	 * @returns ascii string
	 */
	async readStringWhile (testByte: number[]): Promise<string> {
		const data = await this.readArrayWhile(testByte)
		return this.arrayToString(data)
	}

	/**
	 * Read next bytes as ascii string, until byte int value matches test value
	 *
	 * Consumes the read bytes.
	 *
	 * @param testByte values to match
	 * @param consumeTerminator true to consume the byte that matches, false to let it be read again
	 * @returns ascii string
	 */
	async readStringUntil (testByte: number[], consumeTerminator: boolean): Promise<string> {
		const data = await this.readArrayUntil(testByte, consumeTerminator)
		return this.arrayToString(data)
	}

	/**
	 * Convert byte int value to ascii single character
	 *
	 * @param value byte int value
	 * @returns ascii single character
	 */
	byteToString (value: number): string {
		return String.fromCharCode(value)
	}

	/**
	 * Convert byte int array to ascii string
	 *
	 * @param data byte int array
	 * @returns ascii string
	 */
	arrayToString (data: Uint8Array): string {
		return this.decoder.decode(data)
	}
}

/**
 * File data reader for {@link Tokenizer}
 */
export class SequentialFileReader extends SequentialReader {
	/**
	 *
	 * @param fileHandle file handle object
	 * @param bufferLength read chunk size in bytes, null to use default
	 */
	static async createFromFileHandle (fileHandle: FileHandle, bufferLength: number | null = null): Promise<SequentialFileReader> {
		const stat = await fileHandle.stat()
		const fileSize = stat.size
		return new SequentialFileReader(fileHandle, fileSize, bufferLength || this.DEFAULT_CHUNK_SIZE)
	}

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
	 * Create data reader from file handle
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
			console.log('A bytesRead=', res.bytesRead)
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
			console.log('B bytesRead=', res.bytesRead)
			this.bufferLength = res.bytesRead
		}
	}
}

/**
 * In-memory data reader for {@link Tokenizer}
 */
export class SequentialMemoryReader extends SequentialReader {
	/**
	 * Create data reader from in-memory data
	 *
	 * bytes buffer containing document data
	 */
	static createFromArray (bytes: Uint8Array) {
		return new SequentialMemoryReader(bytes)
	}

	readonly bytes: Uint8Array

	/**
	 * Create data reader from in-memory data
	 *
	 * @param bytes buffer containing document data
	 */
	constructor (bytes: Uint8Array) {
		super(bytes.length)
		this.bytes = bytes
	}

	/**
	 * Read next byte as int
	 *
	 * @param {boolean} consume true to consume the byte, false to let it be read again
	 * @returns {Promise<number>} byte int value
	 */
	async readByte (consume: boolean): Promise<number> {
		if (this.eof) {
			return -1
		}
		const value = this.bytes.at(this.offset)
		if (consume) {
			this.consume(1)
		}
		return value || 0
	}

	/**
	 * Read next bytes as int array
	 *
	 * @param {number} length number of bytes to read
	 * @param {boolean} consume true to consume the bytes, false to let them be read again
	 * @returns {Promise<Uint8Array>} byte int array
	 */
	async readArray (length: number, consume: boolean): Promise<Uint8Array> {
		const start = this.offset
		const end = start + length
		const data = Uint8Array.from(this.bytes.subarray(start, end))
		if (consume) {
			this.consume(length)
		}
		return data
	}
}
