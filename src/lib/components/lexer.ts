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
		readonly collection: model.Collection
		readonly warnings: PdfError[]
		readonly decoders = {
			latin1: new TextDecoder('latin1'),
			utf16be: new TextDecoder('utf-16be'),
			utf8: new TextDecoder('utf-8')
		}
		stack: model.ObjWithChildren[] = []
		pendingDictionaryKey: string | null = null
		pendingXrefTable: tokenizer.TokenXref | null = null
		pendingTrailer: true | model.ObjType.Dictionary | null = null

		constructor (config: {
			engine: engine.Engine,
			collection: model.Collection,
			warnings: PdfError[]
		}) {
			this.engine = config.engine
			this.collection = config.collection
			this.warnings = config.warnings
		}

		pushToken (token: tokenizer.Token): model.Obj | null {
			switch (token.type) {
				case 'space':
					// ignore
					return null
				case 'comment': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Comment)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'junk': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Junk)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'null': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Null)
					this.insertObject(obj, token)
					return obj
				}
				case 'boolean': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Boolean)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'integer': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Integer)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'real': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Real)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'string': {
					const obj = this.createStringObject('string', token.value)
					this.insertObject(obj, token)
					return obj
				}
				case 'hexstring': {
					const obj = this.createStringObject('hexstring', token.value)
					this.insertObject(obj, token)
					return obj
				}
				case 'name': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Name)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'array_start': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Array)
					this.insertObject(obj, token)
					this.pushStack(obj)
					return obj
				}
				case 'array_end': {
					this.popStack('Array', token)
					return null
				}
				case 'dictionary_start': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Dictionary)
					this.insertObject(obj, token)
					this.pushStack(obj)
					return obj
				}
				case 'dictionary_end': {
					this.popStack('Dictionary', token)
					return null
				}
				case 'indirect_start': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Indirect)
					obj.identifier = token.value
					this.collection.addObject(obj)
					this.insertObject(obj, token)
					this.pushStack(obj)
					return obj
				}
				case 'indirect_end': {
					this.popStack('Indirect', token)
					return null
				}
				case 'ref': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Ref)
					obj.identifier = token.value
					this.insertObject(obj, token)
					return obj
				}
				case 'stream': {
					let dictObj: model.ObjType.Dictionary | null = null
					{
						const parent = this.stack[this.stack.length - 1]
						if (!(parent instanceof this.engine.model.ObjType.Indirect)) {
							this.warnings.push(new PdfError(`Stream is not an indirect object at offset ${token.start}`, 'lexer:invalid_token:stream:not_indirect', { type: 'Stream', token }))
							break
						}
						if (!(parent.direct instanceof this.engine.model.ObjType.Dictionary)) {
							this.warnings.push(new PdfError(`Stream is missing dictionary at offset ${token.start}`, 'lexer:invalid_token:stream:missing_dictionary', { type: 'Stream', token }))
							break
						}
						dictObj = parent.direct
						parent.direct = null
					}
					const obj = this.collection.createObject(this.engine.model.ObjType.Stream)
					obj.sourceLocation = {
						start: token.value.start,
						end: token.value.end
					}
					obj.dictionary = dictObj
					this.insertObject(obj, token)
					return obj
				}
				case 'xref': {
					this.pendingXrefTable = token
					return null
				}
				case 'trailer': {
					this.pendingTrailer = true
					return null
				}
				case 'eof':
					this.popStack('Xref', token)
					return null
				case 'op': {
					const obj = this.collection.createObject(this.engine.model.ObjType.Op)
					obj.value = token.value
					this.insertObject(obj, token)
					return obj
				}
			}
			return null
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
		createStringObject (
			tokenType: 'string' | 'hexstring',
			data: number[]
		): model.ObjType.Text | model.ObjType.Bytes | model.ObjType.Date {
			const createTextObject = (value: string, encoding: 'pdf' | 'utf-8' | 'utf-16be') => {
				const obj = this.collection.createObject(this.engine.model.ObjType.Text)
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

						const obj = this.collection.createObject(this.engine.model.ObjType.Date)
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
				const obj = this.collection.createObject(this.engine.model.ObjType.Bytes)
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

		insertObject (obj: model.Obj, token: tokenizer.Token) {
			if (this.pendingTrailer && obj instanceof this.engine.model.ObjType.Dictionary) {
				this.pendingTrailer = obj
				return
			}
			const parent = this.stack[this.stack.length - 1]
			if (parent instanceof this.engine.model.ObjType.Root) {
				const xrefObj = this.collection.createObject(this.engine.model.ObjType.Xref)
				parent.push(xrefObj)
				xrefObj.push(obj)
				return
			}
			if (
				parent instanceof this.engine.model.ObjType.Array ||
				parent instanceof this.engine.model.ObjType.Content ||
				parent instanceof this.engine.model.ObjType.Xref
			) {
				parent.push(obj)
				return
			}
			if (parent instanceof this.engine.model.ObjType.Dictionary) {
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
			if (parent instanceof this.engine.model.ObjType.Indirect) {
				if (!parent.direct) {
					parent.direct = obj
					return
				}
				this.warnings.push(new PdfError(`Multiple direct objects inside indirect object at offset ${token.start}`, `lexer:invalid_token:${token.type}:multiple_children`, { type: 'Indirect', token, child: obj, parent }))
				return
			}
			throw new Error(`parser code error: invalid parent: ${parent.type}`)
		}

		pushStack (obj: model.ObjWithChildren) {
			this.stack.push(obj)
		}

		popStack (type: model.ObjWithChildrenTypeString, token: tokenizer.Token) {
			if (this.stack.length <= 1) {
				this.warnings.push(new PdfError(`Junk ${type} end token at offset ${token.start}`, `lexer:invalid_token:${token.type}:missing_start`, { type, token }))
				return
			}
			let parent = this.stack.pop() as model.Obj
			if (this.pendingDictionaryKey) {
				this.pendingDictionaryKey = null
				this.warnings.push(new PdfError(`Dictionary object is missing final value at offset ${token.start}`, `lexer:invalid_token:${token.type}:missing_value`, { type: 'Dictionary', object: parent, token }))
			}
			if (parent.type !== type) {
				this.warnings.push(new PdfError(`Unterminated ${parent.type} object at offset ${token.start}`, `lexer:invalid_token:${parent.type}:missing_end`, { type: parent.type, object: parent, token }))
				// keep popping objects until we pop one that matches the end token we got
				while (this.stack.length > 1) {
					parent = this.stack.pop() as model.Obj
					if (parent.type === type) {
						break
					}
				}
			}
			if (parent instanceof this.engine.model.ObjType.Xref) {
				if (this.pendingXrefTable) {
					parent.xrefTable = this.pendingXrefTable.value
				}
				if (this.pendingTrailer instanceof this.engine.model.ObjType.Dictionary) {
					parent.trailer = this.pendingTrailer
				}
				parent.startxref = (token as tokenizer.TokenEof).value
				this.pendingXrefTable = null
				this.pendingTrailer = null
			}
		}
	}
}
