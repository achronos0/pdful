/**
 * Constants and literal data
 *
 * @module
 */

/**
 * Portions of this class are originally from `pdf-lib` {@link https://github.com/Hopding/pdf-lib}.
 *
 * @author
 */

export namespace literals {
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
			return [10, 13]
		}
		get TOKEN_BYTE_GREATERTHAN () {
			return [this.byteChar('>')]
		}
		get TOKEN_BYTE_NAME () {
			return [...this.byteCharRange('!', '~', '%()/[]<>')]
		}
		get TOKEN_BYTE_STRINGPAREN () {
			return [this.byteChar('('), this.byteChar(')'), this.byteChar('\\')]
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
		get TOKEN_BYTE_ENDSTREAM () {
			return [...this.TOKEN_BYTE_EOL, this.byteChar('e')]
		}

		get LEXER_STRING_TESTS () {
			return {
				date: [this.byteChar('D'), this.byteChar(':')],
				utf8: [239, 187, 191],
				utf16be: [254, 255]
			}
		}

		get LEXER_DATE_REGEXP () {
			/*
				year
				month = '01'
				day = '01'
				hours = '00'
				mins = '00'
				secs = '00'
				offsetSign = 'Z'
				offsetHours = '00'
				offsetMins = '00'
			*/
			return /^(\d\d\d\d)(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?([+\-Z])?(\d\d)?'?(\d\d)?'?$/
		}

		get LEXER_PDFDOCENCODING_MAP (): {[byte: number]: number} {
			return {
				0x16: 0x0017, // SYNCRONOUS IDLE
				0x18: 0x02D8, // BREVE
				0x19: 0x02C7, // CARON
				0x1a: 0x02C6, // MODIFIER LETTER CIRCUMFLEX ACCENT
				0x1b: 0x02D9, // DOT ABOVE
				0x1c: 0x02DD, // DOUBLE ACUTE ACCENT
				0x1d: 0x02DB, // OGONEK
				0x1e: 0x02DA, // RING ABOVE
				0x1f: 0x02DC, // SMALL TILDE
				0x7f: 0xFFFD, // REPLACEMENT CHARACTER (box with questionmark)
				0x80: 0x2022, // BULLET
				0x81: 0x2020, // DAGGER
				0x82: 0x2021, // DOUBLE DAGGER
				0x83: 0x2026, // HORIZONTAL ELLIPSIS
				0x84: 0x2014, // EM DASH
				0x85: 0x2013, // EN DASH
				0x86: 0x0192, // LATIN SMALL LETTER SCRIPT F
				0x87: 0x2044, // FRACTION SLASH (solidus)
				0x88: 0x2039, // SINGLE LEFT-POINTING ANGLE QUOTATION MARK
				0x89: 0x203A, // SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
				0x8a: 0x2212, // MINUS SIGN
				0x8b: 0x2030, // PER MILLE SIGN
				0x8c: 0x201E, // DOUBLE LOW-9 QUOTATION MARK (quotedblbase)
				0x8d: 0x201C, // LEFT DOUBLE QUOTATION MARK (quotedblleft)
				0x8e: 0x201D, // RIGHT DOUBLE QUOTATION MARK (quotedblright)
				0x8f: 0x2018, // LEFT SINGLE QUOTATION MARK (quoteleft)
				0x90: 0x2019, // RIGHT SINGLE QUOTATION MARK (quoteright)
				0x91: 0x201A, // SINGLE LOW-9 QUOTATION MARK (quotesinglbase)
				0x92: 0x2122, // TRADE MARK SIGN
				0x93: 0xFB01, // LATIN SMALL LIGATURE FI
				0x94: 0xFB02, // LATIN SMALL LIGATURE FL
				0x95: 0x0141, // LATIN CAPITAL LETTER L WITH STROKE
				0x96: 0x0152, // LATIN CAPITAL LIGATURE OE
				0x97: 0x0160, // LATIN CAPITAL LETTER S WITH CARON
				0x98: 0x0178, // LATIN CAPITAL LETTER Y WITH DIAERESIS
				0x99: 0x017D, // LATIN CAPITAL LETTER Z WITH CARON
				0x9a: 0x0131, // LATIN SMALL LETTER DOTLESS I
				0x9b: 0x0142, // LATIN SMALL LETTER L WITH STROKE
				0x9c: 0x0153, // LATIN SMALL LIGATURE OE
				0x9d: 0x0161, // LATIN SMALL LETTER S WITH CARON
				0x9e: 0x017E, // LATIN SMALL LETTER Z WITH CARON
				0x9f: 0xFFFD, // REPLACEMENT CHARACTER (box with questionmark)
				0xa0: 0x20AC, // EURO SIGN
				0xad: 0xFFFD, // REPLACEMENT CHARACTER (box with questionmark)
			}
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
}
