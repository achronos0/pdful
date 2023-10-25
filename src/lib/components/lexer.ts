/**
 * Convert document data from syntax tokens to pdf objects
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
		readonly store: model.ObjStore
		stack: model.ObjWithChildren[] = []
		pendingDictionaryKey: string | null = null
		pendingXrefTable: tokenizer.TokenXref | null = null
		pendingTrailer: true | model.ObjType.Dictionary | null = null

		constructor (config: {
			engine: engine.Engine
			store: model.ObjStore
		}) {
			this.engine = config.engine
			this.store = config.store
		}

		pushToken (token: tokenizer.Token): {obj: model.Obj | null, warnings: PdfError[]} {
			switch (token.type) {
				case 'space':
					// ignore
					return { obj: null, warnings: [] }
				case 'comment': {
					const obj = this.store.createObject(this.engine.model.ObjType.Comment)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'junk': {
					const obj = this.store.createObject(this.engine.model.ObjType.Junk)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'null': {
					const obj = this.store.createObject(this.engine.model.ObjType.Null)
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'boolean': {
					const obj = this.store.createObject(this.engine.model.ObjType.Boolean)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'integer': {
					const obj = this.store.createObject(this.engine.model.ObjType.Integer)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'real': {
					const obj = this.store.createObject(this.engine.model.ObjType.Real)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'string': {
					const obj = this.createStringObject('string', token.value)
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'hexstring': {
					const obj = this.createStringObject('hexstring', token.value)
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'name': {
					const obj = this.store.createObject(this.engine.model.ObjType.Name)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'array_start': {
					const obj = this.store.createObject(this.engine.model.ObjType.Array)
					const warnings1 = this.insertObject(obj, token)
					const warnings2 = this.pushStack(obj)
					return { obj, warnings: [...warnings1, ...warnings2] }
				}
				case 'array_end': {
					const warnings = this.popStack('Array', token)
					return { obj: null, warnings }
				}
				case 'dictionary_start': {
					const obj = this.store.createObject(this.engine.model.ObjType.Dictionary)
					const warnings1 = this.insertObject(obj, token)
					const warnings2 = this.pushStack(obj)
					return { obj, warnings: [...warnings1, ...warnings2] }
				}
				case 'dictionary_end': {
					const warnings = this.popStack('Dictionary', token)
					return { obj: null, warnings }
				}
				case 'indirect_start': {
					const obj = this.store.createObject(this.engine.model.ObjType.Indirect)
					obj.identifier = token.value
					this.store.addObject(obj)
					const warnings1 = this.insertObject(obj, token)
					const warnings2 = this.pushStack(obj)
					return { obj, warnings: [...warnings1, ...warnings2] }
				}
				case 'indirect_end': {
					const warnings = this.popStack('Indirect', token)
					return { obj: null, warnings }
				}
				case 'ref': {
					const obj = this.store.createObject(this.engine.model.ObjType.Ref)
					obj.identifier = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
				case 'stream': {
					const warnings1: PdfError[] = []
					let dictObj: model.ObjType.Dictionary | null = null
					{
						const parent = this.stack[this.stack.length - 1]
						if (!(parent instanceof this.engine.model.ObjType.Indirect)) {
							warnings1.push(new PdfError(`Stream is not an indirect object at offset ${token.start}`, 'lexer:invalid_token:stream:not_indirect', { type: 'Stream', token }))
							break
						}
						if (!(parent.direct instanceof this.engine.model.ObjType.Dictionary)) {
							warnings1.push(new PdfError(`Stream is missing dictionary at offset ${token.start}`, 'lexer:invalid_token:stream:missing_dictionary', { type: 'Stream', token }))
							break
						}
						dictObj = parent.direct
						parent.direct = null
					}
					const obj = this.store.createObject(this.engine.model.ObjType.Stream)
					obj.sourceLocation = {
						start: token.value.start,
						end: token.value.end
					}
					obj.dictionary = dictObj
					const warnings2 = this.insertObject(obj, token)
					return { obj, warnings: [...warnings1, ...warnings2] }
				}
				case 'xref': {
					this.pendingXrefTable = token
					return { obj: null, warnings: [] }
				}
				case 'trailer': {
					this.pendingTrailer = true
					return { obj: null, warnings: [] }
				}
				case 'eof': {
					const warnings = this.popStack('Table', token)
					return { obj: null, warnings }
				}
				case 'op': {
					const obj = this.store.createObject(this.engine.model.ObjType.Op)
					obj.value = token.value
					const warnings = this.insertObject(obj, token)
					return { obj, warnings }
				}
			}
			return { obj: null, warnings: [] }
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
				const obj = this.store.createObject(this.engine.model.ObjType.Text)
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
					const str = this.engine.codecs.decodeStringArray(Uint8Array.from(data), 'latin1')
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

						const obj = this.store.createObject(this.engine.model.ObjType.Date)
						obj.value = date
						return obj
					}

					break
				}
				case 'utf8': {
					const str = this.engine.codecs.decodeStringArray(Uint8Array.from(data), 'utf8')
					return createTextObject(str, 'utf-8')
				}
				case 'utf16be': {
					const str = this.engine.codecs.decodeStringArray(Uint8Array.from(data), 'utf16be')
					return createTextObject(str, 'utf-8')
				}
			}

			// Handle byte string
			if (tokenType === 'hexstring') {
				const obj = this.store.createObject(this.engine.model.ObjType.Bytes)
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

		insertObject (obj: model.Obj, token: tokenizer.Token): PdfError[] {
			const warnings: PdfError[] = []
			if (this.pendingTrailer && obj instanceof this.engine.model.ObjType.Dictionary) {
				this.pendingTrailer = obj
				return warnings
			}
			const parent = this.stack[this.stack.length - 1]
			obj.parent = parent
			if (parent instanceof this.engine.model.ObjType.Root) {
				const tableObj = this.store.createObject(this.engine.model.ObjType.Table)
				parent.push(tableObj)
				tableObj.push(obj)
				this.pushStack(tableObj)
				return warnings
			}
			if (
				parent instanceof this.engine.model.ObjType.Array ||
				parent instanceof this.engine.model.ObjType.Content ||
				parent instanceof this.engine.model.ObjType.Table
			) {
				parent.push(obj)
				return warnings
			}
			if (parent instanceof this.engine.model.ObjType.Dictionary) {
				if (this.pendingDictionaryKey != null) {
					parent.children.set(this.pendingDictionaryKey, obj)
					this.pendingDictionaryKey = null
					return warnings
				}
				if ('value' in obj) {
					this.pendingDictionaryKey = String(obj.value)
					return warnings
				}
				warnings.push(new PdfError(`Invalid dictionary key ${obj.type} object at offset ${token.start}`, `lexer:invalid_token:${token.type}:invalid_key`, { type: 'Dictionary', token }))
				this.pendingDictionaryKey = ''
				return warnings
			}
			if (parent instanceof this.engine.model.ObjType.Indirect) {
				if (!parent.direct) {
					parent.direct = obj
					return warnings
				}
				warnings.push(new PdfError(`Multiple direct objects inside indirect object at offset ${token.start}`, `lexer:invalid_token:${token.type}:multiple_children`, { type: 'Indirect', token, child: obj, parent }))
				return warnings
			}
			throw new Error(`parser code error: invalid parent: ${parent.type}`)
		}

		pushStack (obj: model.ObjWithChildren): PdfError[] {
			this.stack.push(obj)
			return []
		}

		popStack (type: model.ObjWithChildrenTypeString, token: tokenizer.Token): PdfError[] {
			const warnings: PdfError[] = []
			if (this.stack.length <= 1) {
				warnings.push(new PdfError(`Junk ${type} end token at offset ${token.start}`, `lexer:invalid_token:${token.type}:missing_start`, { type, token }))
				return warnings
			}
			let parent = this.stack.pop() as model.Obj
			if (this.pendingDictionaryKey) {
				this.pendingDictionaryKey = null
				warnings.push(new PdfError(`Dictionary object is missing final value at offset ${token.start}`, `lexer:invalid_token:${token.type}:missing_value`, { type: 'Dictionary', object: parent, token }))
			}
			if (parent.type !== type) {
				warnings.push(new PdfError(`Unterminated ${parent.type} object at offset ${token.start}`, `lexer:invalid_token:${parent.type}:missing_end`, { type: parent.type, object: parent, token }))
				// keep popping objects until we pop one that matches the end token we got
				while (this.stack.length > 1) {
					parent = this.stack.pop() as model.Obj
					if (parent.type === type) {
						break
					}
				}
			}
			if (parent instanceof this.engine.model.ObjType.Table) {
				if (this.pendingXrefTable) {
					const xrefData = this.pendingXrefTable.value
					const startNum = xrefData.startNum
					const objs: Array<
						{ num: number, offset: number, gen: number, type: 'n' } |
						{ num: number, nextFree: number, reuseGen: number, type: 'f' }
					> = []
					for (let index = 0; index < xrefData.objs.length; index++) {
						const num = startNum + index
						const [field1, field2, type] = xrefData.objs[index]
						if (type === 'n') {
							const offset = field1
							const gen = field2
							objs.push({ num, offset, gen, type })
						}
						else if (type === 'f') {
							const nextFree = field1
							const reuseGen = field2
							objs.push({ num, nextFree, reuseGen, type })
						}
					}
					parent.xrefTable = { startNum, objs }
				}
				if (this.pendingTrailer instanceof this.engine.model.ObjType.Dictionary) {
					parent.trailer = this.pendingTrailer
				}
				parent.startxref = (token as tokenizer.TokenEof).value
				this.pendingXrefTable = null
				this.pendingTrailer = null
			}
			return warnings
		}
	}
}
