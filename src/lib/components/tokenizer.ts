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
		readonly warnings: PdfError[]

		/**
		 * Create pdf document tokenizer
		 */
		constructor (config: {
			engine: engine.Engine,
			sequentialReader: io.SequentialReader,
			warnings: PdfError[]
		}) {
			this.engine = config.engine
			this.reader = config.sequentialReader
			this.warnings = config.warnings
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
							this.warnings.push(new PdfError(`Invalid token (object) at offset ${token.start}`, `tokenizer:invalid_token:${token.type}`, { token }))
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
			}
			for (const token of tokens) {
				yield token
			}
		}

		/**
		 * @internal
		 */
		async _nextRawToken (): Promise<Token> {
			const start = this.reader.offset
			const byte = await this.reader.readByte(true)
			const char = this.reader.byteToString(byte)

			// space
			if (this.engine.constants.TOKEN_BYTE_SPACE.includes(byte)) {
				const str = char + await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_SPACE)
				const end = this.reader.offset
				return { type: 'space', start, end, value: str }
			}

			// comment
			if (char === '%') {
				const raw = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
				const end = this.reader.offset
				let str
				if (raw.substring(raw.length - 2) === '\r\n') {
					str = raw.substring(0, raw.length - 2)
				}
				else if (raw.substring(raw.length - 1) === '\n') {
					str = raw.substring(0, raw.length - 1)
				}
				else {
					str = raw
					this.warnings.push(new PdfError(`Unterminated token (comment) at offset ${start}`, 'tokenizer:unexpected_eof:comment', { offset: start }))
				}
				return { type: 'comment', start, end, value: str }
			}

			// array_start
			if (char === '[') {
				return { type: 'array_start', start, end: start + 1, value: null }
			}

			// array_end
			if (char === ']') {
				return { type: 'array_end', start, end: start + 1, value: null }
			}

			// dictionary_start
			// hexstring
			if (char === '<') {
				const next = await this.reader.readChar(false)
				if (next === '<') {
					this.reader.consume(1)
					return { type: 'dictionary_start', start, end: start + 2, value: null}
				}

				const raw = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_GREATERTHAN, true)
				const end = this.reader.offset
				let hex
				if (raw.substring(raw.length - 1) === '>') {
					hex = raw.substring(0, raw.length - 1)
				}
				else {
					hex = raw
					this.warnings.push(new PdfError(`Unterminated token (hexstring) at offset ${start}`, 'tokenizer:unexpected_eof:hexstring', { offset: start }))
				}
				const data = []
				for (let index = 0; index < hex.length; index += 2) {
					let digit = hex.substring(index, index + 2)
					if (digit.length === 1) {
						digit += '0'
					}
					data.push(parseInt(digit, 16))
				}
				return { type: 'hexstring', start, end, value: data }
			}

			// dictionary_end
			if (char === '>') {
				const next = await this.reader.readChar(false)
				if (next === '>') {
					this.reader.consume(1)
					return { type: 'dictionary_end', start, end: start + 2, value: null }
				}
				return { type: 'junk', start, end: start + 1, value: char }
			}

			// name
			if (char === '/') {
				const raw = await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_NAME)
				const end = this.reader.offset
				const str = raw.replace(/#([0-9a-fA-F]{2})/g, (_all, hex) => {
					const byte = parseInt(hex, 16)
					return String.fromCharCode(byte)
				})
				return { type: 'name', start, end, value: str }
			}

			// string
			if (char === '(') {
				const strParts = []
				let depth = 1
				while (depth && !this.reader.eof) {
					const raw = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_PAREN, true)
					if (raw.substring(raw.length - 1) === '(') {
						depth++
						strParts.push(raw)
					}
					else {
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
					this.warnings.push(new PdfError(`Unterminated token (string) at offset ${start}`, 'tokenizer:unexpected_eof:string', { offset: start }))
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
				return { type: 'string', start, end, value: data }
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
					this.warnings.push(new PdfError(`Invalid token (real number) "${raw}" at offset ${start}`, 'tokenizer:invalid_token:real', { offset: start, type: 'real' }))
				}
				let type: 'integer' | 'real'
				if (Number.isInteger(num)) {
					type = 'integer'
				}
				else {
					type = 'real'
				}
				return { type: type, start, end, value: num }
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
						return { type: 'null', start, end, value: null }
					case 'true':
						return { type: 'boolean', start, end, value: true }
					case 'false':
						return { type: 'boolean', start, end, value: false }
					case 'obj':
						return { type: 'indirect_start', start, end, value: { num: -1, gen: -1 } }
					case 'endobj':
						return { type: 'indirect_end', start, end, value: null }
					case 'R':
						return { type: 'ref', start, end, value: { num: 0, gen: 0 } }
					case 'stream': {
						await this.reader.readArrayUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						// ^^ this should be "\n" or "\r\n" but we will silently skip junk if present
						const streamStart = this.reader.offset
						let streamEnd = null
						while (!this.reader.eof) {
							let char = await this.reader.readChar(true)
							if (char === 'e' && await this.reader.readString(8, false) === 'ndstream') {
								this.reader.consume(8)
								streamEnd = this.reader.offset - 9
								break
							}
						}
						if (!streamEnd) {
							this.warnings.push(new PdfError(`Unterminated token (stream) at offset ${start}`, 'tokenizer:unexpected_eof:stream', { offset: start, type: 'stream' }))
							streamEnd = this.reader.offset
						}
						return { type: 'stream', start, end, value: { start: streamStart, end: streamEnd } }
					}
					case 'xref': {
						await this.reader.readArrayUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						// ^^ this should be "\n" or "\r\n" but we will silently skip junk if present
						const headStr = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						const m = /^(\d+) (\d+)/.exec(headStr)
						if (!m) {
							this.warnings.push(new PdfError(`Invalid token (xref head) at offset ${start}`, 'tokenizer:invalid_token:xref:head', { offset: start, type: 'xref' }))
							break
						}
						const startObjNum = parseInt(m[1])
						const objCount = parseInt(m[2])
						const objs: Array<{ offset: number, gen: number, free: boolean }> = []
						for (let lineIndex = 0; lineIndex < objCount; lineIndex++) {
							const lineStr = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
							const m = /^(\d+) (\d+) ([nf])/.exec(lineStr)
							if (!m) {
								this.warnings.push(new PdfError(`Invalid token (xref entry) at offset ${start}`, 'tokenizer:invalid_token:xref:entry', { offset: start, type: 'xref' }))
								break
							}
							const offset = parseInt(m[1])
							const gen = parseInt(m[2])
							const free = m[2] === 'f'
							objs.push({ offset, gen, free })
						}
						const end = this.reader.offset
						return { type: 'xref', start, end, value: { startObjNum, objs } }
					}
					case 'trailer': {
						await this.reader.readArrayUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						// ^^ this should be "\n" or "\r\n" but we will silently skip junk if present
						const end = this.reader.offset
						return { type: 'trailer', start, end, value: null }
					}
					case 'startxref': {
						await this.reader.readArrayUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						// ^^ this should be "\n" or "\r\n" but we will silently skip junk if present
						const xrefStr = await this.reader.readStringWhile(this.engine.constants.TOKEN_BYTE_DIGIT)
						const xrefOffset = parseInt(xrefStr)
						await this.reader.readArrayUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						// ^^ this should be "\n" or "\r\n" but we will silently skip junk if present
						const eofStr = await this.reader.readStringUntil(this.engine.constants.TOKEN_BYTE_EOL, true)
						if (eofStr !== '%%EOF\r\n' && eofStr !== '%%EOF\n') {
							this.warnings.push(new PdfError(`Invalid token (end-of-file marker) at offset ${start}`, 'tokenizer:invalid_token:eof', { offset: start, type: 'eof' }))
						}
						const end = this.reader.offset
						return { type: 'eof', start, end, value: xrefOffset }
					}
				}
				return { type: 'op', start, end, value: keyword }
			}

			// junk data
			return { type: 'junk', start, end: start + 1, value: char}
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
		{ startObjNum: number, objs: Array<{ offset: number, gen: number, free: boolean }> }
	)
	export interface TokenBase {
		start: number,
		end: number
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
		value: { startObjNum: number, objs: Array<{ offset: number, gen: number, free: boolean }> }
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
