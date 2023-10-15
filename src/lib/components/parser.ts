/**
 * Convert document data into structured objects in memory.
 *
 * @module
 */

import { PdfError } from '../core.js'
import type { codecs } from './codecs.js'
import type { model } from './model.js'
import type { engine } from './engine.js'
import type { io } from './io.js'
import type { lexer } from './lexer.js'
import type { tokenizer } from './tokenizer.js'

export namespace parser {
	export class Parser {
		readonly engine: engine.Engine
		constructor (config: { engine: engine.Engine }) {
			this.engine = config.engine
		}

		async run (reader: io.ReaderPair) {
			const sequentialReader = reader.sequentialReader
			const offsetReader = reader.offsetReader
			const collection = new this.engine.model.Collection()
			const warnings: PdfError[] = []
			const pdfVersion = await this.parseDocumentData({ sequentialReader, collection, warnings })
			await this.resolveRefs(collection)
			await this.resolveStreamTypes(collection)
			await this.parseStreams({ offsetReader, collection, warnings })
			await this.resolveRefs(collection)
			return { pdfVersion, collection, warnings }
		}

		async parseDocumentData (config: {
			sequentialReader: io.SequentialReader,
			collection: model.Collection,
			warnings: PdfError[]
		}) {
			const sequentialReader = config.sequentialReader
			const collection = config.collection
			const warnings = config.warnings

			if (sequentialReader.length < 0xFF) {
				throw new PdfError('Not a PDF: File size is too small', 'parser:not_pdf:filesize')
			}

			/**
				@todo handle leading junk chars

				[2023-10 kp] according to spec (section 7.5.2) the file may begin with an unlimited number of
				junk characters before the `"%PDF-"`, and those junk characters are not counted in stored byte offset values
				e.g. in `startxref {n}` the "n" may not be an exact offset in the file
				We just don't support this yet.
			*/
			let pdfVersion: string
			{
				const str = await sequentialReader.readString(20, false)
				const m = /^%PDF-(\d+\.\d+)\n/.exec(str)
				if (!m) {
					throw new PdfError('Not a PDF: Does not have a PDF header', 'parser:not_pdf:invalid_header')
				}
				const headerLength = m[0].length
				pdfVersion = m[1]
				sequentialReader.consume(headerLength)
			}
			if (!this.engine.constants.VERSION_DATA[pdfVersion]) {
				warnings.push(new PdfError(`Unsupported PDF version: ${pdfVersion}`, 'parser:unsupported_version', { pdfVersion }))
			}

			const xrefObj = collection.createObject(this.engine.model.ObjType.Xref)
			collection.root.push(xrefObj)

			const engine = this.engine
			const tokenizer = new this.engine.tokenizer.Tokenizer({ engine, sequentialReader, warnings })
			const lexer = new this.engine.lexer.Lexer({ engine, collection, warnings })
			const stack = [collection.root, xrefObj]
			await this._parseObjectData({ tokenizer, lexer, stack })
			return pdfVersion
		}

		async resolveRefs (collection: model.Collection) {
			for (const ref of collection.refs.values()) {
				if (ref.identifier && !ref.indirect) {
					const obj = collection.identifier(ref.identifier)
					if (obj) {
						ref.indirect = obj
					}
				}
			}
		}

		async resolveStreamTypes (collection: model.Collection) {
			for (const streamObj of collection.streams.values()) {
				const dictObj = streamObj.dictionary
				if (!dictObj) {
					continue
				}
				let type: string | null = null
				const typeObj = dictObj.children.get('Type')
				if (typeObj instanceof this.engine.model.ObjType.Name) {
					type = typeObj.value
				}
				let subtype: string | null = null
				const subtypeObj = dictObj.children.get('Subtype') || dictObj.children.get('S') || null
				if (subtypeObj instanceof this.engine.model.ObjType.Name) {
					subtype = subtypeObj.value
				}
				if (!type && subtype && ['Form', 'Image'].includes(subtype)) {
					type = 'XObject'
				}
				if (!type) {
					continue
				}
				if (subtype) {
					type += '/' + subtype
				}
				streamObj.streamType = type
			}
		}

		async parseStreams (config: {
			offsetReader: io.OffsetReader,
			collection: model.Collection,
			warnings: PdfError[]
		}) {
			const offsetReader = config.offsetReader
			const collection = config.collection
			const warnings = config.warnings
			for (const streamObj of collection.streams.values()) {
				const streamType = streamObj.streamType
				if (!streamType) {
					continue
				}
				const bytes = await this.decodeStreamObj({ streamObj, offsetReader, warnings })
				switch (streamType) {
					case 'Content':
						await this.parseContentStreamObj({ streamObj, bytes, warnings })
						break
					case 'XObject/Form':
						await this.parseContentStreamObj({ streamObj, bytes, warnings })
						break
					case 'XObject/Image':
						await this.parseImageStreamObj({ streamObj, bytes, warnings })
						break
					case 'ObjStm':
						await this.parseObjectStreamObj({ streamObj, bytes, warnings })
						break
					case 'XRef':
						await this.parseXrefStreamObj({ streamObj, bytes, warnings })
						break
					default:
						await this.parseBinaryStreamObj({ streamObj, bytes, warnings })
				}
			}
		}

