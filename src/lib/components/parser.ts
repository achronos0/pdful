/**
 * Convert document data into structured objects in memory.
 *
 * @module
 */

import { PdfError, util } from '../core.js'
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
			const collection = new this.engine.model.ObjCollection()
			const warnings: PdfError[] = []
			const pdfVersion = await this.parseDocumentData({ sequentialReader, collection, warnings })
			await this.resolveRefs({ collection })
			await this.resolveStreamTypes({ collection })
			await this.parseStreams({ offsetReader, collection, warnings })
			await this.resolveRefs({ collection })
			await this.resolveDocumentStructure({ collection })
			return { pdfVersion, collection, warnings }
		}

		async parseDocumentData (config: {
			sequentialReader: io.SequentialReader,
			collection: model.ObjCollection,
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

			const tableObj = collection.createObject(this.engine.model.ObjType.Table)
			collection.root.push(tableObj)

			const engine = this.engine
			const tokenizer = new this.engine.tokenizer.Tokenizer({ engine, sequentialReader, warnings })
			const lexer = new this.engine.lexer.Lexer({ engine, collection, warnings })
			const stack = [collection.root, tableObj]
			await this._parseObjectData({ tokenizer, lexer, stack })
			return pdfVersion
		}

		async resolveRefs (config: { collection: model.ObjCollection }) {
			const collection = config.collection
			for (const ref of collection.refs.values()) {
				if (ref.identifier && !ref.indirect) {
					const obj = collection.identifier(ref.identifier)
					if (obj) {
						ref.indirect = obj
					}
				}
			}
		}

		async resolveStreamTypes (config: { collection: model.ObjCollection }) {
			const collection = config.collection
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
			collection: model.ObjCollection,
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

		async resolveDocumentStructure (config: { collection: model.ObjCollection }) {
			// const collection = config.collection
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
			const streamObj = config.streamObj
			const bytes = config.bytes
			const warnings = config.warnings
			const collection = streamObj.collection
			const dictObj = streamObj.dictionary

			const rootObj = collection.createObject(this.engine.model.ObjType.Array)
			streamObj.direct = rootObj

			if (!dictObj) {
				return rootObj
			}
			const dictData = dictObj.getChildrenValue()
			const firstOffset = dictData.First
			if (typeof firstOffset !== 'number') {
				warnings.push(new PdfError('Object stream dictionary missing "First" param', 'parser:invalid_stream:missing_param:first', { streamObj, dictData }))
				return rootObj
			}

			const engine = this.engine
			const lexer = new engine.lexer.Lexer({ engine, collection, warnings })

			const ints = lexer.decoders.latin1.decode(bytes.subarray(0, firstOffset)).split(/\s+/).filter(v => !!v)
			const objOffsets: Array<[num: number, start: number, end: number]> = []
			for (let index = 0; index < ints.length - 1; index += 2) {
				const num = parseInt(ints[index])
				const start = firstOffset + parseInt(ints[index + 1])
				if (objOffsets.length) {
					objOffsets[objOffsets.length - 1][2] = start
				}
				objOffsets.push([num, start, 0])
			}
			objOffsets[objOffsets.length - 1][2] = bytes.length

			for (const [num, start, end] of objOffsets) {
				const indirectObj = collection.createObject(engine.model.ObjType.Indirect)
				indirectObj.identifier = { num, gen: 0 }
				rootObj.push(indirectObj)
				const sequentialReader = new engine.io.SequentialMemoryReader(bytes.subarray(start, end))
				const tokenizer = new this.engine.tokenizer.Tokenizer({ engine, sequentialReader, warnings })
				const stack = [indirectObj]
				await this._parseObjectData({ tokenizer, lexer, stack })
			}

			return rootObj
		}

		async parseXrefStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			warnings: PdfError[]
		}): Promise<model.ObjType.Xref> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			const warnings = config.warnings
			const collection = streamObj.collection
			const dictObj = streamObj.dictionary

			const xrefObj = collection.createObject(this.engine.model.ObjType.Xref)
			streamObj.direct = xrefObj

			if (!dictObj) {
				return xrefObj
			}
			const dictData = dictObj.getChildrenValue()
			if (!util.isArrayOfNumber(dictData.W)) {
				warnings.push(new PdfError('Xref stream "W" param is invalid', 'parser:invalid_stream:xref:invalid_w', { obj: streamObj, dictData, param: 'W' }))
				return xrefObj
			}
			for (const width of dictData.W) {
				if (![0, 1, 2, 4].includes(width)) {
					warnings.push(new PdfError(`Xref stream "W" param contains unsupported byte width ${width}`, 'parser:invalid_stream:xref:unsupported_w', { obj: streamObj, dictData, param: 'W' }))
					return xrefObj
				}
			}
			if (typeof dictData.Size !== 'number') {
				warnings.push(new PdfError('Xref stream "Size" param is missing or invalid', 'parser:invalid_stream:xref:invalid_size', { obj: streamObj, dictData, param: 'Size' }))
				return xrefObj
			}
			const rawIndex = dictData.Index || null
			if (rawIndex != null && !util.isArrayOfNumber(rawIndex)) {
				warnings.push(new PdfError('Xref stream "Index" param is invalid', 'parser:invalid_stream:xref:invalid_index', { obj: streamObj, dictData, param: 'Index' }))
				return xrefObj
			}

			const widths = dictData.W as Array<0 | 1 | 2 | 4>
			let recordLength = 0
			for (const len of widths) {
				recordLength += len
			}
			const subsections: Array<{ startNum: number, count: number }> = []
			const allObjNum: number[] = []
			let totalCount = 0
			if (rawIndex) {
				for (let index = 0; index < rawIndex.length - 1; index += 2) {
					const startNum = rawIndex[index]
					const count = rawIndex[index + 1]
					subsections.push({ startNum, count })
					for (let index = 0; index < count; index++) {
						allObjNum.push(startNum + index)
					}
					totalCount += count
				}
			}
			else {
				subsections.push({startNum: 0, count: dictData.Size })
				for (let index = 0; index < totalCount; index++) {
					allObjNum.push(index)
				}
				totalCount = dictData.Size
			}
			const objTable: Array<
				{ num: number, type: 0, nextFree: number, gen: number } |
				{ num: number, type: 1, offset: number, gen: number } |
				{ num: number, type: 2, streamNum: number, indexInStream: number } |
				{ num: number, fields: Array<number | null> }
			> = []
			const dataview = new DataView(bytes.buffer)
			let offset = 0
			while (allObjNum.length && offset <= dataview.byteLength - recordLength) {
				const num = allObjNum.shift() || 0
				const fields: Array<number | null> = []
				for (const width of widths) {
					let fieldValue: number | null
					switch (width) {
						case 0:
							fieldValue = null
							break
						case 1:
							fieldValue = dataview.getUint8(offset)
							break
						case 2:
							fieldValue = dataview.getUint16(offset, false)
							break
						case 4:
							fieldValue = dataview.getUint32(offset, false)
							break
					}
					fields.push(fieldValue)
					offset += width
				}
				const type = fields[0]
				switch (type) {
					case 0: {
						const nextFree = fields[1] || 0
						const gen = fields[2] || 0
						objTable.push({ num, type, nextFree, gen })
						break
					}
					case 1: {
						const offset = fields[1] || 0
						const gen = fields[2] || 0
						objTable.push({ num, type, offset, gen })
						break
					}
					case 2: {
						const streamNum = fields[1] || 0
						const indexInStream = fields[2] || 0
						objTable.push({ num, type, streamNum, indexInStream })
						break
					}
					default:
						objTable.push({ num, fields })
				}
			}

			xrefObj.value = { widths, subsections, objTable }

			let parentObj = streamObj.parent
			while (parentObj && !(parentObj instanceof this.engine.model.ObjType.Table)) {
				parentObj = parentObj.parent
			}
			if (parentObj instanceof this.engine.model.ObjType.Table) {
				parentObj.xrefObj = xrefObj
			}

			return xrefObj
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
