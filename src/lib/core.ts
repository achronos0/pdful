/**
 * Core utilities
 *
 * @module
 */

/**
 * Literal data used during pdf processing
 */
export class Constants {
	static create () {
		const constants = new Constants()
		constants.init()
		return constants
	}

	get VERSION_DATA (): { [version: string]: {} } {
		return {
			'1.0': {},
			'1.1': {},
			'1.2': {},
			'1.3': {},
			'1.4': {},
			'1.5': {},
			'1.6': {},
			'1.7': {},
			'2.0': {}
		}
	}

	get TOKEN_BYTE_SPACE () {
		return [0, 9, 10, 12, 13, 32]
	}
	get TOKEN_BYTE_EOL () {
		return [10]
	}
	get TOKEN_BYTE_GREATERTHAN () {
		return [this.byteChar('>')]
	}
	get TOKEN_BYTE_NAME () {
		return [...this.byteCharRange('!', '~', '%()[]<>')]
	}
	get TOKEN_BYTE_PAREN () {
		return [this.byteChar('('), this.byteChar(')')]
	}
	get TOKEN_BYTE_DIGIT () {
		return [...this.byteCharRange('0', '9', '')]
	}
	get TOKEN_BYTE_NUMBER () {
		return [
			this.byteChar('+'),
			this.byteChar('-'),
			this.byteChar('.'),
			...this.TOKEN_BYTE_DIGIT
		]
	}
	get TOKEN_BYTE_KEYWORD () {
		return [
			...this.byteCharRange('a', 'z', ''),
			...this.byteCharRange('A', 'Z', '')
		]
	}

	/**
	 * Prepare constants for use
	 */
	init () {
		this.memoize()
	}

	/**
	 * Return int codepoint for byte
	 */
	byteChar (char: string): number {
		return char.charCodeAt(0)
	}

	/**
	 * Return int codepoint array for byte range
	 */
	byteIntRange (from: number, to: number, exclude: number[]): number[] {
		const bytes = []
		for (let value = from; value <= to; value++) {
			if (exclude.includes(value)) {
				continue
			}
			bytes.push(value)
		}
		return bytes
	}

	/**
	 * Return int codepoint array for character range
	 */
	byteCharRange (from: string, to: string, exclude: string): number[] {
		const fromByte = this.byteChar(from)
		const toByte = this.byteChar(to)
		const excludeByte = []
		for (let index = 0; index < exclude.length; index++) {
			excludeByte.push(exclude.charCodeAt(index))
		}
		return this.byteIntRange(fromByte, toByte, excludeByte)
	}

	/**
	 * Convert this object's constant getters into values
	 *
	 * Replaces each `get CONSTANT()` with its value.
	 */
	memoize () {
		const props = Object.getOwnPropertyDescriptors(this)
		const finalProps: PropertyDescriptorMap = {}
		for (const prop in props) {
			const def = props[prop]
			if (def.get && /^[A-Z]+$/.test(prop)) {
				const value = def.get.call(this)
				finalProps[prop] = { value }
			}
		}
		if (Object.keys(finalProps).length) {
			Object.defineProperties(this, finalProps)
		}
	}
}

/**
 * Error during pdf processing
 */
export class PdfError extends Error {
	code: string
	data: any
	/**
	 * Create a PDF error
	 *
	 * @param {string} message error message
	 * @param {string} code error code string
	 * @param {any} data additional data to store with error
	 */
	constructor (message: string, code: string, data: any = undefined) {
		super(message)
		this.code = 'pdf:' + code
		this.data = data
	}
}