		async decodeStreamObj (config: {
			streamObj: model.ObjType.Stream,
			offsetReader: io.OffsetReader,
			warnings: PdfError[]
		}) {
			const streamObj = config.streamObj
			const offsetReader = config.offsetReader
			const warnings = config.warnings

			const dictObj = streamObj.dictionary
			const sourceLocation = streamObj.sourceLocation
			if (!dictObj || !sourceLocation) {
				return new Uint8Array(0)
			}

			const dictData = dictObj.getChildrenValue()
			if (dictData.F) {
				throw new PdfError(`@TODO: Not implemented: Stream resource specifies an external file`, 'lexer:not_implemented:stream:file', { type: 'Stream', notImplemented: true })
			}
			const actualLength = sourceLocation.end - sourceLocation.start
			if (typeof dictData.Length === 'number' && dictData.Length !== actualLength) {
				throw new PdfError(`Stream resource length mismatch at offset ${sourceLocation.start}`, 'lexer:invalid:stream:length_mismatch', { type: 'Stream', dictLength: dictData.Length, actualLength, dictData })
			}

			const filters: codecs.StreamFilter[] = []
			if (Array.isArray(dictData.Filter)) {
				for (const val of dictData.Filter) {
					if (typeof val === 'string') {
						filters.push({ name: val, decodeParms: null })
					}
				}
			}
			else if (typeof dictData.Filter === 'string') {
				filters.push({ name: dictData.Filter, decodeParms: null })
			}
			if (filters.length) {
				if (Array.isArray(dictData.DecodeParms)) {
					for (const [index, val] of dictData.DecodeParms.entries()) {
						if (index < filters.length && val && typeof val === 'object') {
							filters[index].decodeParms = val
						}
					}
				}
				else if (dictData.DecodeParms && typeof dictData.DecodeParms === 'object') {
					filters[0].decodeParms = dictData.DecodeParms
				}
			}

			let bytes = await offsetReader.readArray(sourceLocation.start, sourceLocation.end)
			if (filters.length) {
				try {
					bytes = await this.engine.codecs.decodeStreamArray(bytes, filters)
				}
				catch (err: any) {
					if (err instanceof PdfError) {
						warnings.push(err)
						return new Uint8Array(0)
					}
					else {
						throw err
					}
				}
			}

			return bytes
		}

		async parseContentStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			warnings: PdfError[]
		}) {
			const streamObj = config.streamObj
			const bytes = config.bytes
			const warnings = config.warnings
			const collection = streamObj.collection

			const obj = collection.createObject(this.engine.model.ObjType.Content)
			streamObj.direct = obj

			const engine = this.engine
			const lexer = new engine.lexer.Lexer({ engine, collection, warnings })
			const sequentialReader = new engine.io.SequentialMemoryReader(bytes)
			const tokenizer = new this.engine.tokenizer.Tokenizer({ engine, sequentialReader, warnings })
			const stack = [obj]
			await this._parseObjectData({ tokenizer, lexer, stack })

			return obj
		}

		async parseObjectStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			warnings: PdfError[]
		}) {
			// const streamObj = config.streamObj
			// const bytes = config.bytes
			// const warnings = config.warnings
			// const collection = streamObj.collection

			// @TODO
			throw new Error('@TODO parser temp debug stop: found object stream')
		}

		async parseXrefStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			warnings: PdfError[]
		}) {
			// const streamObj = config.streamObj
			// const bytes = config.bytes
			// const warnings = config.warnings
			// const collection = streamObj.collection

			// @TODO
			throw new Error('@TODO parser temp debug stop: found xref stream')
		}

		async parseImageStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			warnings: PdfError[]
		}) {
			const streamObj = config.streamObj
			const bytes = config.bytes
			const warnings = config.warnings
			await this.parseBinaryStreamObj({ streamObj, bytes, warnings })
		}

		async parseBinaryStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			warnings: PdfError[]
		}): Promise<model.ObjType.Bytes> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			// const warnings = config.warnings
			const collection = streamObj.collection

			const obj = collection.createObject(this.engine.model.ObjType.Bytes)
			streamObj.direct = obj
			obj.value = bytes
			return obj
		}

		protected async _parseObjectData (config: {
			tokenizer: tokenizer.Tokenizer,
			lexer: lexer.Lexer,
			stack: model.ObjWithChildren[],
		}) {
			const tokenizer = config.tokenizer
			const lexer = config.lexer
			lexer.stack = config.stack
			const tokenGenerator = tokenizer.tokens()
			for await (const token of tokenGenerator) {
				lexer.pushToken(token)
			}
		}
	}
}
