/**
 * Convert document data from a byte array into a sequence of syntax tokens.
 *
 * Tokenizer is the first stage of parsing.
 *
 * @module
 */

import { PdfError } from '../core.js'
import type { engine } from './engine.js'
import type { io } from './io.js'

export namespace tokenizer {
	/**
	 * Reads pdf document data and interprets syntax to produce a sequence of tokens
	 *
	 * This is the first stage of the parser process.
	 */
	export class Tokenizer {
		readonly engine: engine.Engine
		readonly reader: io.SequentialReader

		/**
		 * Create pdf document tokenizer
		 */
		constructor (config: {
			engine: engine.Engine,
			sequentialReader: io.SequentialReader
		}) {
			this.engine = config.engine
			this.reader = config.sequentialReader
		}

		/**
		 * Return an async iterator that generates tokens
		 */
		async *tokens (): AsyncGenerator<Token> {
			const tokens: Token[] = []
			while (!this.reader.eof) {
				const token = await this._nextRawToken()
				let keep = true
				let push = true
				switch (token.type) {
					case 'space':
						keep = false
						push = false
						break
					case 'junk':
						if (tokens.length && tokens[tokens.length - 1].type === 'junk') {
							tokens[tokens.length - 1].end = token.end
							keep = false
						}
					case 'integer':
						push = false
						break
					case 'indirect_start':
					case 'ref':
						const objTokens = tokens.splice(tokens.length - 2, 2)
						let num: number
						let gen: number
						if (
							objTokens.length !== 2 ||
							objTokens[0].type !== 'integer' ||
							objTokens[1].type !== 'integer'
						) {
							token.warning = new PdfError(`Invalid token (${token.type}) at offset ${token.start}`, `tokenizer:invalid_token:${token.type}`, { token })
							num = -1
							gen = -1
						}
						else {
							num = objTokens[0].value
							gen = objTokens[1].value
						}
						token.value = { num, gen }
						break
				}
				if (keep) {
					tokens.push(token)
				}
				if (push) {
					for (const token of tokens.splice(0, tokens.length)) {
						yield token
					}
				}
				if (token.warning && token.warning.data.token == null) {
					token.warning.data.token = token
				}
			}
			for (const token of tokens) {
				yield token
			}
		}

		/**
		 * @internal
		 */
		async _nextRawToken (): Promise<Token> {
			const chomp = (str: string) => str.replace(/[\r\n]+$/, '')
			const start = this.reader.offset
			const byte = await this.reader.readByte(true)
			const char = this.reader.byteToString(byte)
			let warning: PdfError | null = null

			// space
			if (this.engine.constants.TOKEN_BYTE_SPACE.includes(byte)) {
				const str = char + await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_SPACE)
				const end = this.reader.offset
				return { type: 'space', start, end, value: str, warning }
			}

			// comment
			if (char === '%') {
				const raw = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
				const end = this.reader.offset
				let str = chomp(raw)
				if (str.length === raw.length) {
					warning = new PdfError(`Unterminated token (comment) at offset ${start}`, 'tokenizer:unexpected_eof:comment', { offset: start })
				}
				return { type: 'comment', start, end, value: str, warning }
			}

			// array_start
			if (char === '[') {
				return { type: 'array_start', start, end: start + 1, value: null, warning }
			}

			// array_end
			if (char === ']') {
				return { type: 'array_end', start, end: start + 1, value: null, warning }
			}

			// dictionary_start
			// hexstring
			if (char === '<') {
				const next = await this.reader.readChar(false)
				if (next === '<') {
					this.reader.consume(1)
					return { type: 'dictionary_start', start, end: start + 2, value: null, warning }
				}

				const raw = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_GREATERTHAN, true)
				const end = this.reader.offset
				let hex
				if (raw.substring(raw.length - 1) === '>') {
					hex = raw.substring(0, raw.length - 1)
				}
				else {
					hex = raw
					warning = new PdfError(`Unterminated token (hexstring) at offset ${start}`, 'tokenizer:unexpected_eof:hexstring', { offset: start })
				}
				const data = []
				for (let index = 0; index < hex.length; index += 2) {
					let digit = hex.substring(index, index + 2)
					if (digit.length === 1) {
						digit += '0'
					}
					data.push(parseInt(digit, 16))
				}
				return { type: 'hexstring', start, end, value: data, warning }
			}

			// dictionary_end
			if (char === '>') {
				const next = await this.reader.readChar(false)
				if (next === '>') {
					this.reader.consume(1)
					return { type: 'dictionary_end', start, end: start + 2, value: null, warning }
				}
				return { type: 'junk', start, end: start + 1, value: char, warning }
			}

