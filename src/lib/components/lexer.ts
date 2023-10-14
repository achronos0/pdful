/**
 * Convert document data from tokens into a tree of pdf objects.
 *
 * Lexer is the second stage of parsing.
 *
 * @module
 */

import { PdfError } from '../core.js'
import type { model } from './model.js'
import type { engine } from './engine.js'
import type { tokenizer } from './tokenizer.js'

export namespace lexer {
	export class Lexer {
		readonly engine: engine.Engine
		readonly objectCollection: model.Collection
		readonly warnings: PdfError[]
		readonly decoders = {
			latin1: new TextDecoder('latin1'),
			utf16be: new TextDecoder('utf-16be'),
			utf8: new TextDecoder('utf-8')
		}
		stack: model.PdfObjectWithChildren[] = []
		pendingDictionaryKey: string | null = null

		constructor (config: {
			engine: engine.Engine,
			objectCollection: model.Collection,
			warnings: PdfError[]
		}) {
			this.engine = config.engine
			this.objectCollection = config.objectCollection
			this.warnings = config.warnings
		}

		start (rootObject: model.PdfObjectWithChildren) {
			this.stack = [rootObject]
		}

		pushToken (token: tokenizer.Token) {
			switch (token.type) {
				case 'space':
					// ignore
					break
				case 'comment':
					// ignore
					break
				case 'junk':
					// ignore
					break
				case 'null': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Null)
					this.insertObject(obj, token)
					break
				}
				case 'boolean': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Boolean)
					obj.value = token.value
					this.insertObject(obj, token)
					break
				}
				case 'integer': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Integer)
					obj.value = token.value
					this.insertObject(obj, token)
					break
				}
				case 'real': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Real)
					obj.value = token.value
					this.insertObject(obj, token)
					break
				}
				case 'string': {
					const obj = this.createStringObject('string', token.value)
					this.insertObject(obj, token)
					break
				}
				case 'hexstring': {
					const obj = this.createStringObject('hexstring', token.value)
					this.insertObject(obj, token)
					break
				}
				case 'name': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Name)
					obj.value = token.value
					this.insertObject(obj, token)
					break
				}
				case 'array_start': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Array)
					this.insertObject(obj, token)
					this.pushStack(obj)
					break
				}
				case 'array_end': {
					this.popStack('Array', token)
					break
				}
				case 'dictionary_start': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Dictionary)
					this.insertObject(obj, token)
					this.pushStack(obj)
					break
				}
				case 'dictionary_end': {
					this.popStack('Dictionary', token)
					break
				}
				case 'indirect_start': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Indirect)
					obj.identifier = token.value
					this.objectCollection.addObject(obj)
					this.insertObject(obj, token)
					this.pushStack(obj)
					break
				}
				case 'indirect_end': {
					this.popStack('Indirect', token)
					break
				}
				case 'ref': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Ref)
					obj.identifier = token.value
					this.insertObject(obj, token)
					break
				}
				case 'stream': {
					let dictObj: model.PdfObjectType.Dictionary | null = null
					{
						const parent = this.stack[this.stack.length - 1]
						if (!(parent instanceof this.engine.model.PdfObjectType.Indirect)) {
							this.warnings.push(new PdfError(`Stream is not an indirect object at offset ${token.start}`, 'lexer:invalid_token:stream:not_indirect', { type: 'Stream', token }))
							break
						}
						if (!(parent.direct instanceof this.engine.model.PdfObjectType.Dictionary)) {
							this.warnings.push(new PdfError(`Stream is missing dictionary at offset ${token.start}`, 'lexer:invalid_token:stream:missing_dictionary', { type: 'Stream', token }))
							break
						}
						dictObj = parent.direct
						parent.direct = null
					}
					const obj = this.createObject(this.engine.model.PdfObjectType.Stream)
					obj.sourceLocation = {
						start: token.value.start,
						end: token.value.end
					}
					obj.dictionary = dictObj
					this.insertObject(obj, token)
					break
				}
				case 'xref': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Xref)
					obj.value = token.value
					this.insertObject(obj, token)
					break
				}
				case 'trailer': {
					// @TODO
					break
				}
				case 'eof':
					// @TODO
					break
				case 'op': {
					const obj = this.createObject(this.engine.model.PdfObjectType.Op)
					obj.value = token.value
					this.insertObject(obj, token)
					break
				}
			}
		}

		createObject <T extends model.PdfObjectConstructor>(Type: T): InstanceType<T> {
			return this.objectCollection.createObject(Type)
		}

		/**
		 * Create pdf object from a string token
		 *
		 * Note: `data` array may be reused and/or modified. Pass a copy if you need the original data intact.
		 *
		 * @param tokenType underlying token type
		 * @param data string byte int array
		 * @returns pdf object
		 */
		createStringObject (tokenType: 'string' | 'hexstring', data: number[]): model.PdfObjectType.Text | model.PdfObjectType.Bytes | model.PdfObjectType.Date {
			const createTextObject = (value: string, encoding: 'pdf' | 'utf-8' | 'utf-16be') => {
				const obj = this.createObject(this.engine.model.PdfObjectType.Text)
				obj.value = value
				obj.tokenType = tokenType
				obj.encoding = encoding
				return obj
			}
			// Test encodings
			let handler: string | null = null
			for (const [checkHandler, prefix] of Object.entries(this.engine.constants.LEXER_STRING_TESTS)) {
				if (data.length < prefix.length) {
					continue
				}
				let match = true
				for (let index = 0; index < prefix.length; index++) {
					if (prefix[index] !== data[index]) {
						match = false
						break
					}
				}
				if (match) {
					handler = checkHandler
					data = data.slice(prefix.length)
					break
				}
			}
			switch (handler) {
				case 'date': {
					const str = this.decoders.latin1.decode(Uint8Array.from(data))
					const m = this.engine.constants.LEXER_DATE_REGEXP.exec(str)
					if (m) {
						const [
							,
							year,
							month = '01',
							day = '01',
							hours = '00',
							mins = '00',
							secs = '00',
							offsetSign = 'Z',
							offsetHours = '00',
							offsetMins = '00'
						] = m
						// http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15
						const tzOffset = offsetSign === 'Z' ? 'Z' : `${offsetSign}${offsetHours}:${offsetMins}`
						const date = new Date(`${year}-${month}-${day}T${hours}:${mins}:${secs}${tzOffset}`)

						const obj = this.createObject(this.engine.model.PdfObjectType.Date)
						obj.value = date
						return obj
					}

					break
				}
				case 'utf8': {
					const str = this.decoders.utf8.decode(Uint8Array.from(data))
					return createTextObject(str, 'utf-8')
				}
				case 'utf16be': {
					const str = this.decoders.utf16be.decode(Uint8Array.from(data))
					return createTextObject(str, 'utf-8')
				}
			}

			// Handle byte string
			if (tokenType === 'hexstring') {
				const obj = this.createObject(this.engine.model.PdfObjectType.Bytes)
				obj.value = Uint8Array.from(data)
				return obj
			}

			// Handle PdfDocEncoding
			const conversions = this.engine.constants.LEXER_PDFDOCENCODING_MAP
			for (let index = 0; index < data.length; index++) {
				const to = conversions[data[index]]
				if (to != null) {
					data[index] = to
				}
			}
			const str = String.fromCodePoint(...data)
			return createTextObject(str, 'pdf')
		}

		insertObject (obj: model.PdfObject, token: tokenizer.Token) {
			const parent = this.stack[this.stack.length - 1]
			if (parent instanceof this.engine.model.PdfObjectType.Array || parent instanceof this.engine.model.PdfObjectType.Root) {
				parent.push(obj)
				return
			}
			if (parent instanceof this.engine.model.PdfObjectType.Dictionary) {
				if (this.pendingDictionaryKey != null) {
					parent.children.set(this.pendingDictionaryKey, obj)
					this.pendingDictionaryKey = null
					return
				}
				if ('value' in obj) {
					this.pendingDictionaryKey = String(obj.value)
					return
				}
				this.warnings.push(new PdfError(`Invalid dictionary key ${obj.type} object at offset ${token.start}`, `lexer:invalid_token:${token.type}:invalid_key`, { type: 'Dictionary', token }))
				this.pendingDictionaryKey = ''
				return
			}
			if (parent instanceof this.engine.model.PdfObjectType.Indirect) {
				if (!parent.direct) {
					parent.direct = obj
					return
				}
				this.warnings.push(new PdfError(`Multiple direct objects inside indirect object at offset ${token.start}`, `lexer:invalid_token:${token.type}:multiple_children`, { type: 'Indirect', token, child: obj, parent }))
				return
			}
			throw new Error('invalid parent')
		}

		pushStack (obj: model.PdfObjectWithChildren) {
			this.stack.push(obj)
		}

		popStack (type: model.WithChildrenTypeString, token: tokenizer.Token) {
			if (this.stack.length < 2) {
				this.warnings.push(new PdfError(`Junk ${type} end token at offset ${token.start}`, `lexer:invalid_token:${token.type}:missing_start`, { type, token }))
				return
			}
			const parent = this.stack.pop() as model.PdfObject
			if (this.pendingDictionaryKey) {
				this.pendingDictionaryKey = null
				this.warnings.push(new PdfError(`Dictionary object is missing final value at offset ${token.start}`, `lexer:invalid_token:${token.type}:missing_value`, { type: 'Dictionary', object: parent, token }))
			}
			if (parent.type !== type) {
				this.warnings.push(new PdfError(`Unterminated ${parent.type} object at offset ${token.start}`, `lexer:invalid_token:${parent.type}:missing_end`, { type: parent.type, object: parent, token }))
				// keep popping objects until we pop one that matches the end token we got
				while (this.stack.length > 1) {
					const parent = this.stack.pop() as model.PdfObject
					if (parent.type === type) {
						break
					}
				}
			}
		}
	}
}
