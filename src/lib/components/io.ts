/**
 * Read/write raw document data from/to file or memory
 *
 * @module
 */

export namespace io {
	/**
	 * Base class for sequential data reader implementations
	 */
	export abstract class SequentialReader {
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
	 * Sequential in-memory data reader for {@link Tokenizer}
	 */
	export class SequentialMemoryReader extends SequentialReader {
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

	/**
	 * Base class for random-access data readers
	 */
	export abstract class OffsetReader {
		/**
		 * Total byte length of document data
		 */
		readonly length: number
		/**
		 * Base constructor for OffsetReader classes
		 *
		 * @param length data length in bytes
		 */
		constructor (length: number) {
			this.length = length
		}

		/**
		 * Read bytes as int array
		 *
		 * @abstract
		 * @param start byte offset to start reading at
		 * @param end byte offset to stop reading at; the byte following the last byte of data to read
		 * @returns byte int array
		 */
		async readArray (start: number, end: number): Promise<Uint8Array> {
			throw new Error('abstract')
		}
	}

	/**
	 * Random-access in-memory data reader
	 */
	export class OffsetMemoryReader extends OffsetReader {
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
		 * Read bytes as int array
		 *
		 * @param start byte offset to start reading at
		 * @param end byte offset to stop reading at; the byte following the last byte of data to read
		 * @returns byte int array
		 */
		async readArray (start: number, end: number) {
			return this.bytes.subarray(start, end)
		}
	}

	/**
	 * Create data reader from in-memory data
	 *
	 * @param bytes buffer containing document data
	 */
	export function createReaderFromArray (bytes: Uint8Array): ReaderPair {
		const offsetReader = new OffsetMemoryReader(bytes)
		const sequentialReader = new SequentialMemoryReader(bytes)
		return { offsetReader, sequentialReader }
	}

	export interface ReaderPair {
		readonly offsetReader: OffsetReader
		readonly sequentialReader: SequentialReader
	}
}
