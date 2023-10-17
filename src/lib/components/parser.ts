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
import { tokenizer } from './tokenizer.js'

export namespace parser {
	export interface ParserRunOptions {
		abortOnWarning?: boolean,
		onToken?: ((token: tokenizer.Token) => void | Promise<void>) | null
		onLexer?: ((obj: model.Obj | null, warnings: PdfError[]) => void | Promise<void>) | null
	}

	export class Parser {
		readonly engine: engine.Engine
		constructor (config: { engine: engine.Engine }) {
			this.engine = config.engine
		}

		async run (config: {
			reader: io.ReaderPair,
			options?: ParserRunOptions
		}): Promise<{ pdfVersion: string, collection: model.ObjCollection, warnings: PdfError[] }> {
			const reader = config.reader
			const options = config.options
			const { abortOnWarning = false } = options || {}

			const sequentialReader = reader.sequentialReader
			const offsetReader = reader.offsetReader
			const collection = new this.engine.model.ObjCollection()

			const allWarnings: PdfError[] = []
			const { pdfVersion, warnings: docWarnings } = await this.parseDocumentData({ sequentialReader, collection, options })
			if (docWarnings.length) {
				allWarnings.push(...docWarnings)
				if (abortOnWarning) {
					return { pdfVersion, collection, warnings: allWarnings }
				}
			}
			await this.resolveRefs({ collection })
			await this.resolveStreamTypes({ collection })
			{
				const warnings = await this.parseStreams({ offsetReader, collection, options })
				if (warnings) {
					allWarnings.push(...warnings)
					if (abortOnWarning) {
						return { pdfVersion, collection, warnings: allWarnings }
					}
				}
			}
			await this.resolveRefs({ collection })
			await this.resolveCatalog({ collection })
			return { pdfVersion, collection, warnings: allWarnings }
		}

		async parseDocumentData (config: {
			sequentialReader: io.SequentialReader,
			collection: model.ObjCollection,
			options?: ParserRunOptions
		}): Promise<{ pdfVersion: string, warnings: PdfError[] }> {
			const sequentialReader = config.sequentialReader
			const collection = config.collection
			const options = config.options || {}
			const { abortOnWarning = false } = options || {}

			const allWarnings: PdfError[] = []
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
				const m = /^%PDF-(\d+\.\d+)[\r\n]+/.exec(str)
				if (!m) {
					throw new PdfError('Not a PDF: Does not have a PDF header', 'parser:not_pdf:invalid_header')
				}
				const headerLength = m[0].length
				pdfVersion = m[1]
				sequentialReader.consume(headerLength)
			}
			if (!this.engine.constants.VERSION_DATA[pdfVersion]) {
				allWarnings.push(new PdfError(`Unsupported PDF version: ${pdfVersion}`, 'parser:unsupported_version', { pdfVersion }))
				if (abortOnWarning) {
					return { pdfVersion, warnings: allWarnings }
				}
			}

			const tableObj = collection.createObject(this.engine.model.ObjType.Table)
			collection.root.push(tableObj)