			// name
			if (char === '/') {
				const raw = await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_NAME)
				const end = this.reader.offset
				const str = raw.replace(/#([0-9a-fA-F]{2})/g, (_all, hex) => {
					const byte = parseInt(hex, 16)
					return String.fromCharCode(byte)
				})
				return { type: 'name', start, end, value: str, warning }
			}

			// string
			if (char === '(') {
				const strParts = []
				let depth = 1
				while (depth && !this.reader.eof) {
					const raw = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_STRINGPAREN, true)
					const char = raw.substring(raw.length - 1)
					switch (char) {
						case '\\': {
							strParts.push(raw)
							const next = await this.reader.readChar(true)
							strParts.push(next)
							break
						}
						case '(':
							depth++
							strParts.push(raw)
							break
						default: // ')'
							depth--
							if (depth) {
								strParts.push(raw)
							}
							else {
								strParts.push(raw.substring(0, raw.length - 1))
							}
					}
				}
				if (depth) {
					warning = new PdfError(`Unterminated token (string) at offset ${start}`, 'tokenizer:unexpected_eof:string', { offset: start })
				}
				const end = this.reader.offset
				const str = strParts
					.join('')
					.replace(/\\(?:(\d{1,3})|(.))/g, (_all, oct, esc) => {
						if (oct) {
							const byte = parseInt(oct, 8)
							return String.fromCharCode(byte)
						}
						switch (esc) {
							case 'n':
								return '\n'
							case 'r':
								return '\r'
							case 't':
								return String.fromCharCode(0x09)
							case 'b':
								return String.fromCharCode(0x08)
							case 'f':
								return String.fromCharCode(0x0C)
							case '(':
							case ')':
							case '\\':
								return esc
						}
						return ''
					})
				const data: number[] = []
				for (let index = 0; index < str.length; index++) {
					data.push(str.charCodeAt(index))
				}
				return { type: 'string', start, end, value: data, warning }
			}

			// integer
			// real (number)
			if (this.engine.constants.TOKEN_BYTE_NUMBER.includes(byte)) {
				const raw = char + await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_NUMBER)
				const end = this.reader.offset
				let num
				if (raw.includes('.')) {
					num = parseFloat(raw)
				}
				else {
					num = parseInt(raw)
				}
				if (Number.isNaN(num)) {
					num = 0
					warning = new PdfError(`Invalid token (real number) "${raw}" at offset ${start}`, 'tokenizer:invalid_token:real', { offset: start, type: 'real' })
				}
				let type: 'integer' | 'real'
				if (Number.isInteger(num)) {
					type = 'integer'
				}
				else {
					type = 'real'
				}
				return { type: type, start, end, value: num, warning }
			}

			// null
			// boolean
			// indirect_start
			// indirect_end
			// ref (indirect object reference)
			// stream
			// xref
			// trailer
			// eof
			// command
			if (this.engine.constants.TOKEN_BYTE_KEYWORD.includes(byte)) {
				const keyword = char + await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_KEYWORD)
				const end = this.reader.offset
				switch (keyword) {
					case 'null':
						return { type: 'null', start, end, value: null, warning }
					case 'true':
						return { type: 'boolean', start, end, value: true, warning }
					case 'false':
						return { type: 'boolean', start, end, value: false, warning }
					case 'obj':
						return { type: 'indirect_start', start, end, value: { num: -1, gen: -1 }, warning }
					case 'endobj':
						return { type: 'indirect_end', start, end, value: null, warning }
					case 'R':
						return { type: 'ref', start, end, value: { num: 0, gen: 0 }, warning }
					case 'stream': {
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						const streamStart = this.reader.offset
						let streamEnd = null
						while (!this.reader.eof) {
							let byte = await this.reader.readByte(true)
							if (this.engine.constants.TOKEN_BYTE_ENDSTREAM.includes(byte)) {
								const char = String.fromCharCode(byte)
								const str = char + await this.reader.readString(11, false)
								const m = /^(?:\r\n|\r|\n)?endstream[\r\n]/.exec(str)
								if (m) {
									const len = m[0].length
									this.reader.consume(len - 1)
									streamEnd = this.reader.offset - len
									break
								}
							}
						}
						if (!streamEnd) {
							warning = new PdfError(`Unterminated token (stream) at offset ${start}`, 'tokenizer:unexpected_eof:stream', { offset: start, type: 'stream' })
							streamEnd = this.reader.offset
						}
						return { type: 'stream', start, end, value: { start: streamStart, end: streamEnd }, warning }
					}
					case 'xref': {
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						const headStr = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, false)
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						const m = /^(\d+) (\d+)/.exec(headStr)
						if (!m) {
							warning = new PdfError(`Invalid token (xref head) "${headStr}" at offset ${start}`, 'tokenizer:invalid_token:xref:head', { offset: start, type: 'xref' })
							break
						}
						const startNum = parseInt(m[1])
						const objCount = parseInt(m[2])
						const objs: Array<[field1: number, field2: number, type: string]> = []
						for (let lineIndex = 0; lineIndex < objCount; lineIndex++) {
							const lineStr = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, false)
							await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
							const m = /^(\d+) (\d+) ([nf])/.exec(lineStr)
							if (!m) {
								warning = new PdfError(`Invalid token (xref entry) "${lineStr}" at offset ${start}`, 'tokenizer:invalid_token:xref:entry', { offset: start, type: 'xref' })
								continue
							}
							const field1 = parseInt(m[1])
							const field2 = parseInt(m[2])
							const type = m[3]
							objs.push([field1, field2, type])
						}
						const end = this.reader.offset
						return { type: 'xref', start, end, value: { startNum, objs }, warning }
					}
					case 'trailer': {
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						const end = this.reader.offset
						return { type: 'trailer', start, end, value: null, warning }
					}
					case 'startxref': {
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						const xrefStr = await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_DIGIT)
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						const xrefOffset = parseInt(xrefStr)
						const eofStr = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, false)
						await this.reader.readArrayWhile(this.engine.constants.TOKEN_BYTE_EOL)
						if (eofStr !== '%%EOF') {
							warning = new PdfError(`Invalid token (end-of-file marker) at offset ${start}`, 'tokenizer:invalid_token:eof', { offset: start, type: 'eof' })
						}
						const end = this.reader.offset
						return { type: 'eof', start, end, value: xrefOffset, warning }
					}
				}
				return { type: 'op', start, end, value: keyword, warning }
			}

			// junk data
			return { type: 'junk', start, end: start + 1, value: char, warning }
		}
	}

	export type Token = (
		TokenSpace | TokenComment | TokenJunk |
		TokenNull | TokenBooolean | TokenInteger | TokenReal | TokenString | TokenHexstring | TokenName |
		TokenArrayStart | TokenArrayEnd | TokenDictionaryStart | TokenDictionaryEnd |
		TokenIndirectStart | TokenIndirectEnd | TokenRef | TokenStream | TokenXref | TokenTrailer | TokenEof | TokenOp
	)
	export type TokenType = (
		'space' | 'comment' | 'junk' |
		'null' | 'boolean' | 'integer' | 'real' | 'string' | 'hexstring' | 'name' |
		'array_start' | 'array_end' | 'dictionary_start' | 'dictionary_end' |
		'indirect_start' | 'indirect_end' | 'ref' | 'stream' | 'xref' | 'trailer' | 'eof' | 'op'
	)
	export type TokenValue = (
		null | boolean | number | string | number[] |
		{ start: number, end: number } |
		{ num: number, gen: number } |
		{
			startNum: number,
			objs: Array<
				{ offset: number, gen: number, type: 'n' } |
				{ nextFree: number, gen: number, type: 'f' }
			>
		}
	)
	export interface TokenBase {
		start: number,
		end: number,
		warning: PdfError | null
	}
	export interface TokenSpace extends TokenBase {
		type: 'space',
		value: string
	}
	export interface TokenComment extends TokenBase {
		type: 'comment',
		value: string
	}
	export interface TokenJunk extends TokenBase {
		type: 'junk',
		value: string
	}
	export interface TokenNull extends TokenBase {
		type: 'null',
		value: null
	}
	export interface TokenBooolean extends TokenBase {
		type: 'boolean',
		value: boolean
	}
	export interface TokenInteger extends TokenBase {
		type: 'integer',
		value: number
	}
	export interface TokenReal extends TokenBase {
		type: 'real',
		value: number
	}
	export interface TokenString extends TokenBase {
		type: 'string',
		value: number[]
	}
	export interface TokenHexstring extends TokenBase {
		type: 'hexstring',
		value: number[]
	}
	export interface TokenName extends TokenBase {
		type: 'name',
		value: string
	}
	export interface TokenArrayStart extends TokenBase {
		type: 'array_start',
		value: null
	}
	export interface TokenArrayEnd extends TokenBase {
		type: 'array_end',
		value: null
	}
	export interface TokenDictionaryStart extends TokenBase {
		type: 'dictionary_start',
		value: null
	}
	export interface TokenDictionaryEnd extends TokenBase {
		type: 'dictionary_end',
		value: null
	}
	export interface TokenIndirectStart extends TokenBase {
		type: 'indirect_start',
		value: { num: number, gen: number }
	}
	export interface TokenIndirectEnd extends TokenBase {
		type: 'indirect_end',
		value: null
	}
	export interface TokenRef extends TokenBase {
		type: 'ref',
		value: { num: number, gen: number }
	}
	export interface TokenStream extends TokenBase {
		type: 'stream',
		value: { start: number, end: number }
	}
	export interface TokenXref extends TokenBase {
		type: 'xref',
		value: {
			startNum: number,
			objs: Array<[field1: number, field2: number, type: string]>
		}
	}
	export interface TokenTrailer extends TokenBase {
		type: 'trailer',
		value: null
	}
	export interface TokenEof extends TokenBase {
		type: 'eof',
		value: number
	}
	export interface TokenOp extends TokenBase {
		type: 'op',
		value: string
	}
}
