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
			const objectCollection = new this.engine.model.Collection()
			const warnings: PdfError[] = []
			const pdfVersion = await this.parseDocument({ sequentialReader, objectCollection, warnings })
			await this.decodeAllStreams({ offsetReader, objectCollection, warnings })
			return { pdfVersion, objectCollection, warnings }
		}

		async parseDocument (config: {
			sequentialReader: io.SequentialReader,
			objectCollection: model.Collection,
			warnings: PdfError[]
		}) {
			const sequentialReader = config.sequentialReader
			const objectCollection = config.objectCollection
			const warnings = config.warnings
			const engine = this.engine
			const rootObject = objectCollection.root
			const tokenizer = new this.engine.tokenizer.Tokenizer({ engine, sequentialReader, warnings })

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

			const lexer = new this.engine.lexer.Lexer({ engine, objectCollection, warnings })
			await this._parseData({ tokenizer, lexer, rootObject })
			this.resolveRefs(objectCollection)
			return pdfVersion
		}

		async decodeAllStreams (config: {
			offsetReader: io.OffsetReader,
			objectCollection: model.Collection,
			warnings: PdfError[]
		}) {
			const offsetReader = config.offsetReader
			const objectCollection = config.objectCollection
			const warnings = config.warnings
			for (const streamObject of objectCollection.streams.values()) {
				await this.decodeStreamObject({ streamObject, offsetReader, warnings })
			}
			this.resolveRefs(objectCollection)
		}

		resolveRefs (objectCollection: model.Collection) {
			for (const ref of objectCollection.refs.values()) {
				if (ref.identifier && !ref.indirect) {
					const obj = objectCollection.identifier(ref.identifier)
					if (obj) {
						ref.indirect = obj
					}
				}
			}
		}

		async decodeStreamObject (config: {
			streamObject: model.PdfObjectType.Stream,
			offsetReader: io.OffsetReader,
			warnings: PdfError[]
		}) {
			const streamObject = config.streamObject
			const offsetReader = config.offsetReader
			const warnings = config.warnings

			const dictObj = streamObject.dictionary
			if (!dictObj || !streamObject.sourceLocation) {
				return
			}

			const sourceLocation = streamObject.sourceLocation
			const dictData = dictObj.getAsObject()
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
						bytes = new Uint8Array(0)
					}
					else {
						throw err
					}
				}
			}

			console.log(bytes)
			// streamObject.decodedBytes = bytes

			/*
			const objectCollection = config.objectCollection
			const engine = this.engine
			const lexer = new engine.Lexer({ engine, objectCollection, warnings })

			let binary = false
			for (const val of bytes.subarray(0, 64)) {
				if (val < 9 || val > 127) {
					binary = true
					break
				}
			}
			if (binary) {
				const directObj = lexer.createObject(engine.model.PdfObjectType.Bytes)
				directObj.value = bytes
				streamObject.direct = directObj
			}
			else {
				const sequentialReader = new engine.io.SequentialMemoryReader(bytes)
				const tokenizer = new engine.Tokenizer({ engine, sequentialReader, warnings })
				const rootObject = lexer.createObject(engine.model.PdfObjectType.Array)
				await this._parseData({ tokenizer, lexer, rootObject })

				let directObj: model.PdfObjectType.Array | model.PdfObjectType.Content | model.PdfObjectType.Text
				const firstChildObj = rootObject.children.get(0)
				if (rootObject.children.size === 1 && firstChildObj instanceof engine.model.PdfObjectType.Text) {
					directObj = firstChildObj
				}
				else if (firstChildObj instanceof engine.model.PdfObjectType.Indirect) {
					directObj = rootObject
				}
				else {
					directObj = lexer.createObject(engine.model.PdfObjectType.Content)
					directObj.children = rootObject.children
				}
				streamObject.direct = directObj
			}
			*/
		}

		protected async _parseData (config: {
			tokenizer: tokenizer.Tokenizer,
			lexer: lexer.Lexer,
			rootObject: model.PdfObjectWithChildren,
		}) {
			const tokenizer = config.tokenizer
			const lexer = config.lexer
			const rootObject = config.rootObject
			lexer.start(rootObject)
			const tokenGenerator = tokenizer.tokens()
			for await (const token of tokenGenerator) {
				lexer.pushToken(token)
			}
		}
	}
}