			const stack = [collection.root, tableObj]
			const warnings = await this._parseObjectData({ sequentialReader, collection, stack, options })
			allWarnings.push(...warnings)
			return { pdfVersion, warnings: allWarnings }
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
			options?: ParserRunOptions
		}): Promise<PdfError[]> {
			const offsetReader = config.offsetReader
			const collection = config.collection
			const options = config.options
			const { abortOnWarning = false } = options || {}

			const allWarnings: PdfError[] = []
			for (const streamObj of collection.streams.values()) {
				const streamType = streamObj.streamType
				if (!streamType) {
					continue
				}
				const { bytes, warnings: decodeWarnings } = await this.decodeStreamObj({ streamObj, offsetReader })
				allWarnings.push(...decodeWarnings)
				switch (streamType) {
					case 'Content': {
						const { warnings } = await this.parseContentStreamObj({ streamObj, bytes, options })
						allWarnings.push(...warnings)
						break
					}
					case 'XObject/Form': {
						const { warnings } = await this.parseContentStreamObj({ streamObj, bytes, options })
						allWarnings.push(...warnings)
						break
					}
					case 'XObject/Image': {
						const { warnings } = await this.parseImageStreamObj({ streamObj, bytes, options })
						allWarnings.push(...warnings)
						break
					}
					case 'ObjStm': {
						const { warnings } = await this.parseObjectStreamObj({ streamObj, bytes, options })
						allWarnings.push(...warnings)
						break
					}
					case 'XRef': {
						const { warnings } = await this.parseXrefStreamObj({ streamObj, bytes, options })
						allWarnings.push(...warnings)
						break
					}
					default: {
						const { warnings } = await this.parseBinaryStreamObj({ streamObj, bytes, options })
						allWarnings.push(...warnings)
					}
				}
				if (allWarnings.length && abortOnWarning) {
					break
				}
			}
			return allWarnings
		}

		async resolveCatalog (config: { collection: model.ObjCollection }) {
			const collection = config.collection

			for (const tableObj of collection.root.children.values()) {
				if (!(tableObj instanceof this.engine.model.ObjType.Table)) {
					continue
				}
				let catalogObj: model.ObjType.Dictionary | null = null
				const trailer = tableObj.trailer
				if (trailer) {
					const rootParamObj = trailer.children.get('Root')
					if (rootParamObj instanceof this.engine.model.ObjType.Ref) {
						const directObj = rootParamObj.direct
						if (directObj instanceof this.engine.model.ObjType.Dictionary) {
							catalogObj = directObj
						}
					}
				}
				if (!catalogObj) {
					const xrefObj = tableObj.xrefObj
					if (xrefObj) {
						const streamObj = xrefObj.parent
						if (streamObj instanceof this.engine.model.ObjType.Stream) {
							const dictObj = streamObj.dictionary
							if (dictObj) {
								const rootParamObj = dictObj.children.get('Root')
								if (rootParamObj instanceof this.engine.model.ObjType.Ref) {
									const directObj = rootParamObj.direct
									if (directObj instanceof this.engine.model.ObjType.Dictionary) {
										catalogObj = directObj
									}
								}
							}
						}
					}
				}
				if (catalogObj) {
					collection.catalog = catalogObj
				}
			}
		}

		async decodeStreamObj (config: {
			streamObj: model.ObjType.Stream,
			offsetReader: io.OffsetReader
		}): Promise<{ bytes: Uint8Array, warnings: PdfError[]}> {
			const streamObj = config.streamObj
			const offsetReader = config.offsetReader

			const dictObj = streamObj.dictionary
			const sourceLocation = streamObj.sourceLocation
			if (!dictObj || !sourceLocation) {
				return { bytes: new Uint8Array(0), warnings: [] }
			}

			const warnings: PdfError[] = []
			const dictData = dictObj.getChildrenValue()
			if (dictData.F) {
				warnings.push(new PdfError(`@TODO: Not implemented: Stream resource specifies an external file`, 'parser:not_implemented:stream:file', { type: 'Stream', notImplemented: true }))
			}
			const actualLength = sourceLocation.end - sourceLocation.start
			if (typeof dictData.Length === 'number' && dictData.Length !== actualLength) {
				warnings.push(new PdfError(`Stream resource length mismatch at offset ${sourceLocation.start}`, 'parser:invalid:stream:length_mismatch', { type: 'Stream', dictLength: dictData.Length, actualLength, dictData }))
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
						const finalErr = new PdfError(`Stream decode failed (${err.message}) at offset ${sourceLocation.start}`, 'parser:error:stream:decode', { type: 'Stream', dictData })
						finalErr.cause = err
						warnings.push(finalErr)
						return { bytes: new Uint8Array(0), warnings }
					}
					else {
						throw err
					}
				}
			}

			return { bytes, warnings }
		}

		async parseContentStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			options?: ParserRunOptions
		}): Promise<{ obj: model.ObjType.Content, warnings: PdfError[]}> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			const options = config.options || {}
			const collection = streamObj.collection

			const obj = collection.createObject(this.engine.model.ObjType.Content)
			streamObj.direct = obj

			const sequentialReader = new this.engine.io.SequentialMemoryReader(bytes)
			const stack = [obj]
			const warnings = await this._parseObjectData({ sequentialReader, collection, stack, options })

			return { obj, warnings }
		}

		async parseObjectStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			options?: ParserRunOptions
		}): Promise<{ obj: model.ObjType.Array, warnings: PdfError[]}> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			const options = config.options || {}
			const collection = streamObj.collection
			const dictObj = streamObj.dictionary

			const obj = collection.createObject(this.engine.model.ObjType.Array)
			streamObj.direct = obj

			if (!dictObj) {
				return { obj, warnings: [] }
			}
			const allWarnings: PdfError[] = []

			const dictData = dictObj.getChildrenValue()
			const firstOffset = dictData.First
			if (typeof firstOffset !== 'number') {
				allWarnings.push(new PdfError('Object stream dictionary missing "First" param', 'parser:invalid_stream:missing_param:first', { streamObj, dictData }))
				return { obj, warnings: allWarnings }
			}

			const ints = this.engine.codecs.decodeStringArray(bytes.subarray(0, firstOffset), 'latin1').split(/\s+/).filter(v => !!v)
			const objOffsets: Array<[num: number, start: number, end: number]> = []
			for (let index = 0; index < ints.length - 1; index += 2) {
				const num = parseInt(ints[index])
				const start = firstOffset + parseInt(ints[index + 1])
				if (objOffsets.length) {
					objOffsets[objOffsets.length - 1][2] = start
				}
				objOffsets.push([num, start, 0])
			}
			if (objOffsets.length) {
				objOffsets[objOffsets.length - 1][2] = bytes.length
			}

			for (const [num, start, end] of objOffsets) {
				const indirectObj = collection.createObject(this.engine.model.ObjType.Indirect)
				indirectObj.identifier = { num, gen: 0 }
				obj.push(indirectObj)
				const sequentialReader = new this.engine.io.SequentialMemoryReader(bytes.subarray(start, end))
				const stack = [indirectObj]
				const warnings = await this._parseObjectData({ sequentialReader, collection, stack, options })
				allWarnings.push(...warnings)
			}

			return { obj, warnings: allWarnings }
		}

		async parseXrefStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			options?: ParserRunOptions
		}): Promise<{ obj: model.ObjType.Xref, warnings: PdfError[]}> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			// const options = config.options
			const collection = streamObj.collection
			const dictObj = streamObj.dictionary

			const warnings: PdfError[] = []
			const obj = collection.createObject(this.engine.model.ObjType.Xref)
			streamObj.direct = obj

			if (!dictObj) {
				return { obj, warnings }
			}
			const dictData = dictObj.getChildrenValue()
			if (!util.isArrayOfNumber(dictData.W)) {
				warnings.push(new PdfError('Xref stream "W" param is invalid', 'parser:invalid_stream:xref:invalid_w', { obj: streamObj, dictData, param: 'W' }))
				return { obj, warnings }
			}
			for (const width of dictData.W) {
				if (![0, 1, 2, 3, 4].includes(width)) {
					warnings.push(new PdfError(`Xref stream "W" param contains unsupported byte width ${width}`, 'parser:invalid_stream:xref:unsupported_w', { obj: streamObj, dictData, param: 'W' }))
					return { obj, warnings }
				}
			}
			if (typeof dictData.Size !== 'number') {
				warnings.push(new PdfError('Xref stream "Size" param is missing or invalid', 'parser:invalid_stream:xref:invalid_size', { obj: streamObj, dictData, param: 'Size' }))
				return { obj, warnings }
			}
			const rawIndex = dictData.Index || null
			if (rawIndex != null && !util.isArrayOfNumber(rawIndex)) {
				warnings.push(new PdfError('Xref stream "Index" param is invalid', 'parser:invalid_stream:xref:invalid_index', { obj: streamObj, dictData, param: 'Index' }))
				return { obj, warnings }
			}

			const widths = dictData.W as Array<0 | 1 | 2 | 3 | 4>
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
				{ num: number, type: 0, nextFree: number, reuseGen: number } |
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
						case 3: {
							fieldValue =
								dataview.getUint16(offset, false) << 8 +
								dataview.getUint8(offset + 2)
							break
						}
						case 4:
							fieldValue = dataview.getUint32(offset, false)
							break
					}
					fields.push(fieldValue)
					offset += width
				}
				const type = fields[0] == null ? 1 : fields[0]
				switch (type) {
					case 0: {
						const nextFree = fields[1] == null ? 0 : fields[1]
						const reuseGen = fields[2] == null ? 0 : fields[2]
						objTable.push({ num, type, nextFree, reuseGen })
						break
					}
					case 1: {
						const offset = fields[1] == null ? 0 : fields[1]
						const gen = fields[2] == null ? 0 : fields[2]
						objTable.push({ num, type, offset, gen })
						break
					}
					case 2: {
						const streamNum = fields[1] == null ? 0 : fields[1]
						const indexInStream = fields[2] == null ? 0 : fields[2]
						objTable.push({ num, type, streamNum, indexInStream })
						break
					}
					default:
						objTable.push({ num, fields })
				}
			}

			obj.value = { widths, subsections, objTable }

			let parentObj = streamObj.parent
			while (parentObj && !(parentObj instanceof this.engine.model.ObjType.Table)) {
				parentObj = parentObj.parent
			}
			if (parentObj instanceof this.engine.model.ObjType.Table) {
				parentObj.xrefObj = obj
			}

			return { obj, warnings }
		}

		async parseImageStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			options?: ParserRunOptions
		}): Promise<{ obj: model.ObjType.Bytes, warnings: PdfError[]}> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			const options = config.options
			return await this.parseBinaryStreamObj({ streamObj, bytes, options })
		}

		async parseBinaryStreamObj (config: {
			streamObj: model.ObjType.Stream,
			bytes: Uint8Array,
			options?: ParserRunOptions
		}): Promise<{ obj: model.ObjType.Bytes, warnings: PdfError[]}> {
			const streamObj = config.streamObj
			const bytes = config.bytes
			// const options = config.options
			const collection = streamObj.collection

			const obj = collection.createObject(this.engine.model.ObjType.Bytes)
			streamObj.direct = obj
			obj.value = bytes
			return { obj, warnings: []}
		}

		protected async _parseObjectData (config: {
			sequentialReader: io.SequentialReader,
			collection: model.ObjCollection,
			stack: model.ObjWithChildren[],
			options: ParserRunOptions
		}): Promise<PdfError[]> {
			const sequentialReader = config.sequentialReader
			const collection = config.collection
			const stack = config.stack
			const { abortOnWarning = false, onToken, onLexer } = config.options || {}
			const engine = this.engine
			const allWarnings: PdfError[] = []

			const tokenizer = new this.engine.tokenizer.Tokenizer({ engine, sequentialReader })
			const lexer = new this.engine.lexer.Lexer({ engine, collection })
			lexer.stack = stack
			const tokenGenerator = tokenizer.tokens()
			for await (const token of tokenGenerator) {
				onToken && await onToken(token)
				if (token.warning) {
					allWarnings.push(token.warning)
					if (abortOnWarning) {
						break
					}
				}

				const { obj, warnings } = lexer.pushToken(token)
				if (onLexer && (obj || warnings.length)) {
					await onLexer(obj, warnings)
				}
				if (warnings.length) {
					allWarnings.push(...warnings)
					if (abortOnWarning) {
						break
					}
				}
			}

			return allWarnings
		}
	}
}
