/**
 * Core utilities
 *
 * @module
 */

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

export namespace util {
	export function isArrayOfNumber (val: unknown): val is number[] {
		if (!Array.isArray(val)) {
			return false
		}
		for (const el of val) {
			if (typeof el !== 'number') {
				return false
			}
		}
		return true
	}
}
