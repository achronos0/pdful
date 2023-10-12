/**
 * Convert document data into structured objects in memory.
 *
 * @module
 */

import zlib from 'node:zlib'
import { PdfError } from '../core.js'
import type { Model } from './model.js'
import type { Engine } from './engine.js'
import type { Reader } from './reader.js'

export class Parser {
	readonly engine: Engine
	constructor (config: { engine: Engine }) {
		this.engine = config.engine
	}

	async run (reader: Reader.ReaderPair) {
		const sequentialReader = reader.sequentialReader
		const offsetReader = reader.offsetReader
		const objectCollection = new this.engine.Model.Collection()
		const warnings: PdfError[] = []
		await this.parseDocument({ sequentialReader, objectCollection, warnings })
		await this.parseStreams({ offsetReader, objectCollection, warnings })
		return { objectCollection, warnings }
	}

	async parseDocument (config: {
		sequentialReader: Reader.SequentialReader,
		objectCollection: Model.Collection,
		warnings: PdfError[]
	}) {
		const sequentialReader = config.sequentialReader
		const objectCollection = config.objectCollection
		const warnings = config.warnings
		const engine = this.engine
		const tokenizer = new this.engine.Tokenizer({ engine, sequentialReader, warnings })
		const lexer = new this.engine.Lexer({ engine, objectCollection, warnings })
		await tokenizer.start()
		lexer.start(objectCollection.root)
		const tokenGenerator = tokenizer.tokens()
		for await (const token of tokenGenerator) {
			lexer.pushToken(token)
		}
		this.resolveRefs(objectCollection)
	}

	async parseStreams (config: {
		offsetReader: Reader.OffsetReader,
		objectCollection: Model.Collection,
		warnings: PdfError[]
	}) {
		const offsetReader = config.offsetReader
		const objectCollection = config.objectCollection
		const warnings = config.warnings
		for (const obj of objectCollection.streams.values()) {
			const dictObj = obj.dictionary
			if (!dictObj || !obj.sourceLocation) {
				continue
			}
			const dictData = dictObj.getAsObject()
			if (dictData.F) {
				warnings.push(new PdfError(`@TODO: Not implemented: Stream resource specifies an external file`, 'lexer:not_implemented:stream:file', { type: 'content', notImplemented: true }))
			}
			const actualLength = obj.sourceLocation.end - obj.sourceLocation.start
			if (typeof dictData.Length === 'number' && dictData.Length !== actualLength) {
				warnings.push(new PdfError(`Stream resource length mismatch at offset ${obj.sourceLocation.start}`, 'lexer:invalid:content:length_mismatch', { dictLength: dictData.Length, actualLength, dictData }))
			}
			const filters: [filterType: string, decodeParms: any][] = []
			if (Array.isArray(dictData.Filter)) {
				for (const val of dictData.Filter) {
					if (typeof val === 'string') {
						filters.push([val, null])
					}
				}
			}
			else if (typeof dictData.Filter === 'string') {
				filters.push([dictData.Filter, null])
			}
			if (filters.length) {
				if (Array.isArray(dictData.DecodeParms)) {
					for (const [index, val] of dictData.DecodeParms.entries()) {
						if (index < filters.length && val && typeof val === 'object') {
							filters[index][1] = val
						}
					}
				}
				else if (dictData.DecodeParms && typeof dictData.DecodeParms === 'object') {
					filters[0][1] = dictData.DecodeParms
				}
			}
			let bytes = await offsetReader.readArray(obj.sourceLocation.start, obj.sourceLocation.end)
			for (const [filter, _options] of filters) {
				if (filter === 'FlateDecode') {
					bytes = await new Promise((resolve, reject) => {
						zlib.inflate(bytes, (err, data) => {
							if (err) {
								reject(err)
							}
							else {
								resolve(data)
							}
						})
					})
					continue
				}
				warnings.push(new PdfError(`@TODO: Not supported: Unsupported stream filter ${filter}`, 'lexer:not_implemented:stream:filter', { filter }))
			}

			console.log(bytes)
			// const sequentialReader = new this.engine.Reader.SequentialMemoryReader(bytes)
		}
		this.resolveRefs(objectCollection)
	}

	resolveRefs (objectCollection: Model.Collection) {
		for (const ref of objectCollection.refs.values()) {
			if (ref.identifier && !ref.indirect) {
				const obj = objectCollection.identifier(ref.identifier)
				if (obj) {
					ref.indirect = obj
				}
			}
		}
	}

	protected _parseData (config: {}) {}
}
